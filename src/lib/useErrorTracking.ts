/**
 * Hook to track errors when they occur
 */
import { useEffect, useRef } from 'react';
import { trackError } from './analytics';

export function useErrorTracking(error: string | null, page: string): void {
  const lastTrackedError = useRef<string | null>(null);
  
  useEffect(() => {
    if (error && error !== lastTrackedError.current) {
      // Only track if it's a new error (different message)
      lastTrackedError.current = error;
      trackError(error, 'client_error', page);
    }
  }, [error, page]);
}

