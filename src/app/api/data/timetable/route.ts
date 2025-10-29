import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';

// In-memory cache for timetable data
const timetableCache = new Map();
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

interface TimetableCacheEntry {
  data: Record<string, unknown>;
  timestamp: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const password = searchParams.get('password');
  const forceRefresh = searchParams.get('refresh') === 'true';

  console.log('[TIMETABLE API] Request received:', { email, forceRefresh });

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: 'Email and password are required' },
      { status: 400 }
    );
  }

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cacheKey = `timetable_${email}`;
    const cachedEntry = timetableCache.get(cacheKey) as TimetableCacheEntry;
    
    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION_MS) {
      console.log('[TIMETABLE API] Returning cached data');
      return NextResponse.json({
        ...cachedEntry.data,
        cached: true,
        cache_timestamp: new Date(cachedEntry.timestamp).toISOString()
      });
    }
  }

  try {
    console.log('[TIMETABLE API] Calling backend scraper...');
    
    const result = await callBackendScraper('get_timetable_data', {
      email,
      password,
    });

    console.log('[TIMETABLE API] Backend response success:', result.success);

    // Cache successful results
    if (result.success && result.data) {
      const cacheKey = `timetable_${email}`;
      timetableCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      console.log('[TIMETABLE API] Data cached successfully');
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TIMETABLE API] Error:', error);
    return NextResponse.json(
      { success: false, error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
