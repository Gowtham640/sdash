'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getStorageItem } from "@/lib/browserStorage";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { transformAttendanceIfNeeded } from "@/lib/dataFormatHandler";

interface AttendanceSubject {
  row_number: number;
  subject_code: string;
  course_title: string;
  category: string;
  faculty_name: string;
  slot: string;
  room: string;
  hours_conducted: string;
  hours_absent: string;
  attendance: string;
  attendance_percentage: string;
}

interface AttendanceData {
  all_subjects: AttendanceSubject[];
}

interface AttendanceButtonProps {
  expandedButton: 'marks' | 'attendance' | null;
  onExpand: (button: 'marks' | 'attendance' | null) => void;
}

export default function AttendanceButton({ expandedButton, onExpand }: AttendanceButtonProps) {
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  // Fetch attendance data when attendance button is expanded and no data exists
  useEffect(() => {
    if (expandedButton === 'attendance' && !attendanceData && !attendanceLoading) {
      console.log('[AttendanceButton] 📊 Attendance button expanded but no attendance data - fetching...');
      fetchAttendanceData();
    }
  }, [expandedButton, attendanceData, attendanceLoading]);

  // Fetch attendance data specifically
  const fetchAttendanceData = async (forceRefresh = false) => {
    try {
      setAttendanceLoading(true);
      console.log('[AttendanceButton] 📊 Fetching attendance data...');

      const access_token = getStorageItem('access_token');
      if (!access_token) {
        console.error('[AttendanceButton] No access token found for attendance fetch');
        setAttendanceLoading(false);
        return;
      }

      // Use request deduplication for attendance fetch
      const requestKey = `fetch_attendance_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await fetch('/api/data/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh, ['attendance']))
        });
        const result = await response.json();
        return { response, result };
      });

      const { response, result } = apiResult;

      // Handle session expiry
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[AttendanceButton] Session expired during attendance fetch');
        setAttendanceLoading(false);
        return;
      }

      if (!result.success) {
        console.error('[AttendanceButton] Attendance fetch failed:', result.error);
        setAttendanceLoading(false);
        return;
      }

      // Process attendance data
      console.log('[AttendanceButton] 🔍 Processing attendance data...');
      console.log('[AttendanceButton] 📋 Full API result:', JSON.stringify(result, null, 2));

      let attendanceDataObj: AttendanceData | null = null;

      if (result.data && typeof result.data === 'object' && 'attendance' in result.data) {
        const attendanceDataRaw = (result.data as { attendance?: unknown }).attendance;
        console.log('[AttendanceButton] 📋 Raw attendance data:', JSON.stringify(attendanceDataRaw, null, 2));

        if (attendanceDataRaw && typeof attendanceDataRaw === 'object') {
          // Apply transformation first (like attendance page does)
          console.log('[AttendanceButton] 🔄 Applying transformAttendanceIfNeeded...');
          const transformedData = transformAttendanceIfNeeded(attendanceDataRaw) as Record<string, unknown>;
          console.log('[AttendanceButton] ✅ Transformed data:', JSON.stringify(transformedData, null, 2));

          // Handle different attendance data structures
          if ('all_subjects' in transformedData) {
            console.log('[AttendanceButton] ✅ Found all_subjects in direct format after transformation');
            attendanceDataObj = transformedData as unknown as AttendanceData;
          } else if ('data' in transformedData && typeof transformedData.data === 'object') {
            // Handle wrapped format: {data: {...}}
            const wrappedData = transformedData.data as Record<string, unknown>;
            console.log('[AttendanceButton] 🔄 Checking wrapped format after transformation, wrapped data:', JSON.stringify(wrappedData, null, 2));
            if (wrappedData && 'all_subjects' in wrappedData) {
              console.log('[AttendanceButton] ✅ Found all_subjects in wrapped format after transformation');
              attendanceDataObj = wrappedData as unknown as AttendanceData;
            }
          }

          // If still not found, try to extract from any object with subjects
          if (!attendanceDataObj) {
            const rawObj = attendanceDataRaw as Record<string, unknown>;
            console.log('[AttendanceButton] 🔍 Available keys in attendance data:', Object.keys(rawObj));

            // Try common attendance data patterns
            for (const key of Object.keys(rawObj)) {
              const value = rawObj[key];
              if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                console.log(`[AttendanceButton] 📋 Checking array in key '${key}':`, JSON.stringify(value[0], null, 2));
              }
            }
          }
        } else {
          console.log('[AttendanceButton] ❌ Attendance data is not an object:', typeof attendanceDataRaw);
        }
      } else {
        console.log('[AttendanceButton] ❌ No attendance in result.data');
        console.log('[AttendanceButton] 📋 Available keys in result.data:', result.data ? Object.keys(result.data) : 'null');
      }

      if (attendanceDataObj) {
        console.log('[AttendanceButton] ✅ Final attendance data:', JSON.stringify(attendanceDataObj, null, 2));
        console.log('[AttendanceButton] 📊 Subjects found:', attendanceDataObj.all_subjects?.length || 0);

        // Log each subject to see the data structure
        if (attendanceDataObj.all_subjects) {
          attendanceDataObj.all_subjects.forEach((subject, index) => {
            console.log(`[AttendanceButton] 📋 Subject ${index + 1}:`, JSON.stringify(subject, null, 2));
          });
        }

        setAttendanceData(attendanceDataObj);
        console.log('[AttendanceButton] ✅ Attendance data set successfully');
      } else {
        console.warn('[AttendanceButton] ⚠️ No attendance data found in response');
        console.warn('[AttendanceButton] 📋 Full result for debugging:', JSON.stringify(result, null, 2));
      }

    } catch (error) {
      console.error('[AttendanceButton] Error fetching attendance data:', error);
    } finally {
      setAttendanceLoading(false);
    }
  };

  // Get attendance color based on percentage
  const getAttendanceColor = (percentage: string) => {
    if (!percentage || percentage === 'N/A') return 'text-gray-400';

    const percent = parseFloat(percentage.replace('%', ''));
    if (isNaN(percent)) return 'text-gray-400';

    if (percent >= 80) return 'text-green-400';
    if (percent >= 70) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div
      onClick={(e) => {
        if (expandedButton !== 'attendance') {
          e.preventDefault();
          onExpand('attendance');
        }
      }}
      className={`relative bg-gradient-to-br from-blue-600/20 to-cyan-600/20 backdrop-blur-md border border-white/10 rounded-2xl hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group cursor-pointer ${
        expandedButton === 'attendance'
          ? 'col-span-2 row-span-2 h-[29rem] order-2'
          : expandedButton
            ? 'opacity-0 scale-50 h-0 overflow-hidden'
            : 'h-56 opacity-100 scale-100 order-2'
      }`}
    >
      {/* Four-way arrow icon */}
      {expandedButton === 'attendance' && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand(null);
            }}
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <Link
            href="/attendance"
            className="absolute bottom-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10 flex items-center gap-1 text-sm font-sora font-medium"
          >
            View Full
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </>
      )}
      {!expandedButton && (
        <div
          className="absolute top-4 right-4 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      )}

      {expandedButton === 'attendance' ? (
        <div className="w-full h-full flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-2 border-b border-white/10">
            <div className="text-white pt-4 pl-4 font-sora text-sm font-semibold">Attendance Summary</div>
          </div>

          <div className="flex-1">
            {attendanceLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-white font-sora text-lg">Loading attendance data...</div>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
            ) : (
                      <div className="grid grid-cols-3 gap-3 p-5">
                        {(() => {
                          const subjects = attendanceData?.all_subjects || [];
                          console.log('[AttendanceButton] 🎨 Rendering subjects:', subjects.length);

                          if (subjects.length === 0) {
                            return (
                              <div className="col-span-3 text-white/70 text-center p-4">
                                <p className="text-sm mb-2">No attendance data available</p>
                                <p className="text-xs text-gray-400">
                                  Try expanding the attendance button again to fetch data
                                </p>
                              </div>
                            );
                          }

                          return subjects.map((subject, index) => {
                            // Use attendance field if attendance_percentage is 0% or empty
                            const displayPercentage = subject.attendance_percentage && subject.attendance_percentage !== '0%' && subject.attendance_percentage !== '0'
                              ? subject.attendance_percentage
                              : subject.attendance ? `${subject.attendance}%` : 'N/A';

                            console.log(`[AttendanceButton] 🎨 Rendering subject ${index + 1} (${subject.course_title}):`, {
                              attendance_percentage: subject.attendance_percentage,
                              attendance: subject.attendance,
                              displayPercentage: displayPercentage,
                              color: getAttendanceColor(displayPercentage)
                            });

                            return (
                              <div key={index} className="bg-white/5 rounded-lg p-3 border border-white/10">
                                <div className="flex flex-col gap-1">
                                  <div className="text-white font-sora text-sm font-semibold">
                                    {subject.course_title}
                                  </div>
                                  <div className="text-gray-400 font-sora text-xs">
                                    {subject.subject_code}
                                  </div>
                                  <div className={`text-green-400 font-sora text-lg font-bold ${getAttendanceColor(displayPercentage)}`}>
                                    {displayPercentage}
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
            Attendance
          </div>
          <div className="text-white/70 text-sm font-sora text-center pb-7">
            Check attendance
          </div>
        </>
      )}
    </div>
  );
}
