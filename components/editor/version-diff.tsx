"use client";

/**
 * components/editor/version-diff.tsx
 *
 * Side-by-side Monaco diff for two versions. Loaded with next/dynamic
 * (ssr: false) from the project page.
 */

import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ArrowLeft, FileMinus, FilePen, FilePlus } from "lucide-react";
import type { FileChange } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";
import { configureMonacoTypescript, getLanguageFromPath } from "./code-editor-panel";

export interface VersionDiffProps {
  from: number;
  to: number;
  changes: FileChange[];
  onClose: () => void;
}

const CHANGE_STYLE = {
  added: { icon: FilePlus, className: "text-emerald-500", label: "Added" },
  removed: { icon: FileMinus, className: "text-red-500", label: "Removed" },
  modified: { icon: FilePen, className: "text-amber-500", label: "Modified" },
} as const;

export function VersionDiff({ from, to, changes, onClose }: VersionDiffProps) {
  const { resolvedTheme } = useTheme();
  const [selectedPath, setSelectedPath] = useState<string | null>(
    changes[0]?.path ?? null,
  );
  const selected = changes.find((c) => c.path === selectedPath) ?? changes[0];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={onClose}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        <h2 className="text-sm font-semibold">
          v{from} → v{to}
        </h2>
        <span className="text-xs text-muted-foreground">
          {changes.length} {changes.length === 1 ? "file" : "files"} changed
        </span>
      </div>

      {changes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          No differences found between version {from} and {to}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* File selector */}
          <ScrollArea className="max-h-40 shrink-0 border-b border-border md:max-h-none md:w-56 md:border-b-0 md:border-r">
            <div className="p-1.5">
              {changes.map((change) => {
                const style = CHANGE_STYLE[change.type];
                const Icon = style.icon;
                return (
                  <button
                    key={change.path}
                    type="button"
                    onClick={() => setSelectedPath(change.path)}
                    title={`${style.label}: ${change.path}`}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                      selected?.path === change.path
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-3.5 shrink-0", style.className)} />
                    <span className="truncate font-mono">{change.path}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* Diff */}
          <div className="min-h-0 min-w-0 flex-1">
            {selected && (
              <DiffEditor
                height="100%"
                original={selected.oldContent ?? ""}
                modified={selected.newContent ?? ""}
                language={getLanguageFromPath(selected.path)}
                originalModelPath={`diff/v${from}/${selected.path}`}
                modifiedModelPath={`diff/v${to}/${selected.path}`}
                theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                beforeMount={configureMonacoTypescript}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default VersionDiff;
