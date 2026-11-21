/**
 * worker/src/routes/billing.ts
 *
 * Authenticated plan-change endpoint. Used by the frontend right after a
 * Clerk checkout completes (so the UI updates without waiting for the
 * webhook) and as a manual fallback. The Clerk billing webhook remains the
 * source of truth for subscription state.
 *
 * Endpoints:
 * - POST /api/billing/plan-change  { action: "upgrade" | "downgrade" }
 */

import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import {
  downgradePlan,
  toCreditsResponse,
  upgradePlan,
} from "../services/credits";

const billingRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

billingRoutes.post("/plan-change", async (c) => {
  let action: unknown;
  try {
    action = (await c.req.json<{ action?: unknown }>()).action;
  } catch {
    action = undefined;
  }

  if (action !== "upgrade" && action !== "downgrade") {
    return c.json(
      {
        error: 'Body must include action: "upgrade" | "downgrade"',
        code: "VALIDATION_ERROR",
      },
      400,
    );
  }

  const credits =
    action === "upgrade"
      ? await upgradePlan(c.var.userId, c.env)
      : await downgradePlan(c.var.userId, c.env);

  return c.json({ success: true, credits: toCreditsResponse(credits) });
});

export { billingRoutes };
