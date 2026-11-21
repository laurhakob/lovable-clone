"use client";

import Link from "next/link";
import { Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { UpgradeButton } from "@/components/billing/upgrade-button";

export interface UpgradeCtaProps {
  reason: string;
  resetDays?: number;
  className?: string;
}

const PRO_FEATURES = [
  "Unlimited AI messages",
  "Unlimited projects",
  "All premium models",
  "Export projects as .zip",
];

export function UpgradeCta({ reason, resetDays, className }: UpgradeCtaProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 p-3.5",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Zap className="size-3.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{reason}</p>
          {resetDays !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Free credits reset in {resetDays}{" "}
              {resetDays === 1 ? "day" : "days"}.
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {PRO_FEATURES.map((feature) => (
          <li
            key={feature}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Check className="size-3 shrink-0 text-emerald-500" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-3">
        <UpgradeButton />
        <Link
          href="/pricing"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Compare plans
        </Link>
      </div>
    </div>
  );
}
