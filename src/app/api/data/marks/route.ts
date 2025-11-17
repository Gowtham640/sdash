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
    console.error('[MARKS API] JWT decode error:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const password = searchParams.get('password');

  console.log('[MARKS API] Request received:', { email });

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: 'Email and password are required' },
      { status: 400 }
    );
  }

  try {
    console.log('[MARKS API] Calling backend scraper...');
    
    const result = await callBackendScraper('get_marks_data', {
      email,
      password,
    });

    console.log('[MARKS API] Success:', result.success);
    if (result.success) {
      console.log('[MARKS API] Data count:', result.count);
      console.log('[MARKS API] Data structure:', JSON.stringify(result, null, 2));
    } else {
      console.log('[MARKS API] Error:', result.error);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[MARKS API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, password, force_refresh } = body;
    
    const forceRefresh = force_refresh === true || force_refresh === 'true';
    
    console.log('[MARKS API] 📥 POST request received');
    console.log('[MARKS API]   - force_refresh:', forceRefresh);
    console.log('[MARKS API]   - password_provided:', password ? '✓' : '✗');

    if (!access_token) {
      return NextResponse.json(
        { success: false, error: 'Access token is required' },
        { status: 400 }
      );
    }

    // Decode JWT token to get user_id and email
    console.log('[MARKS API] 🔐 Verifying access token...');
    let user_id: string;
    let user_email: string;

    try {
      const decoded = decodeJWT(access_token);
      
      if (!decoded) {
        throw new Error('Invalid token format');
      }

      user_email = (decoded.email as string) || (decoded.sub as string) || '';
      user_id = decoded.sub as string;

      console.log(`[MARKS API] ✅ Token decoded successfully`);
      console.log(`[MARKS API]   - User Email: ${user_email}`);
      console.log(`[MARKS API]   - User ID: ${user_id}`);

      if (!user_email || !user_id) {
        throw new Error('Missing user claims in token');
      }

    } catch (tokenError) {
      console.error('[MARKS API] ❌ Token verification failed');
      console.error('[MARKS API]   Error:', tokenError instanceof Error ? tokenError.message : String(tokenError));
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session. Please sign in again.' },
        { status: 401 }
      );
    }

    // Check Supabase cache first (unless force refresh)
    if (!forceRefresh) {
      console.log('[MARKS API] 🔍 Checking Supabase cache...');
      const cacheInfo = await getSupabaseCacheWithInfo(user_id, 'marks', false);
      
      if (cacheInfo && cacheInfo.data) {
        console.log('[MARKS API] ✅ Cache hit - returning cached marks data');
        
        // Unwrap data if it has a nested 'data' property (legacy format)
        // Expected format: { all_courses: [...], metadata: {...} }
        // Legacy format: { data: { all_courses: [...], metadata: {...} } }
        let unwrappedData = cacheInfo.data;
        if (typeof unwrappedData === 'object' && unwrappedData !== null && 'data' in unwrappedData) {
          console.log('[MARKS API] 🔄 Unwrapping nested data structure');
          unwrappedData = (unwrappedData as { data: unknown }).data;
        }
        
        // Wrap to match unified endpoint format: { data: { marks: MarksData } }
        return NextResponse.json({
          success: true,
          data: {
            marks: unwrappedData,
          },
          cached: true,
          expiresAt: cacheInfo.expiresAt?.toISOString(),
          minutesUntilExpiry: cacheInfo.minutesUntilExpiry,
        });
      } else {
        console.log('[MARKS API] ❌ Cache miss or expired - fetching from backend');
      }
    } else {
      console.log('[MARKS API] 🔄 Force refresh requested - skipping cache');
    }

    // Cache miss/expired or force refresh - fetch from backend
    console.log('[MARKS API] 🚀 Calling backend scraper...');
    
    const result = await callBackendScraper('get_marks_data', {
      email: user_email,
      ...(password ? { password } : {}),
    });

    console.log('[MARKS API] Backend response success:', result.success);

    // Extract and save to Supabase cache if successful
    if (result.success && result.data) {
      try {
        // Unwrap data if backend returned nested structure
        // Backend might return: { success: true, data: { data: { all_courses: [...] } } }
        // We want to save: { all_courses: [...], metadata: {...} }
        let dataToCache = result.data;
        if (typeof dataToCache === 'object' && dataToCache !== null && 'data' in dataToCache) {
          console.log('[MARKS API] 🔄 Unwrapping nested data structure from backend response');
          dataToCache = (dataToCache as { data: unknown }).data;
        }
        
        await setSupabaseCache(user_id, 'marks', dataToCache);
        console.log('[MARKS API] ✅ Saved marks data to Supabase cache');
      } catch (cacheError) {
        console.error('[MARKS API] ❌ Failed to save to cache:', cacheError);
        // Continue even if cache save fails
      }
    }

    // Unwrap data in response if needed
    let responseData = result.data;
    if (result.success && result.data && typeof result.data === 'object' && result.data !== null && 'data' in result.data) {
      console.log('[MARKS API] 🔄 Unwrapping nested data structure in response');
      responseData = (result.data as { data: unknown }).data;
    }

    // Wrap to match unified endpoint format: { data: { marks: MarksData } }
    return NextResponse.json({
      ...result,
      data: {
        marks: responseData,
      },
      cached: false,
    });

  } catch (error) {
    console.error('[MARKS API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
