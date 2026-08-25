"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@realm-labs/contracts";
import { api } from "@/lib/api";

export function useMe() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<User>("/me");
      setUser(me);
      setError(null);
    } catch (err) {
      setUser(null);
      setError(err instanceof Error ? err.message : "Unauthorized");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { user, loading, error, reload };
}
