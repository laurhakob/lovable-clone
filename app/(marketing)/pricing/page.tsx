import type { Metadata } from "next";
import Link from "next/link";
import { PricingTable } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/landing/navbar";

export const metadata: Metadata = {
  title: "Pricing · Lovable Clone",
  description: "Simple plans for building apps with AI.",
};

export default function PricingPage() {
  return (
    // The landing navbar is designed for a dark backdrop
    <div className="dark relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-b from-[#1a0533] via-[#0f0a2e] to-transparent" />
        <div className="absolute top-[-40%] left-1/2 h-full w-[70%] -translate-x-1/2 rounded-full bg-[#3b47d6] opacity-30 blur-[120px]" />
      </div>

      <Navbar />

      <main className="relative mx-auto max-w-5xl px-6 pb-20 pt-28">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="mb-12 mt-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Start free with 50 messages a month. Upgrade to Pro for unlimited
            messages, unlimited projects, every model and project export.
          </p>
        </header>

        <PricingTable />

        <p className="mt-10 text-center text-sm text-muted-foreground">
          All plans include live preview, code editor, version control and dark
          mode.
        </p>
      </main>
    </div>
  );
}
