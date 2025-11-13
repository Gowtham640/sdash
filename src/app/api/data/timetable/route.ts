import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';

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
