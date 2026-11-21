"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Bot, Pencil, RotateCcw } from "lucide-react";
import { createApiClient } from "@/lib/api-client";
import { AnalyticsData } from "@/types/analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/components/editor/version-timeline";

const ACTIVITY_TYPE = {
  ai: { label: "AI generation", icon: Bot, variant: "default" },
  manual: { label: "Manual edit", icon: Pencil, variant: "secondary" },
  restore: { label: "Restored", icon: RotateCcw, variant: "outline" },
} as const;

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {detail && (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createApiClient(getToken)
      .analytics.get()
      .then((result) => !cancelled && setData(result))
      .catch((err) => {
        console.error("Failed to load analytics:", err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (error) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Analytics are unavailable right now. Please try again later.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const isUnlimited = data.creditsTotal === -1;
  const maxCount = Math.max(1, ...data.modelBreakdown.map((m) => m.count));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your usage across all projects.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Projects" value={String(data.totalProjects)} />
        <StatTile
          label="AI generations"
          value={String(data.totalGenerations)}
        />
        <StatTile
          label="Manual edits · restores"
          value={`${data.totalManualEdits} · ${data.totalRestores}`}
        />
        <StatTile
          label="Credits this period"
          value={
            isUnlimited
              ? "Unlimited"
              : `${data.creditsUsed} / ${data.creditsTotal}`
          }
          detail={`${data.plan === "pro" ? "Pro" : "Free"} plan`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Generations by model</h2>
          {data.modelBreakdown.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No AI generations yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.modelBreakdown.map((model) => (
                <li
                  key={model.modelId}
                  title={`${model.modelName}: ${model.count} generations (${model.percentage}%)`}
                >
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-foreground">{model.modelName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {model.count} · {model.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full">
                    <div
                      className="h-full rounded-r bg-primary"
                      style={{ width: `${(model.count / maxCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          {data.recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing yet. Open a project and send a message.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {data.recentActivity.map((item, index) => {
                const type = ACTIVITY_TYPE[item.type] ?? ACTIVITY_TYPE.manual;
                const Icon = type.icon;
                return (
                  <li
                    key={`${item.projectId}-${item.createdAt}-${index}`}
                    className="flex items-center gap-3 py-2"
                  >
                    <Badge variant={type.variant} className="shrink-0 gap-1">
                      <Icon className="size-3" />
                      {type.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/project/${item.projectId}`}
                        className="text-xs font-medium hover:underline"
                      >
                        {item.projectName}
                      </Link>
                      {item.prompt && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.prompt}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-x-auto rounded-xl border border-border bg-card">
        <h2 className="px-4 pt-4 text-sm font-semibold">Projects</h2>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 text-right font-medium">Versions</th>
              <th className="px-4 py-2 text-right font-medium">AI generations</th>
              <th className="px-4 py-2 text-right font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {data.projectStats.map((p) => (
              <tr key={p.projectId} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/project/${p.projectId}`} className="hover:underline">
                    {p.projectName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.versionCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.aiGenerations}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">
                  {formatRelativeTime(p.lastActivity)}
                </td>
              </tr>
            ))}
            {data.projectStats.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-muted-foreground">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
