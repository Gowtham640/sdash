import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

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
      setCachedResponse(email, result);
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
  return new Promise((resolve, reject) => {
    console.log('[API] Starting Python process...');
    
    const pythonScriptPath = path.join(process.cwd(), 'python-scraper', 'api_wrapper.py');
    console.log('[API] Python script path:', pythonScriptPath);
    
    const pythonProcess = spawn('python', ['api_wrapper.py'], {
      cwd: path.join(process.cwd(), 'python-scraper'),
      env: { ...process.env }
    });

    let output = '';
    let errorOutput = '';
    let resolved = false;

    // Set timeout for Python process (2 minutes)
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.log('[API] Python process timeout');
        pythonProcess.kill();
        reject(new Error('Python process timeout after 2 minutes'));
      }
    }, 120000);

    // Send input data to Python
    const inputData = JSON.stringify({
      action: 'get_calendar_data',
      email: email,
      password: password,
      force_refresh: forceRefresh
    });
    
    console.log('[API] Sending input to Python:', inputData);
    pythonProcess.stdin.write(inputData);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      console.log('[API] Python stdout chunk:', chunk);
      output += chunk;
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      console.log('[API] Python stderr:', chunk);
      errorOutput += chunk;
    });

    pythonProcess.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      
      console.log('[API] Python process closed with code:', code);
      console.log('[API] Python output:', output);
      console.log('[API] Python error output:', errorOutput);
      
      if (code === 0) {
        try {
          // Handle multiple JSON objects in output
          const lines = output.trim().split('\n');
          let result = null;
          
          // Find the last valid JSON object
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line && line.startsWith('{') && line.endsWith('}')) {
              try {
                result = JSON.parse(line);
                break;
              } catch (e) {
                continue;
              }
            }
          }
          
          if (result) {
            console.log('[API] Parsed result:', result);
            resolve(result);
          } else {
            console.error('[API] No valid JSON found in output');
            console.error('[API] Raw output:', output);
            reject(new Error('No valid JSON response from Python'));
          }
        } catch (parseError) {
          console.error('[API] JSON parse error:', parseError);
          console.error('[API] Raw output:', output);
          reject(new Error(`Failed to parse Python output: ${parseError}`));
        }
      } else {
        console.error('[API] Python process failed');
        reject(new Error(`Python process failed with code ${code}: ${errorOutput}`));
      }
    });

    pythonProcess.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      
      console.error('[API] Python process error:', error);
      reject(new Error(`Failed to start Python process: ${error}`));
    });
  });
}