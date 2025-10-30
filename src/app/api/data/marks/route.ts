import { NextRequest, NextResponse } from 'next/server';
import { callBackendScraper } from '@/lib/scraperClient';

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
