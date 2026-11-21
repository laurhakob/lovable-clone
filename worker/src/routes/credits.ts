import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import { getCredits, toCreditsResponse } from "../services/credits";

const creditsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------
// GET /api/credits – Get the user's current credit balance
// ---------------------------------------------------------------

/**
 * Returns the authenticated user's credit balance, plan, and period info.
 * Triggers lazy period reset if the billing period has expired.
 *
 * Response shape:
 * {
 *   remaining: number,   // -1 means unlimited (Pro)
 *   total: number,       // 50 for free tier
 *   plan: "free" | "pro",
 *   periodStart: string,
 *   periodEnd: string,   // ISO 8601 – when credits reset
 *   isUnlimited: boolean // convenience flag for the frontend
 * }
 *
 * Credit deduction lives in services/credits.ts (single implementation).
 */
creditsRoutes.get("/", async (c) => {
  const credits = await getCredits(c.var.userId, c.env);
  return c.json({
    ...toCreditsResponse(credits),
    periodStart: credits.periodStart,
  });
});

export { creditsRoutes };
