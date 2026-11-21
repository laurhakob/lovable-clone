import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import { Project, Version, VersionMeta } from "../types/project";

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
    .filter((v): v is Version => v !== null)
    .map(toVersionMeta)
    .sort((a, b) => b.versionNumber - a.versionNumber);

  return c.json({
    versions: versionMetas,
    currentVersion: project.currentVersion,
  });
});

export { versionsRoutes };