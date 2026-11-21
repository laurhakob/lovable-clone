"use client";

/**
 * components/editor/preview-panel.tsx
 *
 * Live Sandpack preview of the project files. Reports bundler/runtime
 * errors via `onError` so the project page can auto-heal them.
 *
 * Loaded with next/dynamic (ssr: false) from the project page.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import {
  extractDependencies,
  toSandpackFiles,
} from "@/components/dashboard/project-preview";
import { useTheme } from "@/components/theme-provider";

export { extractDependencies, toSandpackFiles };

export interface PreviewError {
  message: string;
  /** Project-relative path of the failing file, when Sandpack reports one */
  path?: string;
}

export interface PreviewPanelProps {
  files: Record<string, string>;
  onError?: (error: PreviewError) => void;
}

/** Brand name shown in the preview badge */
const APP_NAME = "Lovable Clone";

/** Maps a Sandpack path ("/App.tsx") back to a project path ("src/App.tsx") */
function toProjectPath(
  sandpackPath: string | undefined,
  files: Record<string, string>,
): string | undefined {
  if (!sandpackPath) return undefined;
  const trimmed = sandpackPath.replace(/^\//, "");
  if (files[`src/${trimmed}`] !== undefined) return `src/${trimmed}`;
  if (files[trimmed] !== undefined) return trimmed;
  return trimmed;
}

/**
 * Subscribes to Sandpack bundler/runtime errors and forwards each distinct
 * error once. Renders nothing.
 */
function ErrorListener({
  onError,
  files,
}: {
  onError: (error: PreviewError) => void;
  files: Record<string, string>;
}) {
  const { listen } = useSandpack();
  const lastErrorRef = useRef<string | null>(null);
  const filesRef = useRef(files);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    filesRef.current = files;
    // New files → a repeat of the same error is meaningful again
    lastErrorRef.current = null;
  }, [files]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const report = useCallback((message: string, path?: string) => {
    const key = `${path ?? ""}::${message}`;
    if (lastErrorRef.current === key) return;
    lastErrorRef.current = key;
    onErrorRef.current({
      message,
      path: toProjectPath(path, filesRef.current),
    });
  }, []);

  useEffect(() => {
    const unsubscribe = listen((msg) => {
      if (msg.type === "action" && msg.action === "show-error") {
        const text = [msg.title, msg.message].filter(Boolean).join(": ");
        report(text || "Unknown error", msg.path);
      } else if (
        msg.type === "action" &&
        msg.action === "notification" &&
        msg.notificationType === "error"
      ) {
        report(msg.title);
      } else if (msg.type === "done" && !msg.compilatonError) {
        // Successful build — allow the next identical error to be reported
        lastErrorRef.current = null;
      }
    });
    return unsubscribe;
  }, [listen, report]);

  return null;
}

function BuiltWithBadge() {
  return (
    <Link
      href="/dashboard"
      target="_blank"
      className="mr-1 flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur transition-opacity hover:opacity-80"
    >
      <img src="/logo.svg" alt="" className="size-3.5" />
      Built with {APP_NAME}
    </Link>
  );
}

function PreviewPanelImpl({ files, onError }: PreviewPanelProps) {
  const { resolvedTheme } = useTheme();

  const sandpackFiles = useMemo(() => {
    const result = toSandpackFiles(files);
    // Dependencies go through customSetup; replacing the template's
    // package.json would also drop its entry point.
    delete result["/package.json"];
    return result;
  }, [files]);

  const dependencies = useMemo(() => extractDependencies(files), [files]);

  return (
    <div className="sandpack-stretch h-full w-full">
      <SandpackProvider
        template="react-ts"
        theme={resolvedTheme}
        files={sandpackFiles}
        options={{ externalResources: ["https://cdn.tailwindcss.com"] }}
        customSetup={{ dependencies }}
      >
        {onError && <ErrorListener onError={onError} files={files} />}
        <SandpackLayout
          style={{ height: "100%", border: "none", borderRadius: 0 }}
        >
          <SandpackPreview
            showNavigator
            showRefreshButton
            showOpenInCodeSandbox={false}
            actionsChildren={<BuiltWithBadge />}
            style={{ height: "100%" }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}

export const PreviewPanel = memo(PreviewPanelImpl);
export default PreviewPanel;
