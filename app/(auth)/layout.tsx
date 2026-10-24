import React, { Suspense } from "react";

const AuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <Suspense
        fallback={
          <div className="h-128 w-100 animate-pulse rounded-xl bg-zinc-900" />
        }
      >
        {children}
      </Suspense>
    </div>
  );
};

export default AuthLayout;