import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const password = searchParams.get('password');

  console.log('[ATTENDANCE API] Request received:', { email });

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: 'Email and password are required' },
      { status: 400 }
    );
  }

  try {
    console.log('[ATTENDANCE API] Spawning Python process...');
    
    const pythonProcess = spawn('python', ['api_wrapper.py'], {
      cwd: path.join(process.cwd(), 'python-scraper'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Prepare input data
    const inputData = {
      action: 'get_attendance_data',
      email: email,
      password: password
    };

    console.log('[ATTENDANCE API] Sending input to Python:', inputData);

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
      console.log('[ATTENDANCE API] Python stderr:', data.toString());
    });

    // Wait for process to complete
    const exitCode = await new Promise<number>((resolve) => {
      pythonProcess.on('close', (code) => {
        console.log('[ATTENDANCE API] Python process exited with code:', code);
        resolve(code || 0);
      });
    });

    console.log('[ATTENDANCE API] Python stdout:', stdout);
    console.log('[ATTENDANCE API] Python stderr:', stderr);

    if (exitCode !== 0) {
      console.error('[ATTENDANCE API] Python process failed with exit code:', exitCode);
      return NextResponse.json(
        { success: false, error: `Python process failed with exit code ${exitCode}` },
        { status: 500 }
      );
    }

    // Parse Python output
    let result;
    try {
      console.log('[ATTENDANCE API] Raw stdout length:', stdout.length);
      console.log('[ATTENDANCE API] Raw stdout preview:', stdout.substring(0, 200));
      result = JSON.parse(stdout);
      console.log('[ATTENDANCE API] Parsed result:', result);
    } catch (parseError) {
      console.error('[ATTENDANCE API] Failed to parse Python output:', parseError);
      console.error('[ATTENDANCE API] Raw stdout:', stdout);
      return NextResponse.json(
        { success: false, error: 'Failed to parse Python output' },
        { status: 500 }
      );
    }

    console.log('[ATTENDANCE API] Success:', result.success);
    if (result.success) {
      console.log('[ATTENDANCE API] Data count:', result.count);
      console.log('[ATTENDANCE API] Data structure:', JSON.stringify(result, null, 2));
    } else {
      console.log('[ATTENDANCE API] Error:', result.error);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[ATTENDANCE API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
