/**
 * Safari-Compatible Browser Storage Utility
 * Fully backward compatible with localStorage API
 * Handles localStorage, sessionStorage, and memory fallbacks
 * Works in Safari Private Browsing mode
 */

// In-memory storage as last resort fallback
const memoryStorage: Map<string, string> = new Map();
const MAX_MEMORY_STORAGE_SIZE = 100 * 1024; // 100KB limit for memory storage

/**
 * Detect if storage is available
 */
function isStorageAvailable(storage: Storage): boolean {
  try {
    const testKey = '__storage_test__';
    storage.setItem(testKey, 'test');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  return isStorageAvailable(window.localStorage);
}

/**
 * Detect if sessionStorage is available
 */
function isSessionStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return false;
  }
  return isStorageAvailable(window.sessionStorage);
}

/**
 * Get storage with preference: localStorage > sessionStorage > memory
 */
function getStorage(): Storage | Map<string, string> {
  if (isLocalStorageAvailable()) {
    return window.localStorage;
  }
  if (isSessionStorageAvailable()) {
    console.warn('[BrowserStorage] localStorage unavailable, using sessionStorage (data per-tab)');
    return window.sessionStorage;
  }
  console.warn('[BrowserStorage] Both storage unavailable, using memory (data lost on refresh)');
  return memoryStorage;
}

/**
 * Set item - fully compatible with localStorage.setItem
 * Returns true if successful, false otherwise
 */
export function setStorageItem(key: string, value: string): boolean {
  try {
    const storage = getStorage();
    
    // Handle memory storage separately (for size limits)
    if (storage instanceof Map) {
      // Check size - memory storage should only be used for small critical data
      if (value.length > MAX_MEMORY_STORAGE_SIZE) {
        console.error(`[BrowserStorage] Data too large (${(value.length/1024).toFixed(2)}KB) for memory storage. Key: ${key}`);
        // Try sessionStorage one more time even if it previously failed
        if (isSessionStorageAvailable()) {
          try {
            window.sessionStorage.setItem(key, value);
            const verified = window.sessionStorage.getItem(key);
            if (verified === value) {
              console.log(`[BrowserStorage] Stored ${key} in sessionStorage despite earlier failure`);
              return true;
            }
          } catch {
            // SessionStorage also failed
          }
        }
        return false;
      }
      memoryStorage.set(key, value);
      return true;
    }
    
    // localStorage or sessionStorage
    storage.setItem(key, value);
    
    // Verify it was stored (important for Safari)
    const retrieved = storage.getItem(key);
    if (retrieved !== value) {
      console.error(`[BrowserStorage] Verification failed for key: ${key}`);
      return tryFallbackStorage(key, value);
    }
    return true;
  } catch (error) {
    console.error(`[BrowserStorage] Error setting ${key}:`, error);
    return tryFallbackStorage(key, value);
  }
}

/**
 * Try fallback storage methods
 */
function tryFallbackStorage(key: string, value: string): boolean {
  // Try sessionStorage if localStorage failed
  if (isLocalStorageAvailable() && isSessionStorageAvailable()) {
    try {
      window.sessionStorage.setItem(key, value);
      const verified = window.sessionStorage.getItem(key);
      if (verified === value) {
        console.log(`[BrowserStorage] Stored ${key} in sessionStorage as fallback`);
        return true;
      }
    } catch {
      // Fall through
    }
  }
  
  // Last resort: memory storage (only for small data)
  if (value.length <= MAX_MEMORY_STORAGE_SIZE) {
    try {
      memoryStorage.set(key, value);
      console.warn(`[BrowserStorage] Stored ${key} in memory (will be lost on refresh)`);
      return true;
    } catch {
      return false;
    }
  }
  
  return false;
}

/**
 * Get item - fully compatible with localStorage.getItem
 * Returns string | null (exact same behavior)
 */
export function getStorageItem(key: string): string | null {
  try {
    // Try localStorage first
    if (isLocalStorageAvailable()) {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
        return value;
      }
    }
    
    // Try sessionStorage
    if (isSessionStorageAvailable()) {
      const value = window.sessionStorage.getItem(key);
      if (value !== null) {
        // Try to restore to localStorage if it's now available
        if (isLocalStorageAvailable()) {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            // Ignore restore errors
          }
        }
        return value;
      }
    }
    
    // Try memory storage
    if (memoryStorage.has(key)) {
      const value = memoryStorage.get(key)!;
      // Try to restore to persistent storage if available
      if (isLocalStorageAvailable()) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // Ignore restore errors
        }
      } else if (isSessionStorageAvailable()) {
        try {
          window.sessionStorage.setItem(key, value);
        } catch {
          // Ignore restore errors
        }
      }
      return value;
    }
    
    return null;
  } catch (error) {
    console.error(`[BrowserStorage] Error getting ${key}:`, error);
    return null;
  }
}

/**
 * Remove item - fully compatible with localStorage.removeItem
 * Returns void (same as removeItem)
 */
export function removeStorageItem(key: string): void {
  try {
    if (isLocalStorageAvailable()) {
      window.localStorage.removeItem(key);
    }
    if (isSessionStorageAvailable()) {
      window.sessionStorage.removeItem(key);
    }
    memoryStorage.delete(key);
  } catch (error) {
    console.error(`[BrowserStorage] Error removing ${key}:`, error);
  }
}

/**
 * Clear all storage - compatible with localStorage.clear
 */
export function clearStorage(): void {
  try {
    if (isLocalStorageAvailable()) {
      window.localStorage.clear();
    }
    if (isSessionStorageAvailable()) {
      window.sessionStorage.clear();
    }
    memoryStorage.clear();
  } catch (error) {
    console.error('[BrowserStorage] Error clearing storage:', error);
  }
}

/**
 * Check if we're in Private Browsing mode
 */
export function isPrivateBrowsing(): boolean {
  return !isLocalStorageAvailable() && !isSessionStorageAvailable();
}

/**
 * Get storage type being used (for debugging)
 */
export function getStorageType(): 'localStorage' | 'sessionStorage' | 'memory' | 'unavailable' {
  if (isLocalStorageAvailable()) {
    return 'localStorage';
  }
  if (isSessionStorageAvailable()) {
    return 'sessionStorage';
  }
  if (memoryStorage.size > 0 || typeof window !== 'undefined') {
    return 'memory';
  }
  return 'unavailable';
}
