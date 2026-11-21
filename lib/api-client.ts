import { Project, ProjectFile, VersionMeta } from "@/types/project";
import { ChatMessage } from "@/types/chat";
import { AnalyticsData } from "@/types/analytics";

export const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export interface ApiError {
  error: string;
  code: string;
}

type GetTokenFunction = () => Promise<string | null>;

/** Credits/plan info returned by /api/credits and /api/billing. */
export interface CreditsInfo {
  remaining: number;
  total: number;
  plan: "free" | "pro";
  periodEnd: string;
  isUnlimited: boolean;
}

/** One file-level change between two versions. */
export interface FileChange {
  path: string;
  type: "added" | "removed" | "modified";
  oldContent: string | null;
  newContent: string | null;
}

/** Response of the version diff endpoint. */
export interface VersionDiff {
  from: number;
  to: number;
  changes: FileChange[];
}

async function authenticatedFetch<T>(
  getToken: GetTokenFunction,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new Error("Not Authenticated – no session token available");
  }
  const response = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Read the body as text first: an unhandled worker exception or a proxy
    // error returns plain text / HTML, and calling .json() on that throws,
    // which previously collapsed every such failure into "Unknown error".
    const rawBody = await response.text().catch(() => "");

    let errorBody: { error?: string; code?: string; retryAfter?: number } = {};
    try {
      errorBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      errorBody = {};
    }

    if (response.status === 429) {
      const retryAfter = errorBody.retryAfter ?? 60;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("rate-limited", { detail: { retryAfter } }),
        );
      }
    }

    const method = (options.method ?? "GET").toUpperCase();
    // Non-JSON bodies are surfaced verbatim (truncated) so the real cause is
    // visible instead of being swallowed.
    const detail =
      errorBody.error ||
      (rawBody ? rawBody.slice(0, 300) : "") ||
      `Request failed with status ${response.status}`;

    throw new Error(`${method} ${path} → ${response.status}: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export function createApiClient(getToken: GetTokenFunction) {
  return {
    projects: {
      list: () =>
        authenticatedFetch<{ projects: Project[] }>(getToken, "/api/projects"),
      get: (id: string) =>
        authenticatedFetch<{ project: Project }>(
          getToken,
          `/api/projects/${id}`,
        ),
      getFiles: (id: string) =>
        authenticatedFetch<{ files: ProjectFile[]; version: number }>(
          getToken,
          `/api/projects/${id}/files`,
        ),
      create: (data: { name: string; model: string; description?: string }) =>
        authenticatedFetch<{ project: Project }>(getToken, "/api/projects", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: string, data: { name?: string; model?: string }) =>
        authenticatedFetch<{ project: Project }>(
          getToken,
          `/api/projects/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(data),
          },
        ),
      delete: (id: string) =>
        authenticatedFetch<{ success: boolean }>(
          getToken,
          `/api/projects/${id}`,
          {
            method: "DELETE",
          },
        ),
    },
    chats: {
      getHistory: (projectId: string) =>
        authenticatedFetch<{ messages: ChatMessage[] }>(
          getToken,
          `/api/chat/${projectId}`,
        ),
    },
    credits: {
      get: () => authenticatedFetch<CreditsInfo>(getToken, `/api/credits`),
    },
    analytics: {
      get: () => authenticatedFetch<AnalyticsData>(getToken, `/api/analytics`),
    },
    billing: {
      changePlan: (action: "upgrade" | "downgrade") =>
        authenticatedFetch<{ success: boolean; credits: CreditsInfo }>(
          getToken,
          `/api/billing/plan-change`,
          { method: "POST", body: JSON.stringify({ action }) },
        ),
    },
    versions: {
      list: (projectId: string) =>
        authenticatedFetch<{ versions: VersionMeta[]; currentVersion: number }>(
          getToken,
          `/api/projects/${projectId}/versions`,
        ),
      get: (projectId: string, versionNumber: number) =>
        authenticatedFetch<{ files: ProjectFile[]; meta: VersionMeta }>(
          getToken,
          `/api/projects/${projectId}/versions/${versionNumber}`,
        ),
      diff: (projectId: string, from: number, to: number) =>
        authenticatedFetch<VersionDiff>(
          getToken,
          `/api/projects/${projectId}/versions/${from}/diff/${to}`,
        ),
      restore: (projectId: string, versionNumber: number) =>
        authenticatedFetch<{
          files: ProjectFile[];
          meta: VersionMeta;
          currentVersion: number;
        }>(
          getToken,
          `/api/projects/${projectId}/versions/${versionNumber}/restore`,
          { method: "POST" },
        ),
      saveManual: (projectId: string, files: ProjectFile[]) =>
        authenticatedFetch<{
          versionNumber: number;
          meta: VersionMeta | null;
          unchanged?: boolean;
        }>(getToken, `/api/projects/${projectId}/versions`, {
          method: "POST",
          body: JSON.stringify({ files }),
        }),
    },
  };
}