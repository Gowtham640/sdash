/**
 * Request Deduplication Service
 * Prevents multiple simultaneous requests to the same endpoint
 * Shares results across waiting requests
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes - longer than backend timeout

/**
 * Deduplicate requests - if a request is already in flight, return the same promise
 * Otherwise, execute the request function
 */
export async function deduplicateRequest<T>(
  key: string,
  requestFn: () => Promise<T>
): Promise<T> {
  // Check if there's already a pending request
  const existing = pendingRequests.get(key);
  
  if (existing) {
    const age = Date.now() - existing.timestamp;
    
    // If request is too old, it might be stuck - start a new one
    if (age > REQUEST_TIMEOUT_MS) {
      console.log(`[RequestDeduplication] ⚠️ Request ${key} is stale (${age}ms old), starting new request`);
      pendingRequests.delete(key);
    } else {
      console.log(`[RequestDeduplication] ♻️ Reusing existing request for ${key} (${age}ms old)`);
      return existing.promise as Promise<T>;
    }
  }

  // Create new request
  console.log(`[RequestDeduplication] 🚀 Starting new request for ${key}`);
  const promise = requestFn()
    .then((result) => {
      // Clean up after success
      pendingRequests.delete(key);
      return result;
    })
    .catch((error) => {
      // Clean up after error
      pendingRequests.delete(key);
      throw error;
    });

  pendingRequests.set(key, {
    promise,
    timestamp: Date.now(),
  });

  return promise;
}

/**
 * Clear a specific pending request (useful for force refresh)
 */
export function clearPendingRequest(key: string): void {
  if (pendingRequests.has(key)) {
    console.log(`[RequestDeduplication] 🗑️ Clearing pending request for ${key}`);
    pendingRequests.delete(key);
  }
}

/**
 * Clear all pending requests
 */
export function clearAllPendingRequests(): void {
  console.log(`[RequestDeduplication] 🗑️ Clearing all pending requests (${pendingRequests.size} requests)`);
  pendingRequests.clear();
}

/**
 * Get the number of pending requests
 */
export function getPendingRequestCount(): number {
  return pendingRequests.size;
}

