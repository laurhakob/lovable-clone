"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import React, { use, useCallback, useEffect, useRef, useState } from "react";
import { Project, ProjectFile, VersionMeta } from "@/types/project";
import { ChatMessage, ImageAttachment } from "@/types/chat";
import { DEFAULT_MODEL_ID, getModelById } from "@/lib/models";
import { createApiClient, VersionDiff as VersionDiffData, WORKER_URL } from "@/lib/api-client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorLayout } from "@/components/editor/editor-layout";
import { EditorTabValue } from "@/components/editor/editor-tabs";
import { PreviewSkeleton } from "@/components/editor/preview-skeleton";
import { EditorSkeleton } from "@/components/editor/editor-skeleton";
import { VersionTimeline } from "@/components/editor/version-timeline";
import { AUTO_HEAL_PREFIX } from "@/components/editor/message-bubble";
import type { PreviewError } from "@/components/editor/preview-panel";
import { CREDITS_UPDATED_EVENT } from "@/components/billing/upgrade-button";
import { daysUntil } from "@/components/billing/credits-display";

// Heavy, browser-only panels are loaded on the client only.
const PreviewPanel = dynamic(
  () => import("@/components/editor/preview-panel").then((m) => m.PreviewPanel),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);
const CodeEditorPanel = dynamic(
  () =>
    import("@/components/editor/code-editor-panel").then(
      (m) => m.CodeEditorPanel,
    ),
  { ssr: false, loading: () => <EditorSkeleton /> },
);
const VersionDiff = dynamic(
  () => import("@/components/editor/version-diff").then((m) => m.VersionDiff),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

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
    record[file.path] = stripMarkdownFences(file.content);
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

/** Shallow equality for file records */
function recordsEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => b[key] === a[key]);
}

/** Picks a sensible file to show when the active one doesn't exist */
function pickActiveFile(
  record: Record<string, string>,
  preferred: string,
): string {
  if (record[preferred] !== undefined) return preferred;
  if (record["src/App.tsx"] !== undefined) return "src/App.tsx";
  return Object.keys(record).sort()[0] ?? preferred;
}

/** Idle time before manual edits are saved as a version */
const AUTO_SAVE_DELAY_MS = 2000;
/** Force a save after this long of continuous typing */
const AUTO_SAVE_MAX_WAIT_MS = 30000;
/** Wait for Sandpack to settle before treating an error as real */
const AUTO_HEAL_SETTLE_MS = 1500;
/** Maximum automatic fix attempts (per error, and in a row) */
const MAX_AUTO_HEAL_ATTEMPTS = 2;
/** Keep the error excerpt well under the worker's message limit */
const MAX_ERROR_CHARS = 3000;

const EditorPage = ({ params }: { params: Promise<{ projectId: string }> }) => {
  const { projectId } = use(params);
  const { getToken } = useAuth();
  const router = useRouter();

  // --- Auto-heal refs ---
  /** Consecutive auto-heal attempts since the last user-sent message */
  const autoHealAttemptRef = useRef(0);
  /** Attempts per distinct error (dedupe identical errors) */
  const autoHealPerErrorRef = useRef<Map<string, number>>(new Map());
  /** Pending (debounced) auto-heal timer */
  const autoHealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the last generation was AI-initiated (not manual edit) */
  const justGeneratedRef = useRef(false);
  /** Mirror of isStreaming as a ref — avoids stale closures in callbacks */
  const isStreamingRef = useRef(false);

  /**
   * Stores a pending prompt from sessionStorage (set during project creation).
   * Consumed once after the editor finishes loading to auto-send the first message.
   */
  const pendingPromptRef = useRef<string | null>(null);

  /**
   * Ref that always holds the latest handleSendMessage callback.
   * Used by the auto-send and auto-heal paths to avoid stale closures.
   */
  const handleSendMessageRef = useRef<
    (content: string, images?: ImageAttachment[], isAutoHeal?: boolean) => void
  >(() => {});

  const [project, setProject] = useState<Project | null>(null);

  /** File contents — Record<filePath, content> */
  const [files, setFiles] = useState<Record<string, string>>({});

  /** Currently selected file in Monaco editor */
  const [activeFile, setActiveFile] = useState<string>("src/App.tsx");

  /** Active editor tab (preview / code / history) */
  const [activeTab, setActiveTab] = useState<EditorTabValue>("preview");

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

  /** When the current credit period ends (ISO) */
  const [creditsPeriodEnd, setCreditsPeriodEnd] = useState<string | null>(
    null,
  );

  /** User's current plan — determines model access */
  const [userPlan, setUserPlan] = useState<"free" | "pro">("free");

  /** Currently selected AI model ID */
  const [selectedModelId, setSelectedModelId] =
    useState<string>(DEFAULT_MODEL_ID);

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
  const viewingVersionRef = useRef<number | null>(null);
  useEffect(() => {
    viewingVersionRef.current = viewingVersion;
  }, [viewingVersion]);

  /**
   * Latest files of the CURRENT version (including unsaved manual edits).
   * Used to restore when the user leaves "viewing" mode, and as the source
   * for auto-save.
   */
  const currentFilesRef = useRef<Record<string, string>>({});

  /**
   * Diff state — when set, the history panel shows the diff viewer
   * instead of the timeline.
   */
  const [diffState, setDiffState] = useState<VersionDiffData | null>(null);

  // ---------------------------------------------------------------
  // Auto-save: debounced manual edits → new version
  // ---------------------------------------------------------------

  /** Ref tracking the debounce timer for auto-save */
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ref tracking the max-wait timer (force save after 30s of continuous typing) */
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ref to the last saved files snapshot (for change detection) */
  const lastSavedFilesRef = useRef<Record<string, string>>({});

  /** Serializes saves so two never race */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const applyCredits = useCallback(
    (credits: {
      remaining: number;
      total: number;
      plan: "free" | "pro";
      periodEnd: string;
      isUnlimited: boolean;
    }) => {
      setCreditsRemaining(credits.isUnlimited ? -1 : credits.remaining);
      setCreditsTotal(credits.total);
      setUserPlan(credits.plan);
      setCreditsPeriodEnd(credits.periodEnd);
    },
    [],
  );

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
        applyCredits(creditsResponse);

        // Persisted model — but a downgraded user can't keep a premium model
        const savedModel = getModelById(projectResponse.project.model);
        const usableModel =
          savedModel &&
          (savedModel.tier !== "premium" || creditsResponse.plan === "pro")
            ? savedModel.id
            : DEFAULT_MODEL_ID;
        setSelectedModelId(usableModel);

        const filesRecord = filesToRecord(filesResponse.files);
        setFiles(filesRecord);
        currentFilesRef.current = filesRecord;
        lastSavedFilesRef.current = filesRecord;

        setMessages(chatResponse.messages);
        setVersions(versionsResponse.versions);
        setActiveFile((prev) => pickActiveFile(filesRecord, prev));

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
  }, [projectId, getToken, router, applyCredits]);

  // Refresh credits/plan after an in-app upgrade (checkout completes)
  useEffect(() => {
    const onCreditsUpdated = async () => {
      try {
        applyCredits(await createApiClient(getToken).credits.get());
      } catch (error) {
        console.error("Failed to refresh credits:", error);
      }
    };
    window.addEventListener(CREDITS_UPDATED_EVENT, onCreditsUpdated);
    return () =>
      window.removeEventListener(CREDITS_UPDATED_EVENT, onCreditsUpdated);
  }, [getToken, applyCredits]);

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

  // ---------------------------------------------------------------
  // Manual edits → saved versions
  // ---------------------------------------------------------------

  const clearAutoSaveTimers = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    autoSaveTimerRef.current = null;
    maxWaitTimerRef.current = null;
  }, []);

  /** Saves current files as a manual version if they differ from the last save. */
  const saveManualEdits = useCallback((): Promise<void> => {
    clearAutoSaveTimers();
    const run = async () => {
      const snapshot = currentFilesRef.current;
      if (recordsEqual(snapshot, lastSavedFilesRef.current)) return;
      try {
        const client = createApiClient(getToken);
        const result = await client.versions.saveManual(
          projectId,
          recordToFiles(snapshot),
        );
        lastSavedFilesRef.current = snapshot;
        if (!result.unchanged) {
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  currentVersion: result.versionNumber,
                  updatedAt: new Date().toISOString(),
                }
              : prev,
          );
          refreshVersions();
        }
      } catch (error) {
        console.error("Failed to save manual edits:", error);
        toast.error("Failed to save your changes. They'll be retried.");
        // Retry on the next edit or flush
      }
    };
    saveChainRef.current = saveChainRef.current.then(run, run);
    return saveChainRef.current;
  }, [clearAutoSaveTimers, getToken, projectId, refreshVersions]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(saveManualEdits, AUTO_SAVE_DELAY_MS);
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(
        saveManualEdits,
        AUTO_SAVE_MAX_WAIT_MS,
      );
    }
  }, [saveManualEdits]);

  /** Monaco edit of a single file */
  const handleFileContentChange = useCallback(
    (path: string, content: string) => {
      if (viewingVersionRef.current !== null) return; // read-only
      if (currentFilesRef.current[path] === content) return;
      currentFilesRef.current = { ...currentFilesRef.current, [path]: content };
      setFiles((prev) => ({ ...prev, [path]: content }));
      // A manual edit isn't an AI generation — don't auto-heal its errors
      justGeneratedRef.current = false;
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  /** Bulk file replacement (kept for the EditorLayout contract) */
  const handleFilesChange = useCallback(
    (nextFiles: Record<string, string>) => {
      if (viewingVersionRef.current !== null) return;
      currentFilesRef.current = nextFiles;
      setFiles(nextFiles);
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  // Flush on unmount; warn before closing the tab with unsaved edits
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!recordsEqual(currentFilesRef.current, lastSavedFilesRef.current)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      saveManualEdits();
    };
  }, [saveManualEdits]);

  // ---------------------------------------------------------------
  // Project actions
  // ---------------------------------------------------------------

  const handleModelChange = useCallback(
    async (modelId: string) => {
      setSelectedModelId(modelId);
      setProject((p) => (p ? { ...p, model: modelId } : p));
      try {
        const client = createApiClient(getToken);
        await client.projects.update(projectId, { model: modelId });
      } catch {
        toast.error("Failed to update model. Try again.");
      }
    },
    [getToken, projectId],
  );

  const handleRename = useCallback(
    async (newName: string) => {
      const previousName = project?.name;
      setProject((p) => (p ? { ...p, name: newName } : p));
      try {
        const client = createApiClient(getToken);
        const { project: updated } = await client.projects.update(projectId, {
          name: newName,
        });
        setProject((p) => (p ? { ...p, name: updated.name } : p));
        toast.success("Project renamed");
      } catch {
        setProject((p) =>
          p && previousName ? { ...p, name: previousName } : p,
        );
        toast.error("Failed to rename project. Try again.");
      }
    },
    [getToken, projectId, project?.name],
  );

  const handleDelete = useCallback(async () => {
    try {
      clearAutoSaveTimers();
      // Nothing left to save — don't let the unmount flush recreate a version
      lastSavedFilesRef.current = currentFilesRef.current;
      const client = createApiClient(getToken);
      await client.projects.delete(projectId);
      toast.success("Project deleted");
      router.push("/dashboard");
    } catch {
      toast.error("Failed to delete project. Try again.");
    }
  }, [clearAutoSaveTimers, getToken, projectId, router]);

  const projectName = project?.name ?? "Untitled Project";

  // ---------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------

  const handleBackToCurrent = useCallback(() => {
    const current = currentFilesRef.current;
    setFiles(current);
    setActiveFile((prev) => pickActiveFile(current, prev));
    setViewingVersion(null);
  }, []);

  const handleViewVersion = useCallback(
    async (versionNumber: number) => {
      if (project && versionNumber === project.currentVersion) {
        handleBackToCurrent();
        return;
      }
      try {
        // Persist any pending edits before switching away from them
        await saveManualEdits();
        const client = createApiClient(getToken);
        const { files: versionFiles } = await client.versions.get(
          projectId,
          versionNumber,
        );
        const record = filesToRecord(versionFiles);
        // Viewing an old version is not a generation — never auto-heal it
        justGeneratedRef.current = false;
        setFiles(record);
        setActiveFile((prev) => pickActiveFile(record, prev));
        setViewingVersion(versionNumber);
        setDiffState(null);
        setActiveTab("preview");
      } catch (error) {
        console.error("Failed to load version:", error);
        toast.error(`Failed to load version ${versionNumber}`);
      }
    },
    [project, handleBackToCurrent, saveManualEdits, getToken, projectId],
  );

  const handleCompareVersions = useCallback(
    async (from: number, to: number) => {
      try {
        await saveManualEdits();
        const client = createApiClient(getToken);
        const diff = await client.versions.diff(projectId, from, to);
        setDiffState(diff);
        setActiveTab("history");
      } catch (error) {
        console.error("Failed to compare versions:", error);
        toast.error("Failed to compare versions");
      }
    },
    [saveManualEdits, getToken, projectId],
  );

  const handleRestoreVersion = useCallback(
    async (versionNumber: number) => {
      try {
        await saveManualEdits();
        const client = createApiClient(getToken);
        const result = await client.versions.restore(projectId, versionNumber);
        const record = filesToRecord(result.files);

        justGeneratedRef.current = false;
        setFiles(record);
        currentFilesRef.current = record;
        lastSavedFilesRef.current = record;
        setActiveFile((prev) => pickActiveFile(record, prev));

        setProject((prev) =>
          prev
            ? {
                ...prev,
                currentVersion: result.currentVersion,
                updatedAt: new Date().toISOString(),
              }
            : prev,
        );
        setViewingVersion(null);
        setDiffState(null);

        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-system`,
            role: "system",
            content: `Restored to version ${versionNumber}`,
            timestamp: new Date().toISOString(),
            versionNumber: result.currentVersion,
          },
        ]);
        refreshVersions();
        toast.success(`Restored version ${versionNumber}`);
      } catch (error) {
        console.error("Failed to restore version:", error);
        toast.error(`Failed to restore version ${versionNumber}`);
      }
    },
    [saveManualEdits, getToken, projectId, refreshVersions],
  );

  // ---------------------------------------------------------------
  // Chat / generation
  // ---------------------------------------------------------------

  /**
   * Handles sending a new chat message via SSE streaming.
   * Connects to POST /api/chat/:projectId, streams the AI response
   * chunk by chunk, and updates files when generation completes.
   */
  const handleSendMessage = useCallback(
    async (
      content: string,
      images?: ImageAttachment[],
      isAutoHeal?: boolean,
    ) => {
      if (isStreamingRef.current) return;

      // Reset auto-heal counters on normal user messages
      if (!isAutoHeal) {
        autoHealAttemptRef.current = 0;
        autoHealPerErrorRef.current.clear();
      }
      if (autoHealTimerRef.current) {
        clearTimeout(autoHealTimerRef.current);
        autoHealTimerRef.current = null;
      }

      // If viewing an old version, go back to current first
      if (viewingVersionRef.current !== null) {
        handleBackToCurrent();
      }

      // Mark that we're starting a new generation (not yet complete)
      justGeneratedRef.current = false;
      isStreamingRef.current = true;
      setIsStreaming(true);

      // Create the user message and add to chat
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
        images: images && images.length > 0 ? images : undefined,
      };

      // Create an empty AI message that will be filled by streaming chunks
      const aiMessageId = `msg-${Date.now()}-assistant`;
      const aiMessage: ChatMessage = {
        id: aiMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        model: selectedModelId,
      };
      setMessages((prev) => [...prev, userMessage, aiMessage]);

      const updateAiMessage = (patch: (msg: ChatMessage) => ChatMessage) =>
        setMessages((prev) =>
          prev.map((msg) => (msg.id === aiMessageId ? patch(msg) : msg)),
        );

      try {
        // The AI builds on the latest SAVED version — persist edits first
        await saveManualEdits();

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
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
            retryAfter?: number;
          };

          if (response.status === 429) {
            window.dispatchEvent(
              new CustomEvent("rate-limited", {
                detail: { retryAfter: errorBody.retryAfter ?? 60 },
              }),
            );
          }
          if (errorBody.code === "CREDITS_EXHAUSTED") {
            setCreditsRemaining(0);
          }
          if (errorBody.code === "PREMIUM_MODEL_LOCKED") {
            setSelectedModelId(DEFAULT_MODEL_ID);
          }

          throw new Error(
            errorBody.error || `Request failed with status ${response.status}`,
          );
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
            // Only data lines carry payloads; event names are implied by shape
            if (!line.startsWith("data: ")) continue;

            const data = line.slice(6);
            if (!data) continue;

            let event: {
              text?: string;
              files?: ProjectFile[];
              versionId?: string;
              changedFiles?: string[];
              creditsRemaining?: number;
              code?: string;
              message?: string;
            };
            try {
              event = JSON.parse(data);
            } catch {
              continue; // Skip unparseable lines
            }

            // Chunk events – append text to AI message
            if (event.text !== undefined) {
              const text = event.text;
              updateAiMessage((msg) => ({
                ...msg,
                content: msg.content + text,
              }));
            }

            // Files event – update Sandpack + Monaco
            if (event.files) {
              const newFiles = filesToRecord(event.files);
              clearAutoSaveTimers();
              setFiles(newFiles);
              currentFilesRef.current = newFiles;
              lastSavedFilesRef.current = newFiles;
              setActiveFile((prev) => pickActiveFile(newFiles, prev));
              // Enables auto-heal. Set here (not on "done") because Sandpack
              // evaluates files immediately and may error before "done" arrives.
              justGeneratedRef.current = true;
            }

            // Done event – version info and credits
            if (event.creditsRemaining !== undefined) {
              setCreditsRemaining(event.creditsRemaining);
            }

            if (event.versionId) {
              const changed = event.changedFiles ?? [];
              const versionNumber = parseInt(
                event.versionId.replace("v", ""),
                10,
              );
              updateAiMessage((msg) => ({
                ...msg,
                versionNumber: changed.length > 0 ? versionNumber : undefined,
                changedFiles: changed.length > 0 ? changed : undefined,
              }));

              if (changed.length > 0 && !isNaN(versionNumber)) {
                setProject((prev) =>
                  prev
                    ? {
                        ...prev,
                        currentVersion: versionNumber,
                        updatedAt: new Date().toISOString(),
                      }
                    : prev,
                );
                refreshVersions();
              }
            }

            // Error events from the stream
            if (event.code && event.message) {
              if (event.code === "RATE_LIMITED") {
                window.dispatchEvent(
                  new CustomEvent("rate-limited", {
                    detail: { retryAfter: 60 },
                  }),
                );
              }
              const message = event.message;
              updateAiMessage((msg) => ({
                ...msg,
                content: `Error: ${message}`,
              }));
              toast.error(message);
            }
          }
        }
      } catch (error) {
        // Network, auth or request errors
        const errorMessage =
          error instanceof Error ? error.message : "Something went wrong";

        updateAiMessage((msg) => ({ ...msg, content: `Error: ${errorMessage}` }));
        toast.error(errorMessage);
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    [
      selectedModelId,
      getToken,
      projectId,
      handleBackToCurrent,
      refreshVersions,
      saveManualEdits,
      clearAutoSaveTimers,
    ],
  );

  // Keep the ref in sync so deferred callers always use the latest version
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  // Auto-send the prompt typed on the dashboard, once loading finishes
  useEffect(() => {
    if (isLoading || !pendingPromptRef.current) return;
    const prompt = pendingPromptRef.current;
    pendingPromptRef.current = null;
    handleSendMessageRef.current(prompt);
  }, [isLoading]);

  // ---------------------------------------------------------------
  // Auto-heal: send preview errors after an AI generation back to the AI
  // ---------------------------------------------------------------

  const isCreditsExhaustedRef = useRef(isCreditsExhausted);
  useEffect(() => {
    isCreditsExhaustedRef.current = isCreditsExhausted;
  }, [isCreditsExhausted]);

  const handleSandpackError = useCallback((error: PreviewError) => {
    // Only heal errors introduced by an AI generation in the current version
    if (
      !justGeneratedRef.current ||
      isStreamingRef.current ||
      viewingVersionRef.current !== null ||
      isCreditsExhaustedRef.current
    ) {
      return;
    }

    const errorText = error.message.trim().slice(0, MAX_ERROR_CHARS);
    if (!errorText) return;
    const key = `${error.path ?? ""}::${errorText}`;

    const perError = autoHealPerErrorRef.current.get(key) ?? 0;
    if (
      perError >= MAX_AUTO_HEAL_ATTEMPTS ||
      autoHealAttemptRef.current >= MAX_AUTO_HEAL_ATTEMPTS
    ) {
      return;
    }

    // Debounce: Sandpack can report transient errors while files swap in
    if (autoHealTimerRef.current) clearTimeout(autoHealTimerRef.current);
    autoHealTimerRef.current = setTimeout(() => {
      autoHealTimerRef.current = null;
      if (!justGeneratedRef.current || isStreamingRef.current) return;

      autoHealAttemptRef.current += 1;
      autoHealPerErrorRef.current.set(key, perError + 1);
      const attempt = autoHealAttemptRef.current;

      const fileLine = error.path ? `\nAffected file: ${error.path}` : "";
      const prompt =
        `${AUTO_HEAL_PREFIX} (attempt ${attempt}/${MAX_AUTO_HEAL_ATTEMPTS}). ` +
        `Please fix it with the smallest change that resolves the error, ` +
        `and keep the existing functionality.${fileLine}\n\nError:\n${errorText}`;

      handleSendMessageRef.current(prompt, undefined, true);
    }, AUTO_HEAL_SETTLE_MS);
  }, []);

  // Clear any pending auto-heal on unmount
  useEffect(
    () => () => {
      if (autoHealTimerRef.current) clearTimeout(autoHealTimerRef.current);
    },
    [],
  );

  if (isLoading) return <EditorLayoutSkeleton />;

  const currentVersion = project?.currentVersion ?? 0;
  const isViewingOldVersion = viewingVersion !== null;

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
      creditsResetDays={
        creditsPeriodEnd ? daysUntil(creditsPeriodEnd) : undefined
      }
      isCreditsExhausted={isCreditsExhausted}
      selectedModelId={selectedModelId}
      userPlan={userPlan}
      viewingVersion={viewingVersion}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      previewPanel={
        <PreviewPanel files={files} onError={handleSandpackError} />
      }
      codeEditorPanel={
        <CodeEditorPanel
          files={files}
          activeFile={activeFile}
          onActiveFileChange={setActiveFile}
          onFileContentChange={handleFileContentChange}
          readOnly={isViewingOldVersion}
        />
      }
      historyPanel={
        diffState ? (
          <VersionDiff
            from={diffState.from}
            to={diffState.to}
            changes={diffState.changes}
            onClose={() => setDiffState(null)}
          />
        ) : (
          <VersionTimeline
            versions={versions}
            currentVersion={currentVersion}
            viewingVersion={viewingVersion}
            onViewVersion={handleViewVersion}
            onRestoreVersion={handleRestoreVersion}
            onCompareVersions={handleCompareVersions}
            isLoading={isLoadingVersions}
          />
        )
      }
      onSendMessage={handleSendMessage}
      onFilesChange={handleFilesChange}
      onActiveFileChange={setActiveFile}
      onModelChange={handleModelChange}
      onRename={handleRename}
      onDelete={handleDelete}
      onBackToCurrent={handleBackToCurrent}
      onBeforeOpenPreview={saveManualEdits}
    />
  );
};

function EditorLayoutSkeleton() {
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
