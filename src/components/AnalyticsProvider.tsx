'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { initializeAnalytics, trackPageView } from '@/lib/analytics';

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
      initializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    // Track page view only on actual route change (not rerenders)
    if (pathname && pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      trackPageView(pathname);
    }
  }, [pathname]);

  return <>{children}</>;
}

