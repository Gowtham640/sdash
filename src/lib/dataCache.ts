interface CachedData {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

/**
 * In-memory cache for storing scraped data
 * - Fast retrieval (50ms)
 * - Automatic expiration (TTL)
 * - Per-user data isolation
 */
class DataCache {
  private cache: Map<string, CachedData> = new Map();
  private defaultTTL = 6 * 60 * 60 * 1000; // 6 hours (attendance and marks)
  private longTermTTL = 30 * 24 * 60 * 60 * 1000; // 30 days (timetable and calendar)

  /**
   * Get cached data if not expired
   */
  get(key: string): any | null {
    const cached = this.cache.get(key);

    if (!cached) {
      console.log(`[Cache] MISS: ${key}`);
      return null;
    }

    // Check if expired
    const ageMs = Date.now() - cached.timestamp;
    if (ageMs > cached.ttl) {
      console.log(`[Cache] EXPIRED: ${key} (age: ${Math.round(ageMs / 1000)}s)`);
      this.cache.delete(key);
      return null;
    }

    const ageSeconds = Math.round(ageMs / 1000);
    console.log(`[Cache] HIT: ${key} (age: ${ageSeconds}s, TTL: ${Math.round(cached.ttl / 1000)}s)`);
    return cached.data;
  }

  /**
   * Store data in cache with optional TTL
   */
  set(key: string, data: any, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
    console.log(`[Cache] SET: ${key} (TTL: ${Math.round((ttl || this.defaultTTL) / 1000)}s)`);
  }

  /**
   * Remove specific cache entry
   */
  delete(key: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      console.log(`[Cache] DELETED: ${key}`);
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[Cache] CLEARED ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  stats() {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      key,
      age_seconds: Math.round((Date.now() - value.timestamp) / 1000),
      ttl_seconds: Math.round(value.ttl / 1000)
    }));

    return {
      total_entries: this.cache.size,
      entries
    };
  }

  /**
   * Get cache size in bytes (rough estimate)
   */
  getSize(): number {
    let bytes = 0;
    for (const [key, value] of this.cache.entries()) {
      bytes += key.length * 2; // String bytes
      bytes += JSON.stringify(value.data).length;
    }
    return bytes;
  }
}

// Singleton instance (shared across all requests in the same process)
export const dataCache = new DataCache();

// Export for testing
export type { CachedData };
