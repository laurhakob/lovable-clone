"use client";

import React, { useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  Download,
  ExternalLink,
  Eye,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { UpgradeCta } from "./upgrade-cta";
import { DeviceMode, DeviceToggle } from "./device-toggle";
import { EditorTabValue, EditorTabs } from "./editor-tabs";
import { ProjectMenu } from "./project-menu";

export interface EditorHeaderProps {
  projectName: string;
  files: Record<string, string>;
  activeTab: EditorTabValue;
  onTabChange: (tab: EditorTabValue) => void;
  mobilePanel: "chat" | "content";
  onMobilePanelChange: (panel: "chat" | "content") => void;
  projectId: string;
  userPlan: "free" | "pro";
  creditsRemaining?: number;
  creditsTotal?: number;
  onRename: (newName: string) => void;
  onDelete: () => void;
  deviceMode: DeviceMode;
  onDeviceModeChange: (mode: DeviceMode) => void;
  /** Called before opening the preview tab, e.g. to flush unsaved edits */
  onBeforeOpenPreview?: () => Promise<void> | void;
  /** Version number being viewed read-only, if any */
  viewingVersion?: number | null;
  onBackToCurrent?: () => void;
}

export function EditorHeader({
  projectName,
  files,
  activeTab,
  onTabChange,
  mobilePanel,
  onMobilePanelChange,
  projectId,
  userPlan,
  creditsRemaining,
  creditsTotal,
  onRename,
  onDelete,
  deviceMode,
  onDeviceModeChange,
  onBeforeOpenPreview,
  viewingVersion,
  onBackToCurrent,
}: EditorHeaderProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportGateOpen, setIsExportGateOpen] = useState(false);

  /**
   * Opens a full-screen preview in a new tab. The tab is opened synchronously
   * (so popup blockers allow it), then pointed at the preview route once any
   * pending manual edits have been saved.
   */
  async function handleOpenPreview() {
    const previewUrl = `/project/${projectId}/preview`;
    const tab = window.open("about:blank", "_blank");
    setIsOpening(true);
    try {
      await onBeforeOpenPreview?.();
    } catch (error) {
      console.error("Failed to save before opening preview:", error);
    } finally {
      setIsOpening(false);
    }
    if (tab) {
      tab.location.href = previewUrl;
    } else {
      window.location.href = previewUrl;
    }
  }

  async function handleExport() {
    if (userPlan !== "pro") {
      setIsExportGateOpen(true);
      return;
    }
    setIsExporting(true);
    try {
      await downloadProjectZip(projectName, files);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-background px-1.5 sm:px-3">
      <div className="flex items-center gap-1.5 sm:gap-3">
        <Link
          href="/dashboard"
          className="shrink-0 transition-opacity duration-150 hover:opacity-80"
          aria-label="Go to dashboard"
        >
          <img
            src="/logo.svg"
            alt="Lovable Clone"
            className="size-6 sm:size-7"
          />
        </Link>

        <div className="flex flex-col">
          <ProjectMenu
            projectName={projectName}
            projectId={projectId}
            creditsRemaining={creditsRemaining}
            creditsTotal={creditsTotal}
            userPlan={userPlan}
            onRename={onRename}
            onDelete={onDelete}
          />
          {viewingVersion !== null && viewingVersion !== undefined ? (
            <span className="hidden items-center gap-1.5 px-1.5 text-xs text-amber-500 sm:flex">
              Viewing version {viewingVersion} (read-only)
              {onBackToCurrent && (
                <button
                  type="button"
                  onClick={onBackToCurrent}
                  className="font-medium underline underline-offset-2 hover:text-amber-400"
                >
                  Back to current
                </button>
              )}
            </span>
          ) : (
            <span className="hidden px-1.5 text-xs text-muted-foreground sm:block">
              Previewing last saved version
            </span>
          )}
        </div>
      </div>
      <div className="hidden md:block absolute left-1/2 -translate-x-1/2">
        <EditorTabs activeTab={activeTab} onTabChange={onTabChange} />
      </div>
      <div className="mx-auto md:hidden">
        <div className="flex items-center gap-0.5 rounded-full bg-secondary/60 p-0.5">
          {/* Chat tab */}
          <button
            onClick={() => onMobilePanelChange("chat")}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150",
              mobilePanel === "chat"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquare className="size-3" />
            Chat
          </button>

          {/* Preview tab */}
          <button
            onClick={() => {
              onTabChange("preview");
              onMobilePanelChange("content");
            }}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150",
              mobilePanel === "content"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="size-3" />
            Preview
          </button>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {activeTab === "preview" && (
          <div className="hidden md:flex items-center gap-1.5">
            <DeviceToggle
              deviceMode={deviceMode}
              onDeviceModeChange={onDeviceModeChange}
            />
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenPreview}
          disabled={isOpening}
          className="gap-1.5 text-xs"
          title="Open live preview in new tab"
        >
          {isOpening ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          <span className="hidden sm:inline">Preview</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={isExporting}
          className="gap-1.5 text-xs"
          title={
            userPlan === "pro"
              ? "Download project as .zip"
              : "Export is available on Pro"
          }
        >
          {isExporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          <span className="hidden sm:inline">Export</span>
        </Button>
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "size-6 sm:size-7",
            },
          }}
        />
      </div>

      <Dialog open={isExportGateOpen} onOpenChange={setIsExportGateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Upgrade to export</DialogTitle>
          <UpgradeCta
            reason="Exporting projects as a .zip is a Pro feature"
            className="border-none bg-transparent p-0"
          />
        </DialogContent>
      </Dialog>
    </header>
  );
}

/** Zips the project files and triggers a browser download. */
async function downloadProjectZip(
  projectName: string,
  files: Record<string, string>,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folderName =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase() || "project";
  const folder = zip.folder(folderName) ?? zip;
  for (const [path, content] of Object.entries(files)) {
    folder.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folderName}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}