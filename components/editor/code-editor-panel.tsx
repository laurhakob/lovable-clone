"use client";

/**
 * components/editor/code-editor-panel.tsx
 *
 * Monaco code editor with a file explorer. Loaded with next/dynamic
 * (ssr: false) from the project page.
 */

import { useCallback, useRef } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { Lock } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { FileExplorer, FileIcon } from "./file-explorer";

export interface CodeEditorPanelProps {
  files: Record<string, string>;
  activeFile: string;
  onActiveFileChange: (path: string) => void;
  onFileContentChange: (path: string, content: string) => void;
  /** Shown while viewing an old version */
  readOnly?: boolean;
}

/** Maps a file path to a Monaco language id. */
export function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "ts":
      return "typescript";
    case "jsx":
    case "js":
      return "javascript";
    case "css":
      return "css";
    case "json":
      return "json";
    case "html":
      return "html";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}

/** Last path segment, e.g. "src/components/Nav.tsx" → "Nav.tsx". */
export function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * TS diagnostics that only mean "the editor can't see node_modules":
 * 2307/2792 missing module, 7016 missing declaration file, 2875 missing JSX
 * runtime, 7026 no JSX.IntrinsicElements, 2686 UMD React global.
 */
const IGNORED_DIAGNOSTICS = [2307, 2792, 7016, 2875, 7026, 2686];

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Configures the TypeScript/JavaScript language services. Newer Monaco
 * exposes them at `monaco.typescript`, older at `monaco.languages.typescript`;
 * the runtime loaded from the CDN may be either, so support both.
 */
export const configureMonacoTypescript: BeforeMount = (monaco) => {
  const ts: any =
    (monaco as any).typescript?.typescriptDefaults
      ? (monaco as any).typescript
      : (monaco.languages as any).typescript;
  if (!ts?.typescriptDefaults) return;

  const compilerOptions = {
    jsx: ts.JsxEmit?.ReactJSX ?? 4,
    target: ts.ScriptTarget?.ESNext ?? 99,
    module: ts.ModuleKind?.ESNext ?? 99,
    moduleResolution: ts.ModuleResolutionKind?.NodeJs ?? 2,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    isolatedModules: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
  };
  const diagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: IGNORED_DIAGNOSTICS,
  };

  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  ts.javascriptDefaults?.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults?.setDiagnosticsOptions(diagnostics);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function CodeEditorPanel({
  files,
  activeFile,
  onActiveFileChange,
  onFileContentChange,
  readOnly = false,
}: CodeEditorPanelProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || readOnly) return;
      onFileContentChange(activeFile, value);
    },
    [activeFile, onFileContentChange, readOnly],
  );

  const hasActiveFile = files[activeFile] !== undefined;

  return (
    <div className="flex h-full bg-background">
      <div className="hidden w-52 shrink-0 border-r border-border md:block">
        <FileExplorer
          files={files}
          activeFile={activeFile}
          onFileSelect={onActiveFileChange}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Active file tab */}
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-secondary/20">
          {/* Mobile: the explorer is hidden, so offer a file picker */}
          <select
            value={activeFile}
            onChange={(e) => onActiveFileChange(e.target.value)}
            className="h-full max-w-[60%] border-r border-border bg-background px-2 text-xs text-foreground md:hidden"
            aria-label="Select file"
          >
            {Object.keys(files)
              .sort()
              .map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
          </select>
          {hasActiveFile && (
            <div className="hidden h-full items-center gap-1.5 border-r border-border bg-background px-3 text-xs text-foreground md:flex">
              <FileIcon name={activeFile} />
              <span title={activeFile}>{getFileName(activeFile)}</span>
            </div>
          )}
          {readOnly && (
            <span className="ml-auto mr-3 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="size-3" />
              Read-only
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {hasActiveFile ? (
            <Editor
              height="100%"
              path={activeFile}
              language={getLanguageFromPath(activeFile)}
              value={files[activeFile]}
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              beforeMount={configureMonacoTypescript}
              onMount={handleMount}
              onChange={handleChange}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                tabSize: 2,
                readOnly,
                padding: { top: 12 },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to start editing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CodeEditorPanel;
