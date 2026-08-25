"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  HOSTED_DOMAIN,
  type AuthProvidersResponse,
  type GoogleStartResponse,
} from "@realm-labs/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const errorCopy: Record<string, string> = {
  DOMAIN_NOT_ALLOWED: `Sign-in is restricted to @${HOSTED_DOMAIN} Google Workspace accounts.`,
  GOOGLE_NOT_CONFIGURED: "Google sign-in is not configured yet.",
  OAUTH_ERROR: "Google sign-in failed. Try again.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const oauthError = useMemo(() => {
    const code = searchParams.get("error");
    if (!code) {
      return "";
    }
    return searchParams.get("message") || errorCopy[code] || errorCopy.OAUTH_ERROR;
  }, [searchParams]);

  async function signIn() {
    setError("");
    setPending(true);
    try {
      const providers = await api<AuthProvidersResponse>("/auth/providers");
      if (!providers.google) {
        throw new Error(errorCopy.GOOGLE_NOT_CONFIGURED);
      }
      const { url } = await api<GoogleStartResponse>("/auth/google", {
        method: "POST",
      });
      window.location.href = url;
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  const displayError = error || oauthError;

  return (
    <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border/80 bg-card/80 p-8 shadow-[0_0_0_1px_oklch(0.68_0.24_338_/_0.12)] backdrop-blur-sm">
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-teal">
          CRM
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Realm Labs</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your @{HOSTED_DOMAIN} Google account.
        </p>
      </div>
      {displayError ? (
        <p className="text-sm text-destructive">{displayError}</p>
      ) : null}
      <Button className="w-full" disabled={pending} onClick={() => void signIn()}>
        {pending ? "Redirecting…" : "Sign in with Google"}
      </Button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
