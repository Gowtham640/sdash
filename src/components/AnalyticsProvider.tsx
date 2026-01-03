'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { initializeAnalytics, trackPageView } from '@/lib/analytics';
// import { startKeepWarm } from '@/lib/scraperClient'; // TODO: Implement keep-warm functionality

/**
 * Analytics Provider Component
 * Initializes analytics and tracks page views
 */
export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initializedRef = useRef(false);
  const lastPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    // Initialize analytics only once
    if (!initializedRef.current) {
      initializeAnalytics();
      // startKeepWarm(); // TODO: Start keep-warm mechanism (sends test ping immediately)
      initializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    // Track page view only on actual route change (not rerenders)
    // The trackPageView function has built-in deduplication, so we can call it safely
    if (pathname && pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      trackPageView(pathname);
    }
  }, [pathname]);

  return <>{children}</>;
}

