'use client';
import React, { useState, useEffect } from "react";
import Link from 'next/link';
import { getSlotOccurrences, getDayOrderStats, type SlotOccurrence, type DayOrderStats } from "@/lib/timetableUtils";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";

interface TimeSlot {
  time: string;
  do1: string;
  do2: string;
  do3: string;
  do4: string;
  do5: string;
}

interface TimetableData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    format: string;
  };
  time_slots: string[];
  slot_mapping: { [key: string]: string };
  timetable: {
    [doName: string]: {
      do_name: string;
      time_slots: {
        [timeSlot: string]: {
          slot_code: string;
          course_title: string;
          slot_type: string;
          is_alternate: boolean;
        };
      };
    };
  };
}

export default function TimetablePage() {
  const [timetableData, setTimetableData] = useState<TimeSlot[]>([]);
  const [rawTimetableData, setRawTimetableData] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentFact, setCurrentFact] = useState(getRandomFact());

  useEffect(() => {
    fetchUnifiedData();
  }, []);

  // Rotate facts every 8 seconds while loading
  useEffect(() => {
    if (!loading) return;
    
    const interval = setInterval(() => {
      setCurrentFact(getRandomFact());
    }, 8000);

    return () => clearInterval(interval);
  }, [loading]);

  const refreshTimetableData = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsRefreshing(true);

      const access_token = getStorageItem('access_token');
      
      if (!access_token) {
        console.error('[Timetable] No access token found');
        setError('Please sign in to view your timetable');
        setLoading(false);
        setIsRefreshing(false);
        return;
      }

      console.log('[Timetable] 🔄 Force refreshing timetable data...');

      const response = await fetch('/api/data/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getRequestBodyWithPassword(access_token, false),
          data_type: 'timetable'
        })
      });

      const result = await response.json();
      console.log('[Timetable] Refresh API response:', result);
      console.log('[Timetable] Refresh API response data:', result.data);
      console.log('[Timetable] Refresh API response data type:', typeof result.data);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to refresh timetable data');
      }

      // If refresh endpoint returns data directly, set it immediately
      if (result.data && typeof result.data === 'object' && ('timetable' in result.data || 'time_slots' in result.data)) {
        console.log('[Timetable] Setting timetable data directly from refresh response');
        const timetableDataObj = result.data as TimetableData;
        
        setRawTimetableData(timetableDataObj);
        const convertedData = convertTimetableDataToTimeSlots(timetableDataObj);
        setTimetableData(convertedData);
        
        const occurrences = getSlotOccurrences(timetableDataObj);
        setSlotOccurrences(occurrences);
        
        setLoading(false);
        setIsRefreshing(false);
        console.log('[Timetable] Loaded timetable with', occurrences.length, 'courses from refresh');
      } else {
        // After refresh, fetch unified data to get updated timetable
        await fetchUnifiedData(false);
      }
    } catch (err) {
      console.error('[Timetable] Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh timetable data');
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      if (forceRefresh) {
        setIsRefreshing(true);
      }

      const access_token = getStorageItem('access_token');
      
      if (!access_token) {
        console.error('[Timetable] No access token found');
        setError('Please sign in to view your timetable');
        setLoading(false);
        return;
      }

      // ✅ STEP 1: Fetch from API
      const apiStartTime = Date.now();
      const fetchType = forceRefresh ? '(force refresh all)' : '(fetching all data)';
      console.log(`[Timetable] 🚀 Fetching from API ${fetchType}`);

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
      });

      const apiDuration = Date.now() - apiStartTime;
      let result = await response.json();
      
      console.log(`[Timetable] 📡 API response received: ${apiDuration}ms`);
      console.log(`[Timetable]   - Success: ${result.success}`);
      console.log(`[Timetable]   - Status: ${response.status}`);

      // Handle session expiry
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[Timetable] Session expired or invalid');
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data');
      }


      // Process timetable data
      // Handle both formats: direct object or wrapped in {success, data}
      let timetableDataObj: TimetableData | null = null;
      
      if (result.data.timetable && typeof result.data.timetable === 'object') {
        // Check if it's direct format (has timetable, time_slots, metadata at root)
        if ('timetable' in result.data.timetable || 'time_slots' in result.data.timetable) {
          // Direct format
          timetableDataObj = result.data.timetable as TimetableData;
          console.log('[Timetable] Timetable data is direct format');
        } 
        // Check if it's wrapped format: {success: true, data: {...}}
        else if ('success' in result.data.timetable && 'data' in result.data.timetable) {
          const timetableWrapper = result.data.timetable as { success: boolean; data?: TimetableData };
          if (timetableWrapper.success && timetableWrapper.data) {
            timetableDataObj = timetableWrapper.data;
            console.log('[Timetable] Timetable data is wrapped format');
          }
        }
      }
      
      if (timetableDataObj && timetableDataObj.timetable) {
        console.log('[Timetable] Timetable response data:', timetableDataObj);
        console.log('[Timetable] DO 1 time_slots sample:', timetableDataObj.timetable['DO 1']?.time_slots);
        
        setRawTimetableData(timetableDataObj);
        const convertedData = convertTimetableDataToTimeSlots(timetableDataObj);
        console.log('[Timetable] Converted time slots:', convertedData);
        
        setTimetableData(convertedData);

        const occurrences = getSlotOccurrences(timetableDataObj);
        console.log('[Timetable] Slot occurrences:', occurrences);
        
        setSlotOccurrences(occurrences);
        console.log('[Timetable] Loaded timetable with', occurrences.length, 'courses');
      } else {
        // Keep page visible even when timetable data is unavailable
        // User can use refresh button to fetch data
        console.warn('[Timetable] Timetable data unavailable - keeping page visible for refresh');
        console.warn('[Timetable] Timetable data type:', typeof result.data.timetable);
        console.warn('[Timetable] Timetable data value:', result.data.timetable);
        setRawTimetableData(null);
        setTimetableData([]);
        // Don't throw error, just log it so page remains visible
      }

      // Process calendar data for day order stats
      // Handle both formats for calendar too
      let calendarEvents: unknown[] | null = null;
      
      if (Array.isArray(result.data.calendar)) {
        // Direct array format
        calendarEvents = result.data.calendar;
      } else if (result.data.calendar && typeof result.data.calendar === 'object' && 'success' in result.data.calendar && 'data' in result.data.calendar) {
        // Wrapped format
        const calendarWrapper = result.data.calendar as { success: boolean; data?: unknown[] };
        if (calendarWrapper.success && Array.isArray(calendarWrapper.data)) {
          calendarEvents = calendarWrapper.data;
        }
      }
      
      if (calendarEvents && calendarEvents.length > 0) {
        const stats = getDayOrderStats(calendarEvents);
        setDayOrderStats(stats);
        console.log('[Timetable] Day order stats calculated');
      }
      
      // Register attendance/marks fetch for smart prefetch scheduling
      if (result.success && (result.data?.attendance?.success || result.data?.marks?.success)) {
        registerAttendanceFetch();
      }

    } catch (err) {
      console.error('[Timetable] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');

      // Fallback to empty timetable
      const emptyTimetable: TimeSlot[] = [
        { time: "08:00-08:50", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "08:50-09:40", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "09:45-10:35", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "10:40-11:30", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "11:35-12:25", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "12:30-01:20", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "01:25-02:15", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "02:20-03:10", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "03:10-04:00", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "04:00-04:50", do1: "", do2: "", do3: "", do4: "", do5: "" },
      ];
      setTimetableData(emptyTimetable);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const convertTimetableDataToTimeSlots = (data: TimetableData): TimeSlot[] => {
    const timeSlots: TimeSlot[] = [];

    const timeSlotKeys = data.time_slots || [
      "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
      "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
    ];

    timeSlotKeys.forEach(timeSlot => {
      const timeSlotEntry: TimeSlot = {
        time: timeSlot,
        do1: "",
        do2: "",
        do3: "",
        do4: "",
        do5: ""
      };

      ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach((doName, index) => {
        const doData = data.timetable[doName];
        if (doData && doData.time_slots && doData.time_slots[timeSlot]) {
          const slotInfo = doData.time_slots[timeSlot];
          const courseTitle = slotInfo.course_title || "";

          const doKey = `do${index + 1}` as keyof TimeSlot;
          timeSlotEntry[doKey] = courseTitle || "";
        }
      });

      timeSlots.push(timeSlotEntry);
    });

    return timeSlots;
  };

  const days = ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'];
  const dayKeys = ['do1', 'do2', 'do3', 'do4', 'do5'] as const;

  if (loading) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-6 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-white text-2xl font-sora">Loading timetable data...</div>
          <div className="max-w-2xl px-6">
            <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
              Meanwhile, here are some interesting facts:
            </div>
            <div className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic">
              {currentFact}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-red-400 text-2xl font-sora text-center px-4">{error}</div>
          <div className="flex gap-4">
            <button 
              onClick={() => fetchUnifiedData()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
            {error.includes('session') && (
              <NavigationButton
                path="/auth"
                onClick={handleReAuthenticate}
                className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
              >
                Sign In Again
              </NavigationButton>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show empty state if no timetable data but no error (allows refresh button to work)
  if (!rawTimetableData || !timetableData || timetableData.length === 0) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden pt-10 pb-10 gap-8">
        {/* Home Icon */}
        <Link 
          href="/dashboard"
          className="absolute top-4 left-4 text-white hover:text-white/80 transition-colors z-50"
          aria-label="Go to Dashboard"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            fill="none" 
            viewBox="0 0 24 24" 
            strokeWidth={2} 
            stroke="currentColor" 
            className="w-8 h-8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </Link>
        
        <div className="flex flex-col items-center gap-4 mb-4 sm:mb-5 md:mb-5.5 lg:mb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-sora font-bold">Timetable</div>
            <button
              onClick={refreshTimetableData}
              disabled={loading}
              className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Refresh timetable data"
              title="Refresh timetable data"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                fill="none" 
                viewBox="0 0 24 24" 
                strokeWidth={2} 
                stroke="currentColor" 
                className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="w-[95vw] sm:w-[95vw] md:w-[95vw] lg:w-[95vw] h-auto bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col gap-6 justify-center items-center p-8">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
            No timetable data available
          </div>
          <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
            Click the refresh button above to fetch timetable data
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden pt-10 pb-10 gap-8">
      {/* Home Icon */}
      <Link 
        href="/dashboard"
        className="absolute top-4 left-4 text-white hover:text-white/80 transition-colors z-50"
        aria-label="Go to Dashboard"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24" 
          strokeWidth={2} 
          stroke="currentColor" 
          className="w-8 h-8"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </Link>
      
      <div className="flex flex-col items-center gap-4 mb-4 sm:mb-5 md:mb-5.5 lg:mb-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-sora font-bold">Timetable</div>
          <button
            onClick={refreshTimetableData}
            disabled={loading}
            className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh timetable data"
            title="Refresh timetable data"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24" 
              strokeWidth={2} 
              stroke="currentColor" 
              className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>

      <div className="w-[95vw] sm:w-[95vw] md:w-[95vw] lg:w-[95vw] h-auto bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full h-full border-collapse">
            <thead className="sticky top-0 bg-black/50 backdrop-blur-sm z-10">
              <tr>
                <th className="border border-white/30 bg-white/20 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold min-w-[80px] sm:min-w-[90px] md:min-w-[95px] lg:min-w-[100px] text-[10px] sm:text-xs md:text-sm lg:text-base">
                  Time
                </th>
                {days.map((day) => (
                  <th key={day} className="border border-white/30 bg-white/20 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold min-w-[100px] sm:min-w-[120px] md:min-w-[130px] lg:min-w-[150px] text-[10px] sm:text-xs md:text-sm lg:text-base">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {timetableData.map((slot) => (
                <tr key={slot.time}>
                  <td className="border border-white/30 bg-white/10 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold text-[10px] sm:text-xs md:text-sm lg:text-base">
                    {slot.time}
                  </td>

                  {dayKeys.map((dayKey) => (
                    <td key={dayKey} className="border border-white/30 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center text-[10px] sm:text-xs md:text-sm lg:text-base">
    
                      {slot[dayKey] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Stats Section */}
      <div className="w-[95vw] bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora overflow-hidden">
        <div className="p-4 sm:p-5 md:p-5.5 lg:p-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 sm:mb-5 md:mb-5.5 lg:mb-6 text-center">Quick Stats</div>

          {/* Day Order Statistics */}
          {dayOrderStats && (
            <div className="mb-6 sm:mb-7 md:mb-8 lg:mb-8">
              
            </div>
          )}

          {/* Subject Occurrences */}
          <div>
            <div className="text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora font-bold mb-3 sm:mb-4">Subject Schedule Overview</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {slotOccurrences.map((occurrence, index) => (
                <div key={index} className="bg-white/10 border border-white/20 rounded-2xl p-3 sm:p-3.5 md:p-4 lg:p-4">
                  <div className="flex flex-col gap-2">
                    <div className="text-white text-xs sm:text-sm font-sora font-bold">
                      {occurrence.courseTitle}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`text-[10px] sm:text-xs font-sora px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${
                        occurrence.category === 'Theory' 
                          ? 'bg-blue-500/20 text-blue-400' 
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {occurrence.category}
                      </div>
                      <div className="text-white/70 text-[10px] sm:text-xs font-sora">
                        Slots: {occurrence.slot}
                      </div>
                    </div>
                    <div className="text-white/80 text-[10px] sm:text-xs font-sora">
                      Day Orders: {occurrence.dayOrders.sort().map((doNum: number) => 
                        `DO${doNum}(${occurrence.dayOrderHours[doNum]})`
                      ).join(', ')}
                    </div>
                    <div className="text-white/80 text-[10px] sm:text-xs font-sora">
                      Total Sessions: {occurrence.totalOccurrences}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>


      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-white mb-4">Session Expired</h2>
            <p className="text-gray-300 mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
            >
              Sign In
            </NavigationButton>
          </div>
        </div>
      )}
    </div>
  );
}