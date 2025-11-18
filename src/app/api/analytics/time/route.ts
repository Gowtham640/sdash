import { NextResponse } from "next/server";

/**
 * GET /api/analytics/time
 * Returns server time for client time synchronization
 * Helps prevent clock manipulation issues
 */
export async function GET(): Promise<NextResponse> {
  // Return server time in milliseconds since epoch
  const serverTime = Date.now();
  
  return NextResponse.json({
    server_time: serverTime,
  });
}

