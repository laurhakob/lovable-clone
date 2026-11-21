"use client";

/**
 * Full-screen live preview of a project's latest saved version.
 * Opened in a new tab from the editor header's "Preview" button.
 */

import { use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { createApiClient } from "@/lib/api-client";
import { PreviewSkeleton } from "@/components/editor/preview-skeleton";

const PreviewPanel = dynamic(
  () => import("@/components/editor/preview-panel").then((m) => m.PreviewPanel),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

export default function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { getToken } = useAuth();
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { files: projectFiles } =
          await createApiClient(getToken).projects.getFiles(projectId);
        if (cancelled) return;
        setFiles(
          Object.fromEntries(projectFiles.map((f) => [f.path, f.content])),
        );
      } catch (err) {
        console.error("Failed to load preview:", err);
        if (!cancelled) setError("Couldn't load this project's preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, projectId]);

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        {error}
        <Link
          href={`/project/${projectId}`}
          className="flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Back to editor
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen w-full">
      {files ? <PreviewPanel files={files} /> : <PreviewSkeleton />}
    </div>
  );
}
