/**
 * worker/src/routes/webhooks.ts
 *
 * Clerk Billing webhooks, verified with Svix. Mounted BEFORE the auth
 * middleware because Clerk calls it server-to-server, without a session.
 *
 * Endpoint:
 * - POST /webhooks/clerk-billing
 *
 * Events handled (Clerk spells "canceled" with one L):
 * - subscriptionItem.active   (plan slug "pro") → upgrade to Pro
 * - subscriptionItem.canceled                   → log only, Pro until period end
 * - subscriptionItem.ended    (plan slug "pro") → downgrade to Free
 * - subscriptionItem.pastDue / subscription.pastDue → log only, Clerk retries
 */

import { Hono } from "hono";
import { Webhook } from "svix";
import { Env } from "../types";
import { downgradePlan, upgradePlan } from "../services/credits";

/** Slug of the paid plan as configured in the Clerk dashboard. */
const PRO_PLAN_SLUG = "pro";

interface ClerkBillingEvent {
  type: string;
  timestamp?: number;
  data: {
    id?: string;
    status?: string;
    payer_id?: string;
    plan?: { id?: string; name?: string; slug?: string };
    payer?: { user_id?: string; email?: string };
  };
}

const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.post("/", async (c) => {
  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json(
      { error: "Missing svix headers", code: "INVALID_WEBHOOK" },
      400,
    );
  }

  if (!c.env.CLERK_WEBHOOK_SECRET) {
    console.error("[webhooks] CLERK_WEBHOOK_SECRET is not configured");
    return c.json(
      { error: "Webhook secret not configured", code: "CONFIG_ERROR" },
      500,
    );
  }

  // Verification must run on the exact raw body text.
  const body = await c.req.text();

  try {
    // svix v2 `verify` throws on a bad signature and returns nothing on success.
    new Webhook(c.env.CLERK_WEBHOOK_SECRET).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[webhooks] Signature verification failed: ${reason}`);
    return c.json(
      { error: "Invalid webhook signature", code: "INVALID_SIGNATURE" },
      400,
    );
  }

  let event: ClerkBillingEvent;
  try {
    event = JSON.parse(body) as ClerkBillingEvent;
  } catch {
    return c.json({ error: "Invalid JSON payload", code: "INVALID_WEBHOOK" }, 400);
  }

  const { type, data } = event;
  const userId = data?.payer?.user_id;
  const planSlug = data?.plan?.slug;

  switch (type) {
    case "subscriptionItem.active": {
      if (planSlug === PRO_PLAN_SLUG && userId) {
        await upgradePlan(userId, c.env);
        console.log(`[webhooks] Upgraded ${userId} to Pro`);
      } else {
        console.log(
          `[webhooks] ${type} ignored (plan: ${planSlug ?? "none"}, user: ${userId ?? "none"})`,
        );
      }
      break;
    }
    case "subscriptionItem.canceled": {
      // The user keeps Pro until the period ends; `ended` performs the downgrade.
      console.log(
        `[webhooks] Subscription canceled for ${userId ?? "unknown user"}; Pro remains until period end`,
      );
      break;
    }
    case "subscriptionItem.ended": {
      if (planSlug === PRO_PLAN_SLUG && userId) {
        await downgradePlan(userId, c.env);
        console.log(`[webhooks] Downgraded ${userId} to Free`);
      } else {
        console.log(
          `[webhooks] ${type} ignored (plan: ${planSlug ?? "none"}, user: ${userId ?? "none"})`,
        );
      }
      break;
    }
    case "subscriptionItem.pastDue":
    case "subscription.pastDue": {
      console.log(
        `[webhooks] Payment past due for ${userId ?? data?.payer_id ?? "unknown"}; Clerk will retry`,
      );
      break;
    }
    default:
      console.log(`[webhooks] Unhandled webhook type: ${type}`);
  }

  return c.json({ received: true, type });
});

export { webhookRoutes };
