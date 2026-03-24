"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { setStorageItem } from "@/lib/browserStorage";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

export default function SessionRefresher() {
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/auth")) {
      return;
    }

    const refreshOnce = async () => {
      try {
        const response = await fetch("/api/auth/refresh", { method: "POST" });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.access_token) {
            setStorageItem("access_token", payload.access_token);
          }
          if (payload?.refresh_token) {
            setStorageItem("refresh_token", payload.refresh_token);
          }
          return;
        }

        if (response.status === 401 || response.status === 403) {
          clearInterval(intervalRef.current ?? undefined);
          intervalRef.current = null;
        }
      } catch (error) {
        console.error("[SessionRefresher] Refresh failed:", error);
      }
    };

    refreshOnce();

    intervalRef.current = setInterval(() => {
      refreshOnce();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pathname]);

  return null;
}
