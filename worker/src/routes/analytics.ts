/**
 * worker/src/routes/analytics.ts
 *
 * GET /api/analytics – usage summary for the authenticated user,
 * aggregated from their projects, version snapshots and credits.
 * Shape mirrors the frontend's types/analytics.ts (AnalyticsData).
 */

import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import { Project, Version } from "../types/project";
import { getCredits, isUnlimited } from "../services/credits";
import { MODEL_REGISTRY } from "../ai/providers";

/** Cap on versions read per project, newest first, to bound R2 reads */
const MAX_VERSIONS_PER_PROJECT = 50;
const RECENT_ACTIVITY_LIMIT = 15;

const analyticsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

analyticsRoutes.get("/", async (c) => {
  const userId = c.var.userId;

  const projectIds =
    (await c.env.METADATA.get<string[]>(`user-projects:${userId}`, "json")) ??
    [];
  const projects = (
    await Promise.all(
      projectIds.map((id) =>
        c.env.METADATA.get<Project>(`project:${id}`, "json"),
      ),
    )
  ).filter((p): p is Project => p !== null && p.userId === userId);

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const first = Math.max(
        0,
        project.currentVersion - MAX_VERSIONS_PER_PROJECT + 1,
      );
      const reads: Promise<Version | null>[] = [];
      for (let v = project.currentVersion; v >= first; v--) {
        reads.push(
          c.env.FILES.get(`${project.id}/v${v}/files.json`)
            .then((obj) => (obj ? (obj.json() as Promise<Version>) : null))
            .catch(() => null),
        );
      }
      const versions = (await Promise.all(reads)).filter(
        (v): v is Version =>
          v !== null && typeof v.versionNumber === "number" && !!v.type,
      );
      return { project, versions };
    }),
  );

  let totalGenerations = 0;
  let totalManualEdits = 0;
  let totalRestores = 0;
  const modelCounts = new Map<string, number>();
  const activity: Array<{
    type: Version["type"];
    projectName: string;
    projectId: string;
    model: string;
    prompt: string;
    createdAt: string;
  }> = [];

  const projectStats = perProject.map(({ project, versions }) => {
    let aiGenerations = 0;
    for (const v of versions) {
      if (v.type === "ai") {
        aiGenerations++;
        totalGenerations++;
        if (v.model) modelCounts.set(v.model, (modelCounts.get(v.model) ?? 0) + 1);
      } else if (v.type === "restore") {
        totalRestores++;
      } else if (v.versionNumber > 0) {
        // v0 is the starter template, not a user edit
        totalManualEdits++;
      }
      if (v.versionNumber > 0) {
        activity.push({
          type: v.type,
          projectName: project.name,
          projectId: project.id,
          model: v.type === "ai" ? v.model : "",
          prompt: (v.prompt ?? "").slice(0, 120),
          createdAt: v.createdAt,
        });
      }
    }
    return {
      projectId: project.id,
      projectName: project.name,
      versionCount: project.currentVersion + 1,
      aiGenerations,
      lastActivity: project.updatedAt,
    };
  });

  const modelBreakdown = [...modelCounts.entries()]
    .map(([modelId, count]) => ({
      modelId,
      modelName: MODEL_REGISTRY[modelId]?.displayName ?? modelId,
      count,
      percentage:
        totalGenerations > 0 ? Math.round((count / totalGenerations) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  activity.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const credits = await getCredits(userId, c.env);
  const unlimited = isUnlimited(credits);

  return c.json({
    totalProjects: projects.length,
    totalGenerations,
    totalManualEdits,
    totalRestores,
    creditsUsed: unlimited ? 0 : Math.max(0, credits.total - credits.remaining),
    creditsTotal: unlimited ? -1 : credits.total,
    plan: credits.plan,
    periodEnd: credits.periodEnd,
    modelBreakdown,
    recentActivity: activity.slice(0, RECENT_ACTIVITY_LIMIT),
    projectStats: projectStats.sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
    ),
  });
});

export { analyticsRoutes };
