"use client";

import { UserProfile } from "@clerk/nextjs";
import { CreditsDisplay } from "@/components/billing/credits-display";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account, security and subscription.
        </p>
      </div>

      <section className="max-w-sm rounded-xl border border-border bg-card">
        <h2 className="px-5 pt-4 text-sm font-semibold">Plan & credits</h2>
        <CreditsDisplay />
      </section>

      <UserProfile
        path="/settings"
        routing="path"
        appearance={{
          elements: {
            rootBox: "w-full",
            cardBox: "w-full max-w-none shadow-none border border-border",
          },
        }}
      />
    </div>
  );
}
