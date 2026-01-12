/**
 * This file is deprecated - project should not write to Supabase tables
 * Only read operations are allowed
 */

// This function is no longer used - project should not write user data to Supabase
export async function syncUserDataFromBackend(
  user_id: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[UserDataSync] ⚠️ User data sync is disabled - project should not write to Supabase tables`);
  return { success: true }; // Return success to not break calling code
}

