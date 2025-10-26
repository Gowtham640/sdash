/**
 * Password Storage Utility
 * Provides simple encryption for storing portal password in localStorage
 * 
 * WARNING: This is CLIENT-SIDE encryption only for basic obfuscation.
 * For production, consider server-side encryption or more robust solutions.
 */

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
 * Store portal password securely
 */
export function storePortalPassword(password: string): void {
  try {
    const encrypted = xorEncrypt(password, ENCRYPTION_KEY);
    localStorage.setItem('portal_password_encrypted', encrypted);
    console.log('[PasswordStorage] Password stored securely');
  } catch (error) {
    console.error('[PasswordStorage] Error storing password:', error);
  }
}

/**
 * Retrieve portal password
 */
export function getPortalPassword(): string | null {
  try {
    const encrypted = localStorage.getItem('portal_password_encrypted');
    if (!encrypted) return null;
    
    const decrypted = xorDecrypt(encrypted, ENCRYPTION_KEY);
    return decrypted;
  } catch (error) {
    console.error('[PasswordStorage] Error retrieving password:', error);
    return null;
  }
}

/**
 * Clear stored password
 */
export function clearPortalPassword(): void {
  try {
    localStorage.removeItem('portal_password_encrypted');
    console.log('[PasswordStorage] Password cleared');
  } catch (error) {
    console.error('[PasswordStorage] Error clearing password:', error);
  }
}

/**
 * Get request body with password included
 */
export function getRequestBodyWithPassword(access_token: string, force_refresh: boolean = false): { access_token: string; force_refresh: boolean; password?: string } {
  const password = getPortalPassword();
  return {
    access_token,
    force_refresh,
    ...(password ? { password } : {})
  };
}
