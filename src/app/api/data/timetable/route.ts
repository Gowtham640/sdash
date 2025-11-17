import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';
import { getSupabaseCacheWithInfo, setSupabaseCache } from '@/lib/supabaseCache';

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[TIMETABLE API] JWT decode error:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const password = searchParams.get('password');

  console.log('[TIMETABLE API] Request received:', { email });

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: 'Email and password are required' },
      { status: 400 }
    );
  }

  try {
    console.log('[TIMETABLE API] Calling backend scraper...');
    
    const result = await callBackendScraper('get_timetable_data', {
      email,
      password,
    });

    console.log('[TIMETABLE API] Backend response success:', result.success);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TIMETABLE API] Error:', error);
    return NextResponse.json(
      { success: false, error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, password, force_refresh } = body;
    
    const forceRefresh = force_refresh === true || force_refresh === 'true';
    
    console.log('[TIMETABLE API] 📥 POST request received');
    console.log('[TIMETABLE API]   - force_refresh:', forceRefresh);
    console.log('[TIMETABLE API]   - password_provided:', password ? '✓' : '✗');

    if (!access_token) {
      return NextResponse.json(
        { success: false, error: 'Access token is required' },
        { status: 400 }
      );
    }

    // Decode JWT token to get user_id and email
    console.log('[TIMETABLE API] 🔐 Verifying access token...');
    let user_id: string;
    let user_email: string;

    try {
      const decoded = decodeJWT(access_token);
      
      if (!decoded) {
        throw new Error('Invalid token format');
      }

      user_email = (decoded.email as string) || (decoded.sub as string) || '';
      user_id = decoded.sub as string;

      console.log(`[TIMETABLE API] ✅ Token decoded successfully`);
      console.log(`[TIMETABLE API]   - User Email: ${user_email}`);
      console.log(`[TIMETABLE API]   - User ID: ${user_id}`);

      if (!user_email || !user_id) {
        throw new Error('Missing user claims in token');
      }

    } catch (tokenError) {
      console.error('[TIMETABLE API] ❌ Token verification failed');
      console.error('[TIMETABLE API]   Error:', tokenError instanceof Error ? tokenError.message : String(tokenError));
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session. Please sign in again.' },
        { status: 401 }
      );
    }

    // Check Supabase cache first (unless force refresh)
    if (!forceRefresh) {
      console.log('[TIMETABLE API] 🔍 Checking Supabase cache...');
      const cacheInfo = await getSupabaseCacheWithInfo(user_id, 'timetable', false);
      
      if (cacheInfo && cacheInfo.data) {
        console.log('[TIMETABLE API] ✅ Cache hit - returning cached timetable data');
        
        // Unwrap data if it has a nested 'data' property (legacy format)
        // Expected format: { timetable: {...}, metadata: {...} }
        // Legacy format: { data: { timetable: {...}, metadata: {...} } }
        let unwrappedData = cacheInfo.data;
        if (typeof unwrappedData === 'object' && unwrappedData !== null && 'data' in unwrappedData) {
          console.log('[TIMETABLE API] 🔄 Unwrapping nested data structure');
          unwrappedData = (unwrappedData as { data: unknown }).data;
        }
        
        // Wrap to match unified endpoint format: { data: { timetable: TimetableData } }
        return NextResponse.json({
          success: true,
          data: {
            timetable: unwrappedData,
          },
          cached: true,
          expiresAt: cacheInfo.expiresAt?.toISOString(),
          minutesUntilExpiry: cacheInfo.minutesUntilExpiry,
        });
      } else {
        console.log('[TIMETABLE API] ❌ Cache miss or expired - fetching from backend');
      }
    } else {
      console.log('[TIMETABLE API] 🔄 Force refresh requested - skipping cache');
    }

    // Cache miss/expired or force refresh - fetch from backend
    console.log('[TIMETABLE API] 🚀 Calling backend scraper...');
    
    const result = await callBackendScraper('get_timetable_data', {
      email: user_email,
      ...(password ? { password } : {}),
    });

    console.log('[TIMETABLE API] Backend response success:', result.success);

    // Extract and save to Supabase cache if successful
    if (result.success && result.data) {
      try {
        // Unwrap data if backend returned nested structure
        // Backend might return: { success: true, data: { data: { timetable: {...} } } }
        // We want to save: { timetable: {...}, metadata: {...} }
        let dataToCache = result.data;
        if (typeof dataToCache === 'object' && dataToCache !== null && 'data' in dataToCache) {
          console.log('[TIMETABLE API] 🔄 Unwrapping nested data structure from backend response');
          dataToCache = (dataToCache as { data: unknown }).data;
        }
        
        await setSupabaseCache(user_id, 'timetable', dataToCache);
        console.log('[TIMETABLE API] ✅ Saved timetable data to Supabase cache');
      } catch (cacheError) {
        console.error('[TIMETABLE API] ❌ Failed to save to cache:', cacheError);
        // Continue even if cache save fails
      }
    }

    // Unwrap data in response if needed
    let responseData = result.data;
    if (result.success && result.data && typeof result.data === 'object' && result.data !== null && 'data' in result.data) {
      console.log('[TIMETABLE API] 🔄 Unwrapping nested data structure in response');
      responseData = (result.data as { data: unknown }).data;
    }

    // Wrap to match unified endpoint format: { data: { timetable: TimetableData } }
    return NextResponse.json({
      ...result,
      data: {
        timetable: responseData,
      },
      cached: false,
    });

  } catch (error) {
    console.error('[TIMETABLE API] Error:', error);
    return NextResponse.json(
      { success: false, error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
