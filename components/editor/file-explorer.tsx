"use client";

import { memo, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onFileSelect: (path: string) => void;
}

export interface TreeNode {
  name: string;
  path: string;
  /** Present for folders, absent for files */
  children?: TreeNode[];
}

/** Sorts recursively: folders first, then alphabetical by name. */
function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) =>
      node.children ? { ...node, children: sortTree(node.children) } : node,
    )
    .sort((a, b) => {
      const aIsFolder = a.children ? 0 : 1;
      const bIsFolder = b.children ? 0 : 1;
      return aIsFolder - bIsFolder || a.name.localeCompare(b.name);
    });
}

/** Builds a nested tree from flat paths like "src/components/Button.tsx". */
export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const fullPath of paths) {
    const parts = fullPath.split("/").filter(Boolean);
    let level = root;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let node = level.find((n) => n.name === part && !!n.children === !isFile);

      if (!node) {
        node = isFile ? { name: part, path } : { name: part, path, children: [] };
        level.push(node);
      }
      if (node.children) level = node.children;
    });
  }

  return sortTree(root);
}

/** Small file-type icon by extension */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") {
    return <FileJson className={cn("size-3.5 text-amber-500", className)} />;
  }
  if (ext === "md" || ext === "txt") {
    return <FileText className={cn("size-3.5 text-muted-foreground", className)} />;
  }
  if (ext === "css") {
    return <FileCode2 className={cn("size-3.5 text-sky-500", className)} />;
  }
  return <FileCode2 className={cn("size-3.5 text-blue-500", className)} />;
}

function TreeNodeItem({
  node,
  depth,
  activeFile,
  onFileSelect,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onFileSelect: (path: string) => void;
}) {
  // Folders containing the active file start open; top-level folders too.
  const [isOpen, setIsOpen] = useState(
    () => depth === 0 || activeFile.startsWith(`${node.path}/`),
  );
  const indent = { paddingLeft: 8 + depth * 12 };

  if (node.children) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          style={indent}
        >
          {isOpen ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          {isOpen ? (
            <FolderOpen className="size-3.5 shrink-0 text-primary/70" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-primary/70" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen &&
          node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onFileSelect={onFileSelect}
            />
          ))}
      </div>
    );
  }

  const isActive = node.path === activeFile;
  return (
    <button
      type="button"
      onClick={() => onFileSelect(node.path)}
      title={node.path}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs transition-colors",
        isActive
          ? "bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
      // Files have no chevron — shift right so icons line up with folder icons
      style={{ paddingLeft: indent.paddingLeft + 16 }}
    >
      <FileIcon name={node.name} className="shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function FileExplorerImpl({ files, activeFile, onFileSelect }: FileExplorerProps) {
  const pathsKey = Object.keys(files).sort().join("\n");
  const tree = useMemo(
    () => buildFileTree(pathsKey ? pathsKey.split("\n") : []),
    [pathsKey],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Files
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {tree.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No files</p>
          ) : (
            tree.map((node) => (
              <TreeNodeItem
                key={node.path}
                node={node}
                depth={0}
                activeFile={activeFile}
                onFileSelect={onFileSelect}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export const FileExplorer = memo(FileExplorerImpl);
