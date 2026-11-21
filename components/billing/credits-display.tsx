"use client";

/**
 * components/billing/credits-display.tsx
 *
 * Sidebar widget showing the user's plan and remaining credits.
 * Fetches its own data and refreshes on the `credits-updated` event.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { SubscriptionDetailsButton } from "@clerk/nextjs/experimental";
import { Infinity as InfinityIcon } from "lucide-react";
import { createApiClient, CreditsInfo } from "@/lib/api-client";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  CREDITS_UPDATED_EVENT,
  UpgradeButton,
} from "@/components/billing/upgrade-button";

/** Whole days from now until the given ISO date (never negative) */
export function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function CreditsDisplay() {
  const { getToken } = useAuth();
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  /** Bumped by the credits-updated event to trigger a refetch */
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const onUpdate = () => setRefreshKey((key) => key + 1);
    window.addEventListener(CREDITS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CREDITS_UPDATED_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    createApiClient(getToken)
      .credits.get()
      .then((data) => {
        if (cancelled) return;
        setCredits(data);
        setHasError(false);
      })
      .catch((error) => {
        console.error("Failed to load credits:", error);
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, refreshKey]);

  if (isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
    );
  }

  if (hasError || !credits) {
    return (
      <div className="px-5 py-4 text-xs text-muted-foreground">
        Credits unavailable
      </div>
    );
  }

  if (credits.isUnlimited || credits.plan === "pro") {
    return (
      <div className="space-y-2 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Pro plan
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            <InfinityIcon className="size-4" />
            Unlimited
          </span>
        </div>
        <SubscriptionDetailsButton>
          <Button variant="outline" size="sm" className="w-full text-xs">
            Manage subscription
          </Button>
        </SubscriptionDetailsButton>
      </div>
    );
  }

  const used = Math.max(0, credits.total - credits.remaining);
  const percent = credits.total > 0 ? (used / credits.total) * 100 : 0;
  const resetDays = daysUntil(credits.periodEnd);

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Free plan
        </span>
        <span className="text-xs tabular-nums text-foreground">
          {credits.remaining}/{credits.total} left
        </span>
      </div>
      <Progress value={percent} className="h-1.5" />
      <p className="text-[11px] text-muted-foreground">
        {used} used · resets in {resetDays} {resetDays === 1 ? "day" : "days"}
      </p>
      <UpgradeButton className="w-full" />
    </div>
  );
}
