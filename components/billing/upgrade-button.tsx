"use client";

/**
 * components/billing/upgrade-button.tsx
 *
 * Opens Clerk's checkout drawer for the Pro plan. After a successful
 * checkout it tells the worker right away (so the UI updates before the
 * webhook arrives) and broadcasts a `credits-updated` window event that
 * credit-aware components listen for.
 *
 * If NEXT_PUBLIC_CLERK_PRO_PLAN_ID is not configured, it falls back to a
 * link to the /pricing page.
 */

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { CheckoutButton } from "@clerk/nextjs/experimental";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Window event fired whenever the user's plan/credits change client-side */
export const CREDITS_UPDATED_EVENT = "credits-updated";

const PRO_PLAN_ID = process.env.NEXT_PUBLIC_CLERK_PRO_PLAN_ID;

export interface UpgradeButtonProps {
  className?: string;
  size?: "sm" | "default" | "lg";
  label?: string;
}

export function UpgradeButton({
  className,
  size = "sm",
  label = "Upgrade to Pro",
}: UpgradeButtonProps) {
  const { getToken } = useAuth();

  const button = (
    <Button size={size} className={cn("gap-1.5", className)}>
      <Zap className="size-3.5" />
      {label}
    </Button>
  );

  if (!PRO_PLAN_ID) {
    return (
      <Button size={size} className={cn("gap-1.5", className)} asChild>
        <Link href="/pricing">
          <Zap className="size-3.5" />
          {label}
        </Link>
      </Button>
    );
  }

  const handleComplete = async () => {
    try {
      await createApiClient(getToken).billing.changePlan("upgrade");
    } catch (error) {
      // The Clerk webhook will still upgrade the account.
      console.error("Plan sync after checkout failed:", error);
    }
    window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    toast.success("Welcome to Pro! You now have unlimited messages.");
  };

  return (
    <CheckoutButton
      planId={PRO_PLAN_ID}
      planPeriod="month"
      onSubscriptionComplete={handleComplete}
    >
      {button}
    </CheckoutButton>
  );
}
