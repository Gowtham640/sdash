import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

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
    console.log('[TIMETABLE API] Spawning Python process...');
    
    const pythonProcess = spawn('python', ['api_wrapper.py'], {
      cwd: path.join(process.cwd(), 'python-scraper'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Prepare input data
    const inputData = {
      action: 'get_timetable_data',
      email: email,
      password: password
    };

    console.log('[TIMETABLE API] Sending input to Python:', inputData);

    // Send input to Python process
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();

    // Collect output
    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('[TIMETABLE API] Python stderr:', data.toString());
    });

    // Wait for process to complete
    const exitCode = await new Promise<number>((resolve) => {
      pythonProcess.on('close', (code) => {
        console.log('[TIMETABLE API] Python process exited with code:', code);
        resolve(code || 0);
      });
    });

    console.log('[TIMETABLE API] Python stdout:', stdout);
    console.log('[TIMETABLE API] Python stderr:', stderr);

    if (exitCode !== 0) {
      console.error('[TIMETABLE API] Python process failed with exit code:', exitCode);
      return NextResponse.json(
        { success: false, error: `Python process failed with exit code ${exitCode}` },
        { status: 500 }
      );
    }

    // Parse Python output
    let result;
    try {
      result = JSON.parse(stdout);
      console.log('[TIMETABLE API] Parsed result:', result);
    } catch (parseError) {
      console.error('[TIMETABLE API] Failed to parse Python output:', parseError);
      console.error('[TIMETABLE API] Raw stdout:', stdout);
      return NextResponse.json(
        { success: false, error: 'Failed to parse Python output' },
        { status: 500 }
      );
    }

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
