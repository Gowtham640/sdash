import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Calendar API called');
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const password = searchParams.get('password');
    const user_id = searchParams.get('user_id');
    
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
    
    console.log(`[API] Calling Python scraper for: ${email}`);
    
    // Call Python scraper
    const result = await callPythonCalendarFunction(email, password, user_id || undefined);
    
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

async function callPythonCalendarFunction(email: string, password: string, user_id?: string) {
  return await callBackendScraper('get_calendar_data', {
    email,
    password,
    user_id,
  });
}