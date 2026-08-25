"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useMe } from "@/hooks/use-me";
import { AppShell } from "@/components/app-shell";

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading, error } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (error || !user)) {
      router.replace("/login");
    }
  }, [loading, error, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Redirecting to sign in…
      </div>
    );
  }

  return <AppShell user={user}>{children}</AppShell>;
}
