import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import { Project, ProjectFile, Version, VersionMeta } from "../types/project";
import { ChatMessage, ChatSession } from "../types/chat";

const versionsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------
// Helper: Verify project ownership
// ---------------------------------------------------------------

/**
 * Fetches a project from KV and verifies the requesting user owns it.
 * Returns the project if valid, or null with an error response.
 *
 * @param projectId - The project ID to look up
 * @param userId - The authenticated user's ID
 * @param env - Worker environment bindings
 * @returns The project if owned by the user, null otherwise
 */
async function getOwnedProject(
  projectId: string,
  userId: string,
  env: Env,
): Promise<Project | null> {
  const project = await env.METADATA.get<Project>(
    `project:${projectId}`,
    "json",
  );

  if (!project || project.userId !== userId) {
    return null;
  }

  return project;
}

/**
 * Extracts version metadata from a full Version object.
 * Strips the files array to create a lightweight VersionMeta
 * suitable for the timeline listing.
 *
 * @param version - Full version object from R2
 * @returns VersionMeta without files array
 */
function toVersionMeta(version: Version): VersionMeta {
  return {
    versionNumber: version.versionNumber,
    type: version.type,
    prompt: version.prompt,
    model: version.model,
    createdAt: version.createdAt,
    fileCount: version.fileCount ?? version.files?.length ?? 0,
    changedFiles: version.changedFiles,
    restoredFrom: version.restoredFrom,
  };
}

// ---------------------------------------------------------------
// GET /api/projects/:id/versions – List all versions with metadata
// ---------------------------------------------------------------

/**
 * Returns metadata for all versions of a project, sorted newest first.
 * Scans R2 for all version objects under the project prefix,
 * fetches each one, and strips the files array to keep the response lean.
 *
 * Response: { versions: VersionMeta[], currentVersion: number }
 */

versionsRoutes.get("/:id/versions", async (c) => {
  const userId = c.var.userId;
  const projectId = c.req.param("id");
  if (!projectId) {
    return c.json(
      { error: "Project ID is required", code: "BAD_REQUEST" },
      400,
    );
  }
  const project = await getOwnedProject(projectId, userId, c.env);
  if (!project) {
    return c.json(
      { error: "Project not found or access denied", code: "NOT_FOUND" },
      404,
    );
  }

  const versionPromises: Promise<Version | null>[] = [];
  for (let v = 0; v <= project.currentVersion; v++) {
    versionPromises.push(
      c.env.FILES.get(`${projectId}/v${v}/files.json`)
        .then((obj) => (obj ? (obj.json() as Promise<Version>) : null))
        .catch(() => null),
    );
  }

  const versions = await Promise.all(versionPromises);

  const versionMetas: VersionMeta[] = versions
    // Skip legacy snapshots that carry no version metadata
    .filter(
      (v): v is Version => v !== null && typeof v.versionNumber === "number",
    )
    .map(toVersionMeta)
    .sort((a, b) => b.versionNumber - a.versionNumber);

  return c.json({
    versions: versionMetas,
    currentVersion: project.currentVersion,
  });
});

// ---------------------------------------------------------------
// Helpers shared by the single-version routes
// ---------------------------------------------------------------

type ParsedVersion =
  | { ok: true; value: number }
  | { ok: false; error: string; status: 400 | 404 };

/**
 * Parses a version number path param and checks it against the project.
 * NaN / negative → 400, beyond currentVersion → 404.
 */
function parseVersionParam(
  raw: string | undefined,
  project: Project,
): ParsedVersion {
  const value = Number(raw);
  if (!raw || isNaN(value) || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: "Invalid version number", status: 400 };
  }
  if (value > project.currentVersion) {
    return { ok: false, error: "Version not found", status: 404 };
  }
  return { ok: true, value };
}

/** Reads a full version object from R2, or null when it is missing. */
async function readVersion(
  env: Env,
  projectId: string,
  versionNumber: number,
): Promise<Version | null> {
  const obj = await env.FILES.get(`${projectId}/v${versionNumber}/files.json`);
  if (!obj) return null;
  const version = (await obj.json()) as Partial<Version>;
  // Legacy v0 snapshots stored only `files` — fill in the gaps.
  const files = version.files ?? [];
  return {
    versionNumber: version.versionNumber ?? versionNumber,
    prompt: version.prompt ?? "",
    model: version.model ?? "",
    files,
    changedFiles: version.changedFiles ?? [],
    type: version.type ?? "manual",
    createdAt: version.createdAt ?? new Date(0).toISOString(),
    fileCount: version.fileCount ?? files.length,
    restoredFrom: version.restoredFrom,
  };
}

/** Writes a version object to R2. */
function writeVersion(env: Env, projectId: string, version: Version) {
  return env.FILES.put(
    `${projectId}/v${version.versionNumber}/files.json`,
    JSON.stringify(version),
  );
}

const PROJECT_NOT_FOUND = {
  error: "Project not found or access denied",
  code: "NOT_FOUND",
};
const VERSION_NOT_FOUND = { error: "Version not found", code: "NOT_FOUND" };

// ---------------------------------------------------------------
// GET /api/projects/:id/versions/:v – Files + metadata for one version
// ---------------------------------------------------------------

versionsRoutes.get("/:id/versions/:v", async (c) => {
  const projectId = c.req.param("id");
  const project = await getOwnedProject(projectId, c.var.userId, c.env);
  if (!project) return c.json(PROJECT_NOT_FOUND, 404);

  const parsed = parseVersionParam(c.req.param("v"), project);
  if (!parsed.ok) {
    return c.json({ error: parsed.error, code: "INVALID_VERSION" }, parsed.status);
  }

  const version = await readVersion(c.env, projectId, parsed.value);
  if (!version) return c.json(VERSION_NOT_FOUND, 404);

  return c.json({ files: version.files, meta: toVersionMeta(version) });
});

// ---------------------------------------------------------------
// GET /api/projects/:id/versions/:v1/diff/:v2 – File-level diff
// ---------------------------------------------------------------

interface DiffChange {
  path: string;
  type: "added" | "removed" | "modified";
  oldContent: string | null;
  newContent: string | null;
}

const CHANGE_ORDER: Record<DiffChange["type"], number> = {
  modified: 0,
  added: 1,
  removed: 2,
};

versionsRoutes.get("/:id/versions/:v1/diff/:v2", async (c) => {
  const projectId = c.req.param("id");
  const project = await getOwnedProject(projectId, c.var.userId, c.env);
  if (!project) return c.json(PROJECT_NOT_FOUND, 404);

  const p1 = parseVersionParam(c.req.param("v1"), project);
  if (!p1.ok) return c.json({ error: p1.error, code: "INVALID_VERSION" }, p1.status);
  const p2 = parseVersionParam(c.req.param("v2"), project);
  if (!p2.ok) return c.json({ error: p2.error, code: "INVALID_VERSION" }, p2.status);

  if (p1.value === p2.value) {
    return c.json(
      { error: "Cannot compare a version with itself", code: "INVALID_VERSION" },
      400,
    );
  }

  const [from, to] = await Promise.all([
    readVersion(c.env, projectId, p1.value),
    readVersion(c.env, projectId, p2.value),
  ]);
  if (!from || !to) return c.json(VERSION_NOT_FOUND, 404);

  const fromMap = new Map<string, string>(
    from.files.map((f) => [f.path, f.content]),
  );
  const toMap = new Map<string, string>(to.files.map((f) => [f.path, f.content]));
  const changes: DiffChange[] = [];

  for (const [path, newContent] of toMap) {
    const oldContent = fromMap.get(path);
    if (oldContent === undefined) {
      changes.push({ path, type: "added", oldContent: null, newContent });
    } else if (oldContent !== newContent) {
      changes.push({ path, type: "modified", oldContent, newContent });
    }
  }
  for (const [path, oldContent] of fromMap) {
    if (!toMap.has(path)) {
      changes.push({ path, type: "removed", oldContent, newContent: null });
    }
  }

  changes.sort(
    (a, b) =>
      CHANGE_ORDER[a.type] - CHANGE_ORDER[b.type] ||
      a.path.localeCompare(b.path),
  );

  return c.json({ from: p1.value, to: p2.value, changes });
});

// ---------------------------------------------------------------
// POST /api/projects/:id/versions/:v/restore – Restore as a NEW version
// ---------------------------------------------------------------

versionsRoutes.post("/:id/versions/:v/restore", async (c) => {
  const projectId = c.req.param("id");
  const project = await getOwnedProject(projectId, c.var.userId, c.env);
  if (!project) return c.json(PROJECT_NOT_FOUND, 404);

  const parsed = parseVersionParam(c.req.param("v"), project);
  if (!parsed.ok) {
    return c.json({ error: parsed.error, code: "INVALID_VERSION" }, parsed.status);
  }

  const source = await readVersion(c.env, projectId, parsed.value);
  if (!source) return c.json(VERSION_NOT_FOUND, 404);

  const now = new Date().toISOString();
  const restored: Version = {
    versionNumber: project.currentVersion + 1,
    prompt: `Restored from version ${parsed.value}`,
    model: source.model,
    files: source.files,
    changedFiles: source.files.map((f) => f.path),
    type: "restore",
    createdAt: now,
    fileCount: source.fileCount,
    restoredFrom: parsed.value,
  };

  const updatedProject: Project = {
    ...project,
    currentVersion: restored.versionNumber,
    updatedAt: now,
  };

  await Promise.all([
    writeVersion(c.env, projectId, restored),
    c.env.METADATA.put(`project:${projectId}`, JSON.stringify(updatedProject)),
  ]);

  // Record the restore in chat history. A failure here must not fail the restore.
  try {
    const session = await c.env.METADATA.get<ChatSession>(
      `chat:${projectId}`,
      "json",
    );
    const systemMessage: ChatMessage = {
      id: `msg-${Date.now()}-system`,
      role: "system",
      content: `Restored to version ${parsed.value}`,
      timestamp: now,
      versionNumber: restored.versionNumber,
    };
    const updatedSession: ChatSession = {
      projectId,
      messages: [...(session?.messages ?? []), systemMessage],
      createdAt: session?.createdAt ?? now,
      updatedAt: now,
    };
    await c.env.METADATA.put(
      `chat:${projectId}`,
      JSON.stringify(updatedSession),
    );
  } catch (err) {
    console.error(
      `[versions] Failed to append restore message for ${projectId}:`,
      err,
    );
  }

  return c.json({
    files: restored.files,
    meta: toVersionMeta(restored),
    currentVersion: restored.versionNumber,
  });
});

// ---------------------------------------------------------------
// POST /api/projects/:id/versions – Save manual edits as a new version
// ---------------------------------------------------------------

versionsRoutes.post("/:id/versions", async (c) => {
  const projectId = c.req.param("id");
  const project = await getOwnedProject(projectId, c.var.userId, c.env);
  if (!project) return c.json(PROJECT_NOT_FOUND, 404);

  let files: ProjectFile[] | undefined;
  try {
    files = (await c.req.json<{ files?: ProjectFile[] }>()).files;
  } catch {
    files = undefined;
  }
  if (
    !Array.isArray(files) ||
    files.some(
      (f) => typeof f?.path !== "string" || typeof f?.content !== "string",
    )
  ) {
    return c.json(
      {
        error: "Request body must include files: { path, content }[]",
        code: "VALIDATION_ERROR",
      },
      400,
    );
  }

  const current = await readVersion(c.env, projectId, project.currentVersion);
  const currentMap = new Map<string, string>(
    (current?.files ?? []).map((f) => [f.path, f.content]),
  );
  const nextPaths = new Set(files.map((f) => f.path));

  const changedFiles = files
    .filter((f) => currentMap.get(f.path) !== f.content)
    .map((f) => f.path);
  const removedFiles = [...currentMap.keys()].filter((p) => !nextPaths.has(p));

  // Nothing changed → don't create an empty version
  if (changedFiles.length === 0 && removedFiles.length === 0) {
    return c.json({
      versionNumber: project.currentVersion,
      meta: current ? toVersionMeta(current) : null,
      unchanged: true,
    });
  }

  const now = new Date().toISOString();
  const version: Version = {
    versionNumber: project.currentVersion + 1,
    prompt: "Manual edit",
    model: current?.model || project.model,
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
    changedFiles: [...changedFiles, ...removedFiles],
    type: "manual",
    createdAt: now,
    fileCount: files.length,
  };

  const updatedProject: Project = {
    ...project,
    currentVersion: version.versionNumber,
    updatedAt: now,
  };

  await Promise.all([
    writeVersion(c.env, projectId, version),
    c.env.METADATA.put(`project:${projectId}`, JSON.stringify(updatedProject)),
  ]);

  return c.json(
    { versionNumber: version.versionNumber, meta: toVersionMeta(version) },
    201,
  );
});

export { versionsRoutes };