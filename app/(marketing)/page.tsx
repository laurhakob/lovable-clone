import { Hero } from "@/components/landing/hero";
import { Navbar } from "@/components/landing/navbar";

/**
 * Landing page. app/page.tsx also resolves to "/", so both render the
 * same landing; keep them in sync (or delete one) to avoid divergence.
 */
export default function MarketingPage() {
  return (
    <div>
      <Navbar />
      <Hero />
    </div>
  );
}
