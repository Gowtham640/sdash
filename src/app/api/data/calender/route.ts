import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Calendar API called');
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const password = searchParams.get('password');
    
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
    const result = await callPythonCalendarFunction(email, password);
    
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

async function callPythonCalendarFunction(email: string, password: string) {
  return new Promise((resolve, reject) => {
    console.log('[API] Starting Python process...');
    
    const pythonScriptPath = path.join(process.cwd(), 'python-scraper', 'api_wrapper.py');
    console.log('[API] Python script path:', pythonScriptPath);
    
    const pythonProcess = spawn('python', [pythonScriptPath], {
      cwd: process.cwd(),
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
      password: password
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