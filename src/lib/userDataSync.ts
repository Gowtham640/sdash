/**
 * Sync user data from Go backend to Supabase database
 * Fetches user data from /user endpoint and updates public.users table
 */

import { getUserDataFromGoBackend, GoBackendUserData } from './scraperClient';
import { supabaseAdmin } from './supabaseAdmin';

/**
 * Capitalize name properly (first letter of each word)
 */
function capitalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Update user data in database from Go backend
 * Fetches user data from /user endpoint and updates all fields in public.users table
 * @param user_id - User ID (UUID)
 * @returns Success status and any error
 */
export async function syncUserDataFromBackend(
  user_id: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[UserDataSync] 🔄 Starting user data sync for user: ${user_id}`);

  try {
    // Fetch user data from Go backend
    const userData = await getUserDataFromGoBackend();

    if (!userData) {
      console.error(`[UserDataSync] ❌ Failed to fetch user data from backend`);
      return {
        success: false,
        error: 'Failed to fetch user data from backend',
      };
    }

    console.log(`[UserDataSync] 📊 User data received from backend:`);
    console.log(`[UserDataSync]   - Name: ${userData.name}`);
    console.log(`[UserDataSync]   - Semester: ${userData.semester}`);
    console.log(`[UserDataSync]   - Department: ${userData.department}`);
    console.log(`[UserDataSync]   - Program: ${userData.program}`);
    console.log(`[UserDataSync]   - Reg Number: ${userData.regNumber}`);
    console.log(`[UserDataSync]   - Batch: ${userData.batch}`);
    console.log(`[UserDataSync]   - Year: ${userData.year}`);
    console.log(`[UserDataSync]   - Section: ${userData.section}`);
    console.log(`[UserDataSync]   - Mobile: ${userData.mobile}`);
    console.log(`[UserDataSync]   - Specialization: ${userData.specialization || 'none'}`);

    // Map API response to database schema
    // Note: regNumber (camelCase) -> regnumber (lowercase) in database
    const updateData: {
      name?: string;
      mobile?: string;
      program?: string;
      semester?: number;
      regnumber?: string;
      batch?: string;
      year?: number;
      department?: string;
      section?: string;
      specialization?: string | null;
    } = {};

    if (userData.name) {
      updateData.name = capitalizeName(userData.name);
    }
    if (userData.mobile) {
      updateData.mobile = userData.mobile;
    }
    if (userData.program) {
      updateData.program = userData.program;
    }
    if (userData.semester !== undefined && userData.semester !== null) {
      updateData.semester = userData.semester;
    }
    if (userData.regNumber) {
      updateData.regnumber = userData.regNumber; // Map regNumber to regnumber
    }
    if (userData.batch) {
      updateData.batch = userData.batch;
    }
    if (userData.year !== undefined && userData.year !== null) {
      updateData.year = userData.year;
    }
    if (userData.department) {
      updateData.department = userData.department;
    }
    if (userData.section) {
      updateData.section = userData.section;
    }
    if (userData.specialization !== undefined) {
      updateData.specialization = userData.specialization || null;
    }

    // Update database (fire and forget - don't block)
    (async () => {
      try {
        const dbStartTime = Date.now();
        const { data, error } = await supabaseAdmin
          .from('users')
          .update(updateData)
          .eq('id', user_id)
          .select();
        const dbDuration = Date.now() - dbStartTime;

        if (error) {
          console.error(`[UserDataSync] ❌ Database update failed (${dbDuration}ms)`);
          console.error(`[UserDataSync]   - Error: ${error.message}`);
          console.error(`[UserDataSync]   - Details: ${JSON.stringify(error)}`);
        } else {
          console.log(`[UserDataSync] ✅ Database update successful (${dbDuration}ms)`);
          console.log(`[UserDataSync]   - Updated fields: ${Object.keys(updateData).join(', ')}`);
          if (data && data.length > 0) {
            console.log(`[UserDataSync]   - Updated user: ${data[0].email || user_id}`);
          }
        }
      } catch (dbError) {
        console.error(`[UserDataSync] ❌ Database exception:`);
        console.error(`[UserDataSync]   - Error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        if (dbError instanceof Error && dbError.stack) {
          console.error(`[UserDataSync]   - Stack: ${dbError.stack.split('\n').slice(0, 3).join('\n')}`);
        }
      }
    })();

    return { success: true };
  } catch (error) {
    console.error(`[UserDataSync] ❌ Error in user data sync:`);
    console.error(`[UserDataSync]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[UserDataSync]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[UserDataSync]   - Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
