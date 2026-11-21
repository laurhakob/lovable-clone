"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import React, { use, useCallback, useEffect, useRef, useState } from "react";
import { Project, ProjectFile, VersionMeta } from "@/types/project";
import { ChatMessage, ImageAttachment } from "@/types/chat";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { createApiClient, WORKER_URL } from "@/lib/api-client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorLayout } from "@/components/editor/editor-layout";

/**
 * Strips markdown code fences from file content.
 * Removes the opening ```lang line (if first line) and closing ``` line (if last line).
 * Uses a line-based approach for robustness.
 *
 * @param content - Raw file content that may have markdown fences
 * @returns Clean code without markdown fences
 */
function stripMarkdownFences(content: string): string {
  const lines = content.split("\n");

  // Strip opening fence if first line matches ```lang or ```
  if (lines.length > 0 && /^\s*```[a-zA-Z]*\s*$/.test(lines[0])) {
    lines.shift();
  }

  // Strip trailing empty lines, then closing fence
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length > 0 && /^\s*```\s*$/.test(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join("\n");
}

/**
 * Converts a ProjectFile[] array to a Record<string, string>.
 * This is the format expected by Sandpack and Monaco.
 * Also strips any markdown code fences from file content.
 *
 * @param files - Array of ProjectFile objects from the API
 * @returns Object mapping file paths to their content
 */
function filesToRecord(files: ProjectFile[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const file of files) {
    const cleaned = stripMarkdownFences(file.content);
    if (cleaned !== file.content) {
      console.log(`[filesToRecord] Stripped markdown fences from ${file.path}`);
    }
    record[file.path] = cleaned;
  }
  return record;
}

/**
 * Converts a Record<string, string> back to a ProjectFile[] array.
 * Used when sending files to the API.
 *
 * @param record - Object mapping file paths to content
 * @returns Array of ProjectFile objects
 */
function recordToFiles(record: Record<string, string>): ProjectFile[] {
  return Object.entries(record).map(([path, content]) => ({ path, content }));
}

const EditorPage = ({ params }: { params: Promise<{ projectId: string }> }) => {
  const { projectId } = use(params);
  const { getToken } = useAuth();
  const router = useRouter();

  // --- Auto-heal refs ---
  /** Tracks how many auto-heal attempts have been made for the current error */
  const autoHealAttemptRef = useRef(0);
  /** Whether the last generation was AI-initiated (not manual edit) */
  const justGeneratedRef = useRef(false);
  /** Mirror of isStreaming as a ref — avoids stale closures in callbacks */
  const isStreamingRef = useRef(false);
  /** Maximum number of auto-heal retry attempts before giving up */
  const MAX_AUTO_HEAL_ATTEMPTS = 3;

  /**
   * Stores a pending prompt from sessionStorage (set during project creation).
   * Consumed once after the editor finishes loading to auto-send the first message.
   */
  const pendingPromptRef = useRef<string | null>(null);

  /**
   * Ref that always holds the latest handleSendMessage callback.
   * Used by the auto-send effect to avoid stale closure issues
   * without needing handleSendMessage in the effect's deps.
   */
  const handleSendMessageRef = useRef<
    (content: string, images?: ImageAttachment[], isAutoHeal?: boolean) => void
  >(() => {});

  const [project, setProject] = useState<Project | null>(null);

  /** File contents — Record<filePath, content> */
  const [files, setFiles] = useState<Record<string, string>>({});

  /** Currently selected file in Monaco editor */
  const [activeFile, setActiveFile] = useState<string>("src/App.tsx");

  /** Chat message history */
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  /** Whether AI is currently generating a response */
  const [isStreaming, setIsStreaming] = useState(false);

  /** Loading state while fetching project data */
  const [isLoading, setIsLoading] = useState(true);

  /** Version history metadata for the timeline */
  const [versions, setVersions] = useState<VersionMeta[]>([]);

  /** Whether versions are still loading */
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);

  /** User's remaining credits (-1 = unlimited, undefined = loading) */
  const [creditsRemaining, setCreditsRemaining] = useState<number | undefined>(
    undefined,
  );

  /** Total credits for the billing period (e.g. 50 for free) */
  const [creditsTotal, setCreditsTotal] = useState<number>(50);

  /** User's current plan — determines model access */
  const [userPlan, setUserPlan] = useState<"free" | "pro">("free");

  /** Currently selected AI model ID */
  const [selectedModelId, setSelectedModelId] =
    useState<string>(DEFAULT_MODEL_ID);

  /** Timestamp (ms) until which the user is rate limited, null when not */
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  /** Whether the user has exhausted their free credits */
  const isCreditsExhausted =
    creditsRemaining !== undefined &&
    creditsRemaining !== -1 &&
    creditsRemaining <= 0;

  /**
   * Which old version the user is currently viewing (null = current).
   * When viewing an old version, the editor shows those files read-only.
   */
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  /**
   * Saved files for the current version — used to restore when
   * the user clicks "Back to current" after viewing an old version.
   */
  const currentFilesRef = useRef<Record<string, string>>({});

  /**
   * Diff state — when set, the history panel shows the diff viewer
   * instead of the timeline.
   */
  const [diffState, setDiffState] = useState<{
    from: number;
    to: number;
    changes: Array<{
      path: string;
      type: "added" | "removed" | "modified";
      oldContent: string | null;
      newContent: string | null;
    }>;
  } | null>(null);

  // ---------------------------------------------------------------
  // Auto-save: debounced manual edits → new version
  // ---------------------------------------------------------------

  /** Ref tracking the debounce timer for auto-save */
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ref tracking the max-wait timer (force save after 30s of continuous typing) */
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ref to the last saved files snapshot (for change detection) */
  const lastSavedFilesRef = useRef<Record<string, string>>({});

  /** Whether this is a user-initiated edit (not an AI update) */
  const isManualEditRef = useRef(false);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const client = createApiClient(getToken);
        const [
          projectResponse,
          filesResponse,
          chatResponse,
          versionsResponse,
          creditsResponse,
        ] = await Promise.all([
          client.projects.get(projectId),
          client.projects.getFiles(projectId),
          client.chats.getHistory(projectId),
          client.versions.list(projectId),
          client.credits.get(),
        ]);

        setProject(projectResponse.project);
        setSelectedModelId(projectResponse.project.model || DEFAULT_MODEL_ID);
        setCreditsRemaining(
          creditsResponse.isUnlimited ? -1 : creditsResponse.remaining,
        );
        setCreditsTotal(creditsResponse.total);
        setUserPlan(creditsResponse.plan);

        const filesRecord = filesToRecord(filesResponse.files);
        setFiles(filesRecord);
        currentFilesRef.current = filesRecord;

        setMessages(chatResponse.messages);
        setVersions(versionsResponse.versions);

        const filePaths = filesResponse.files.map((f) => f.path);
        if (filePaths.includes("src/App.tsx")) {
          setActiveFile("src/App.tsx");
        } else if (filePaths.length > 0) {
          setActiveFile(filePaths[0]);
        }

        // Check for pending prompt from sessionStorage (set during project creation)
        try {
          const storageKey = `pendingPrompt:${projectId}`;
          const pending = sessionStorage.getItem(storageKey);
          if (pending) {
            pendingPromptRef.current = pending;
            sessionStorage.removeItem(storageKey);
          }
        } catch {}
      } catch (error) {
        console.error("Failed to load project:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to load project",
        );
        router.push("/dashboard");
      } finally {
        setIsLoading(false);
        setIsLoadingVersions(false);
      }
    };

    loadProject();
  }, [projectId, getToken, router]);

  const refreshVersions = useCallback(async () => {
    try {
      const client = createApiClient(getToken);
      const response = await client.versions.list(projectId);
      setVersions(response.versions);
    } catch {
      // Silently fail — timeline will show stale data
      console.error("Failed to refresh versions");
    }
  }, [getToken, projectId]);

  const handleFilesChange = (files: Record<string, string>) => {
    alert("Pending Files Change implementation");
  };

  const handleModelChange = (modelId: string) => {
    alert("Pending Model Change implementation");
  };

  const handleRename = (newName: string) => {
    alert("Pending Rename implementation");
  };

  const handleDelete = () => {
    alert("Pending Delete implementation");
  };

  const projectName = project?.name ?? "Untitled Project";

  const handleBackToCurrent = () => {
    alert("Pending Back to Current implementation");
  };

  /**
   * Handles sending a new chat message via SSE streaming.
   * Connects to POST /api/chat/:projectId, streams the AI response
   * character by character, and updates files when generation completes.
   */
  const handleSendMessage = useCallback(
    async (
      content: string,
      images?: ImageAttachment[],
      isAutoHeal?: boolean,
    ) => {
      // Reset auto-heal counter on normal user messages
      if (!isAutoHeal) {
        autoHealAttemptRef.current = 0;
      }

      // If viewing an old version, go back to current first
      if (viewingVersion !== null) {
        handleBackToCurrent();
      }

      // Mark that we're starting a new generation (not yet complete)
      justGeneratedRef.current = false;

      // Create the user message and add to chat
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
        images: images && images.length > 0 ? images : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      isStreamingRef.current = true;

      // Create an empty AI message that will be filled by streaming chunks
      const aiMessageId = `msg-${Date.now()}-assistant`;
      const aiMessage: ChatMessage = {
        id: aiMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        model: selectedModelId,
      };
      setMessages((prev) => [...prev, aiMessage]);

      try {
        // Get the Clerk auth token for the API request
        const token = await getToken();
        if (!token) {
          throw new Error("Not authenticated");
        }

        // Make the streaming request to the chat endpoint
        const response = await fetch(`${WORKER_URL}/api/chat/${projectId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: content,
            model: selectedModelId,
            images: images && images.length > 0 ? images : undefined,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({
            error: "Request failed",
          }));
          const typed = errorBody as {
            error?: string;
            code?: string;
            retryAfter?: number;
          };

          // Trigger the global rate limit banner on 429 responses
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Parse SSE event type lines
            if (line.startsWith("event: ")) {
              continue;
            }

            // Parse SSE data lines
            if (!line.startsWith("data: ")) {
              continue;
            }

            const data = line.slice(6);
            if (!data) continue;

            try {
              const event = JSON.parse(data);

              // Handle chunk events – append text to AI message
              if (event.text !== undefined) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? { ...msg, content: msg.content + event.text }
                      : msg,
                  ),
                );
              }

              // Handle files event – update Sandpack + Monaco
              if (event.files) {
                const newFiles = filesToRecord(event.files);
                setFiles(newFiles);
                currentFilesRef.current = newFiles;
                lastSavedFilesRef.current = newFiles;
                // Mark that AI generation produced files – enables auto-heal
                // Set here (not on "done") because Sandpack evaluates files
                // immediately and may error before the done event arrives.
                justGeneratedRef.current = true;
              }

              // Handle done event – update project version info and credits
              if (event.creditsRemaining !== undefined) {
                setCreditsRemaining(event.creditsRemaining);
              }

              if (event.versionId) {
                setProject((prev) =>
                  prev
                    ? {
                        ...prev,
                        currentVersion: prev.currentVersion + 1,
                        updatedAt: new Date().toISOString(),
                      }
                    : prev,
                );

                // Update the AI message with version number
                const versionNumber = parseInt(
                  event.versionId.replace("v", ""),
                  10,
                );
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId ? { ...msg, versionNumber } : msg,
                  ),
                );

                // Refresh the version timeline
                refreshVersions();
              }

              // Handle error events from the stream
              if (event.code && event.message) {
                // Trigger global rate limit banner for SSE rate limit errors (fallback 60s)
                if (event.code === "RATE_LIMITED") {
                  setRateLimitedUntil(Date.now() + 60000);
                  window.dispatchEvent(
                    new CustomEvent("rate-limited", {
                      detail: { retryAfter: 60 },
                    }),
                  );
                }

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: `Error: ${event.message}`,
                        }
                      : msg,
                  ),
                );
                toast.error(event.message as string);
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      } catch (error) {
        // Handle network or auth errors
        const errorMessage =
          error instanceof Error ? error.message : "Something went wrong";

        // Fallback: detect rate limit from error message when the 429 response
        // couldn't be parsed (e.g. CORS error, body parse failure)
        const lowerError = errorMessage.toLowerCase();

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId
              ? { ...msg, content: `Error: ${errorMessage}` }
              : msg,
          ),
        );

        toast.error(errorMessage);
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
      }
    },
    [project, selectedModelId, getToken, projectId, viewingVersion, refreshVersions],
  );

  // Keep the ref in sync so the auto-send effect always calls the latest version
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  if (isLoading) return <EditorLayoutSkeleton />;

  return (
    <EditorLayout
      projectId={projectId}
      projectName={projectName}
      files={files}
      messages={messages}
      isStreaming={isStreaming}
      activeFile={activeFile}
      creditsRemaining={creditsRemaining}
      creditsTotal={creditsTotal}
      isCreditsExhausted={isCreditsExhausted}
      selectedModelId={selectedModelId}
      userPlan={userPlan}
      viewingVersion={viewingVersion}
      previewPanel={<div>PreviewPanel</div>}
      codeEditorPanel={<div>CodeEditorPanel</div>}
      historyPanel={<div>HistoryPanel</div>}
      onSendMessage={handleSendMessage}
      onFilesChange={handleFilesChange}
      onActiveFileChange={setActiveFile}
      onModelChange={handleModelChange}
      onRename={handleRename}
      onDelete={handleDelete}
      onBackToCurrent={handleBackToCurrent}
    />
  );
};

export function EditorLayoutSkeleton() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44 hidden sm:block" />
          </div>
        </div>
        <div className="mx-auto">
          <Skeleton className="h-8 w-48 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-md hidden sm:block" />
          <Skeleton className="size-7 rounded-full" />
        </div>
      </div>

      {/* Panel body skeleton – desktop */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="flex w-[30%] shrink-0 flex-col border-r border-border">
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="ml-auto h-16 w-3/4 rounded-2xl" />
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
            <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
          </div>
          <div className="border-t border-border p-3">
            <Skeleton className="h-12 rounded-xl" />
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex-1 p-4">
            <Skeleton className="h-full w-full rounded-lg" />
          </div>
        </div>
      </div>

      {/* Panel body skeleton – mobile */}
      <div className="flex md:hidden flex-1 flex-col p-4">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </div>
  );
}

export default EditorPage;