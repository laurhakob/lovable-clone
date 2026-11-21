"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Eye,
  FileCode,
  GitCompare,
  History,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { VersionMeta } from "@/types/project";
import { getModelById } from "@/lib/models";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface VersionTimelineProps {
  versions: VersionMeta[];
  currentVersion: number;
  viewingVersion: number | null;
  onViewVersion: (versionNumber: number) => void;
  onRestoreVersion: (versionNumber: number) => void;
  onCompareVersions: (from: number, to: number) => void;
  isLoading: boolean;
}

const TYPE_CONFIG = {
  ai: { label: "AI generation", icon: Bot, variant: "default" },
  manual: { label: "Manual edit", icon: Pencil, variant: "secondary" },
  restore: { label: "Restored", icon: RotateCcw, variant: "outline" },
} as const;

/** "just now", "5m ago", "3h ago", "2d ago", then a date */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function truncatePrompt(prompt: string, max = 60): string {
  if (prompt.length <= max) return prompt;
  return prompt.slice(0, max - 3) + "...";
}

export function VersionTimelineSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-border px-4">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function VersionTimeline({
  versions,
  currentVersion,
  viewingVersion,
  onViewVersion,
  onRestoreVersion,
  onCompareVersions,
  isLoading,
}: VersionTimelineProps) {
  const currentRef = useRef<HTMLDivElement>(null);
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);

  // Legacy snapshots may lack metadata — skip anything without a versionNumber
  const validVersions = versions
    .filter((v) => typeof v.versionNumber === "number")
    .sort((a, b) => b.versionNumber - a.versionNumber);

  useEffect(() => {
    if (!isLoading) {
      currentRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isLoading]);

  if (isLoading) return <VersionTimelineSkeleton />;

  const previousVersion = validVersions.find(
    (v) => v.versionNumber < currentVersion,
  )?.versionNumber;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" />
          Version History
        </h2>
        {validVersions.length >= 2 && previousVersion !== undefined && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onCompareVersions(previousVersion, currentVersion)}
            title={`Compare v${previousVersion} with v${currentVersion}`}
          >
            <GitCompare className="size-3.5" />
            Compare
          </Button>
        )}
      </div>

      {validVersions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          No version history yet. Send a message to generate your first
          version.
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="relative space-y-2 p-4">
            {validVersions.map((version) => {
              const config = TYPE_CONFIG[version.type] ?? TYPE_CONFIG.manual;
              const Icon = config.icon;
              const isCurrent = version.versionNumber === currentVersion;
              const isViewing = version.versionNumber === viewingVersion;
              const modelName = version.model
                ? (getModelById(version.model)?.name ?? version.model)
                : null;

              return (
                <div
                  key={version.versionNumber}
                  ref={isCurrent ? currentRef : undefined}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    isViewing
                      ? "border-primary/50 bg-primary/5"
                      : isCurrent
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-border hover:border-border/80 hover:bg-secondary/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums">
                      v{version.versionNumber}
                    </span>
                    <Badge variant={config.variant} className="gap-1">
                      <Icon className="size-3" />
                      {config.label}
                    </Badge>
                    {isCurrent && (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-500">
                        Current
                      </span>
                    )}
                    {isViewing && (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                        Viewing
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {formatRelativeTime(version.createdAt)}
                    </span>
                  </div>

                  {version.prompt && (
                    <p
                      className="mt-1.5 text-xs text-foreground/80"
                      title={version.prompt}
                    >
                      {truncatePrompt(version.prompt)}
                    </p>
                  )}

                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    {modelName && version.type === "ai" && (
                      <span className="flex items-center gap-1">
                        <Bot className="size-3" />
                        {modelName}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <FileCode className="size-3" />
                      {version.fileCount}{" "}
                      {version.fileCount === 1 ? "file" : "files"}
                    </span>
                  </div>

                  {!isCurrent && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onViewVersion(version.versionNumber)}
                      >
                        <Eye className="size-3" />
                        {isViewing ? "Viewing" : "View"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => setRestoreTarget(version.versionNumber)}
                      >
                        <RotateCcw className="size-3" />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() =>
                          onCompareVersions(
                            version.versionNumber,
                            currentVersion,
                          )
                        }
                      >
                        <GitCompare className="size-3" />
                        Compare with current
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore version {restoreTarget}?</DialogTitle>
            <DialogDescription>
              This creates a new version (v{currentVersion + 1}) with the files
              from version {restoreTarget}. Your current version stays in the
              history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (restoreTarget !== null) onRestoreVersion(restoreTarget);
                setRestoreTarget(null);
              }}
            >
              <RotateCcw className="size-3.5" />
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
