"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Home" },
  { href: "/inbox/unmatched", label: "Unmatched" },
  { href: "/allocation", label: "Allocation" },
  { href: "/incubator", label: "Incubator" },
  { href: "/reports", label: "Reports" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppShell({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const wide =
    pathname === "/allocation" ||
    pathname === "/incubator" ||
    pathname === "/import";

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-4 border-b border-border/80 bg-background/80 px-4 backdrop-blur-md">
        <Link
          href="/"
          className="font-heading text-sm font-semibold tracking-tight text-foreground"
        >
          Realm Labs
        </Link>
        <nav className="flex items-center gap-1">
          {nav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2 py-1 text-sm transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            {user.email} · {user.role}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={wide ? "px-4 py-4" : "mx-auto max-w-4xl px-4 py-6"}>
        {children}
      </main>
    </div>
  );
}
