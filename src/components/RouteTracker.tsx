"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function RouteTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    localStorage.setItem("lastRoute", pathname);
  }, [pathname]);

  return null;
}
