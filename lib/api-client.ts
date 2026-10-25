import { Project } from "@/types/project";

export const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export interface ApiError {
  error: string;
  code: string;
}

type GetTokenFunction = () => Promise<string> | null;

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
    const errorBody = (await response.json().catch(() => ({
      error: "Unknown error",
      code: "UNKNOWN_ERROR",
    }))) as { error: string; code: string; retryAfter?: number };

    if (response.status === 429) {
      const retryAfter = errorBody.retryAfter ?? 60;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("rate-limited", { detail: { retryAfter } }),
        );
      }
    }
    throw new Error(
      errorBody.error || `Request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

export function createApiClient(getToken: GetTokenFunction) {
  return {
    projects: {
      list: () =>
        authenticatedFetch<{ projects: Project[] }>(getToken, "/api/projects"),
    },
  };
}