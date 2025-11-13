/**
 * Password Storage Utility
 * Provides simple encryption for storing portal password in localStorage
 * 
 * WARNING: This is CLIENT-SIDE encryption only for basic obfuscation.
 * For production, consider server-side encryption or more robust solutions.
 */

import { setStorageItem, getStorageItem, removeStorageItem } from './browserStorage';

const ENCRYPTION_KEY = "sdash_portal_encryption_key_2024"; // Simple key for obfuscation

/**
 * Simple XOR encryption for obfuscation
 */
function xorEncrypt(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result); // Base64 encode the result
}

/**
 * Simple XOR decryption
 */
function xorDecrypt(encrypted: string, key: string): string {
  try {
    const text = atob(encrypted); // Base64 decode
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch (error) {
    console.error('[PasswordStorage] Decryption error:', error);
    return '';
  }
}

/**
 * Store portal password securely with verification and fallback
 * Returns true if storage was successful, false otherwise
 */
export function storePortalPassword(password: string): boolean {
  try {
    const encrypted = xorEncrypt(password, ENCRYPTION_KEY);
    
    // Store using browserStorage utility (handles Safari Private Browsing)
    const stored = setStorageItem('portal_password_encrypted', encrypted);
    if (!stored) {
      console.error('[PasswordStorage] Storage failed - storage may be disabled');
      return false;
    }
    
    // Verify it was stored correctly
    const verified = getStorageItem('portal_password_encrypted');
    if (verified !== encrypted) {
      console.error('[PasswordStorage] Verification failed - storage may be full or disabled');
      return false;
    }
    
    // Also store backup in sessionStorage as additional fallback
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('portal_password_backup', encrypted);
        console.log('[PasswordStorage] Password stored in both browserStorage and sessionStorage ✓');
      }
    } catch {
      console.warn('[PasswordStorage] sessionStorage backup failed, but browserStorage succeeded');
    }
    
    console.log('[PasswordStorage] Password stored and verified ✓');
    return true;
  } catch (error) {
    console.error('[PasswordStorage] Error storing password:', error);
    return false;
  }
}

/**
 * Retrieve portal password with fallback to sessionStorage
 */
export function getPortalPassword(): string | null {
  try {
    // Try browserStorage first (handles all fallbacks)
    let encrypted = getStorageItem('portal_password_encrypted');
    
    // Fallback to sessionStorage backup if browserStorage is empty
    if (!encrypted && typeof window !== 'undefined' && window.sessionStorage) {
      console.warn('[PasswordStorage] browserStorage empty, trying sessionStorage backup...');
      try {
        encrypted = window.sessionStorage.getItem('portal_password_backup');
        
        if (encrypted) {
          console.log('[PasswordStorage] Found backup in sessionStorage, restoring to browserStorage');
          // Restore to browserStorage for next time
          setStorageItem('portal_password_encrypted', encrypted);
        }
      } catch {
        // sessionStorage access failed
      }
    }
    
    if (!encrypted) {
      console.warn('[PasswordStorage] No password found in any storage');
      return null;
    }
    
    const decrypted = xorDecrypt(encrypted, ENCRYPTION_KEY);
    
    if (!decrypted) {
      console.error('[PasswordStorage] Decryption returned empty string');
      return null;
    }
    
    return decrypted;
  } catch (error) {
    console.error('[PasswordStorage] Error retrieving password:', error);
    return null;
  }
}

/**
 * Clear stored password from all storage locations
 */
export function clearPortalPassword(): void {
  try {
    removeStorageItem('portal_password_encrypted');
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem('portal_password_backup');
      } catch {
        // Ignore sessionStorage errors
      }
    }
    console.log('[PasswordStorage] Password cleared from all storage locations');
  } catch (error) {
    console.error('[PasswordStorage] Error clearing password:', error);
  }
}

/**
 * Check if password is available in storage
 */
export function isPasswordAvailable(): boolean {
  const password = getPortalPassword();
  return password !== null && password.length > 0;
}

/**
 * Get request body with password included
 */
export function getRequestBodyWithPassword(
  access_token: string,
  force_refresh: boolean = false
): { access_token: string; force_refresh: boolean; password?: string } {
  console.log('[PasswordStorage] 🔍 Retrieving password for API request...');
  const password = getPortalPassword();
  
  if (!password) {
    console.error('[PasswordStorage] ❌ CRITICAL: No password available for API request!');
    console.error('[PasswordStorage]   - This request will likely FAIL');
    console.error('[PasswordStorage]   - User needs to re-authenticate');
    console.error('[PasswordStorage]   - Check localStorage and sessionStorage for password');
  } else {
    console.log('[PasswordStorage] ✅ Password retrieved successfully');
    console.log(`[PasswordStorage]   - Password length: ${password.length} characters`);
    console.log(`[PasswordStorage]   - Will be sent to backend`);
  }
  
  const requestBody = {
    access_token,
    force_refresh,
    ...(password ? { password } : {})
  };
  
  console.log('[PasswordStorage] 📦 Request body prepared:');
  console.log(`[PasswordStorage]   - Has password: ${password ? "✓" : "✗"}`);
  console.log(`[PasswordStorage]   - Force refresh: ${force_refresh}`);
  
  return requestBody;
}
