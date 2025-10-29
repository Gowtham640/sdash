import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';

// ============================================================================
// MEMORY CACHE CONFIGURATION
// ============================================================================

interface CacheEntry {
  data: Record<string, unknown>;
  timestamp: number;
  expires: number;
}

const memoryCache = new Map<string, CacheEntry>();
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function getCachedResponse(email: string): Record<string, unknown> | null {
  const cacheKey = `calendar_${email}`;
  const cached = memoryCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expires) {
    console.log('[CACHE] Using memory cache');
    return cached.data;
  }
  
  // Clean up expired cache
  if (cached) {
    memoryCache.delete(cacheKey);
  }
  
  return null;
}

function setCachedResponse(email: string, data: Record<string, unknown>): void {
  const cacheKey = `calendar_${email}`;
  memoryCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    expires: Date.now() + CACHE_DURATION_MS
  });
  console.log(`[CACHE] Cached response for ${email}`);
}

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Calendar API called');
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const password = searchParams.get('password');
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    // Validate input
    if (!email || !password) {
      console.log('[API] Missing email or password');
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('[API] Invalid email format');
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }
    
    // Basic password validation
    if (password.length < 6) {
      console.log('[API] Password too short');
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }
    
    // Check memory cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCachedResponse(email);
      if (cached) {
        console.log('[API] Returning cached response');
        return NextResponse.json(cached);
      }
    }
    
    console.log(`[API] Cache miss or force refresh - calling Python scraper for: ${email}`);
    
    // Call Python scraper
    const result = await callPythonCalendarFunction(email, password, forceRefresh);
    
    // Cache the result if successful
    if (result && typeof result === 'object' && 'success' in result && result.success) {
      setCachedResponse(email, result as unknown as Record<string, unknown>);
    }
    
    console.log('[API] Python scraper completed');
    console.log('[API] Result:', result);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('[API] Error in calendar API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}

async function callPythonCalendarFunction(email: string, password: string, forceRefresh: boolean = false) {
  return await callBackendScraper('get_calendar_data', {
    email,
    password,
    force_refresh: forceRefresh,
  });
}