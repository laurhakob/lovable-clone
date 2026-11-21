"use client";
import React, { useCallback, useEffect, useState } from "react";
import { EditorHeader } from "./editor-header";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";
import { ChatMessage, ImageAttachment } from "@/types/chat";
import { DeviceMode } from "./device-toggle";
import { EditorTabValue } from "./editor-tabs";
import { PanelErrorBoundary } from "./panel-error-boundary";

export interface EditorLayoutProps {
  projectId: string;
  projectName: string;
  files: Record<string, string>;
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (message: string, images?: ImageAttachment[]) => void;
  onFilesChange: (files: Record<string, string>) => void;
  activeFile: string;
  onActiveFileChange: (filePath: string) => void;
  previewPanel: React.ReactNode;
  codeEditorPanel: React.ReactNode;
  historyPanel?: React.ReactNode;
  viewingVersion?: number | null;
  onBackToCurrent?: () => void;
  onRestoreViewing?: () => void;
  creditsRemaining?: number;
  creditsTotal?: number;
  isCreditsExhausted?: boolean;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  userPlan: "free" | "pro";
  onRename: (newName: string) => void;
  onDelete: () => void;
  /** Days until free credits reset (free plan only) */
  creditsResetDays?: number;
  /** Called before the preview opens in a new tab (flush unsaved edits) */
  onBeforeOpenPreview?: () => Promise<void> | void;
  /** Lets the page switch tabs, e.g. to "preview" when viewing a version */
  activeTab?: EditorTabValue;
  onActiveTabChange?: (tab: EditorTabValue) => void;
}

/** Minimum and maximum width for the chat panel in percent */
const MIN_CHAT_PERCENT = 20;
const MAX_CHAT_PERCENT = 50;
const DEFAULT_CHAT_PERCENT = 30;

/** Absolute pixel minimum for the chat panel — prevents collapse */
const MIN_CHAT_PX = 320;

export const EditorLayout = ({
  projectId,
  projectName,
  files,
  messages,
  isStreaming,
  onSendMessage,
  previewPanel,
  codeEditorPanel,
  historyPanel,
  viewingVersion,
  onBackToCurrent,
  onRestoreViewing,
  creditsRemaining,
  creditsTotal,
  isCreditsExhausted,
  selectedModelId,
  onModelChange,
  userPlan,
  onRename,
  onDelete,
  creditsResetDays,
  onBeforeOpenPreview,
  activeTab: controlledTab,
  onActiveTabChange,
}: EditorLayoutProps) => {
  const [uncontrolledTab, setUncontrolledTab] =
    useState<EditorTabValue>("preview");
  const activeTab = controlledTab ?? uncontrolledTab;
  const setActiveTab = useCallback(
    (tab: EditorTabValue) => {
      setUncontrolledTab(tab);
      onActiveTabChange?.(tab);
    },
    [onActiveTabChange],
  );
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [chatWidthPercent, setChatWidthPercent] = useState(
    DEFAULT_CHAT_PERCENT,
  );

  const [mobilePanel, setMobilePanel] = useState<"chat" | "content">("chat");

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerWidth = entry.contentRect.width;
        if (containerWidth <= 0) return;

        const minPercent = (MIN_CHAT_PX / containerWidth) * 100;
        setChatWidthPercent((prev) =>
          prev < minPercent ? Math.min(minPercent, MAX_CHAT_PERCENT) : prev,
        );
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newPercent =
        ((event.clientX - containerRect.left) / containerRect.width) * 100;

      // Compute the pixel-based minimum as a percentage of the container
      const minPercentFromPx = (MIN_CHAT_PX / containerRect.width) * 100;

      // Clamp: respect both the percentage min and the pixel min
      const effectiveMin = Math.max(MIN_CHAT_PERCENT, minPercentFromPx);
      const clamped = Math.min(
        MAX_CHAT_PERCENT,
        Math.max(effectiveMin, newPercent),
      );
      setChatWidthPercent(clamped);
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      setIsDragging(false);
    },
    [],
  );

  return (
    <div className=" flex h-full w-full flex-col overflow-hidden">
      <EditorHeader
        projectName={projectName}
        files={files}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        mobilePanel={mobilePanel}
        onMobilePanelChange={setMobilePanel}
        projectId={projectId}
        userPlan={userPlan}
        creditsRemaining={creditsRemaining}
        creditsTotal={creditsTotal}
        onDelete={onDelete}
        onRename={onRename}
        deviceMode={deviceMode}
        onDeviceModeChange={setDeviceMode}
        onBeforeOpenPreview={onBeforeOpenPreview}
        viewingVersion={viewingVersion}
        onBackToCurrent={onBackToCurrent}
      />

      {/*
        One responsive tree for desktop and mobile, so the preview (Sandpack)
        and editor (Monaco) are mounted exactly once. On mobile the header's
        Chat/Preview toggle shows one side at a time.
      */}
      <div
        className={cn(
          "flex flex-1 overflow-hidden",
          isDragging && "select-none",
        )}
        ref={containerRef}
      >
        <div
          className={cn(
            "w-full shrink-0 overflow-hidden md:block md:w-(--chat-width) md:min-w-[320px]",
            mobilePanel === "chat" ? "block" : "hidden",
          )}
          style={
            { "--chat-width": `${chatWidthPercent}%` } as React.CSSProperties
          }
        >
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            onSendMessage={onSendMessage}
            creditsRemaining={creditsRemaining}
            creditsTotal={creditsTotal}
            creditsResetDays={creditsResetDays}
            isCreditsExhausted={isCreditsExhausted}
            selectedModelId={selectedModelId}
            onModelChange={onModelChange}
            userPlan={userPlan}
          />
        </div>

        {/* Drag Handle (desktop only) */}
        <div
          className={cn(
            "panel-resize-handle hidden shrink-0 md:block",
            isDragging && "panel-resize-handle--active",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className={cn(
            "relative flex-1 overflow-hidden md:block",
            mobilePanel === "content" ? "block" : "hidden",
          )}
        >
          <div
            className={cn(
              "absolute inset-0 transition-all duration-200",
              activeTab === "preview" ? "z-10 visible" : "z-0 invisible",
              deviceMode !== "desktop"
                ? "flex items-start justify-center overflow-auto bg-muted/30 p-6"
                : "",
            )}
          >
            <div
              className={cn(
                "h-full max-w-full transition-all duration-200",
                deviceMode !== "desktop"
                  ? "shrink-0 overflow-hidden rounded-lg border border-border shadow-lg"
                  : "w-full",
              )}
              style={
                deviceMode !== "desktop"
                  ? { width: deviceMode === "tablet" ? 768 : 375 }
                  : undefined
              }
            >
              <PanelErrorBoundary name="Preview">
                {previewPanel}
              </PanelErrorBoundary>
            </div>
          </div>
          <div
            className={cn(
              "absolute inset-0",
              activeTab === "code" ? "z-10 visible" : "z-0 invisible",
            )}
          >
            <PanelErrorBoundary name="Code Editor">
              {codeEditorPanel}
            </PanelErrorBoundary>
          </div>
          {historyPanel && (
            <div
              className={cn(
                "absolute inset-0 bg-background",
                activeTab === "history" ? "z-10 visible" : "z-0 invisible",
              )}
            >
              <PanelErrorBoundary name="History">
                {historyPanel}
              </PanelErrorBoundary>
            </div>
          )}

          {isDragging && (
            <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
        </div>
      </div>
    </div>
  );
};