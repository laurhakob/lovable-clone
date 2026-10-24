"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ThemeProvider, useTheme, type Theme } from "./theme-provider";

function ClerkWithTheme({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      appearance={{
        theme: resolvedTheme === "dark" ? dark : undefined,
      }}
    >
      {children}
    </ClerkProvider>
  );
}

export function Providers({
  children,
  initialTheme,
}: {
  children: React.ReactNode;
  initialTheme?: Theme;
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <ClerkWithTheme>{children}</ClerkWithTheme>
    </ThemeProvider>
  );
}