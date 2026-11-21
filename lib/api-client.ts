import { Project, ProjectFile, VersionMeta } from "@/types/project";
import { ChatMessage } from "@/types/chat";

export const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export interface ApiError {
  error: string;
  code: string;
}

type GetTokenFunction = () => Promise<string | null>;

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
      get: () =>
        authenticatedFetch<{
          remaining: number;
          total: number;
          plan: "free" | "pro";
          periodEnd: string;
          isUnlimited: boolean;
        }>(getToken, `/api/credits`),
    },
    versions: {
      list: (projectId: string) =>
        authenticatedFetch<{ versions: VersionMeta[] }>(
          getToken,
          `/api/projects/${projectId}/versions`,
        ),
    },
  };
}