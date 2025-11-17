'use client';
import React, { useState, useEffect } from "react";
import Link from 'next/link';
import { markSaturdaysAsHolidays } from "@/lib/calendarHolidays";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: string;
}

export default function CalendarPage() {
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFact, setCurrentFact] = useState(getRandomFact());
  const [error, setError] = useState<string | null>(null);
  
  // Track errors
  useErrorTracking(error, '/calender');
  const [scrollContainerRef, setScrollContainerRef] = useState<HTMLDivElement | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Get current date in DD/MM/YYYY format
  const getCurrentDateString = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Find the current week (week containing today's date)
  const getCurrentWeekDates = () => {
    const today = new Date();
    const currentWeek = [];
    
    // Get Monday of current week
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    
    // Generate all 7 days of current week
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      currentWeek.push(`${day}/${month}/${year}`);
    }
    
    return currentWeek;
  };

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

  // Auto-scroll to current date when data loads
  useEffect(() => {
    if (calendarData.length > 0 && scrollContainerRef) {
      const currentDateStr = getCurrentDateString();
      console.log(`[AUTO-SCROLL] Looking for current date: ${currentDateStr}`);
      
      // Wait for DOM to render
      setTimeout(() => {
        // Find the element with current date
        const currentDateElement = document.querySelector(`[data-date="${currentDateStr}"]`);
        
        if (currentDateElement) {
          console.log(`[AUTO-SCROLL] Found current date element:`, currentDateElement);
          
          // Scroll to the current date element
          currentDateElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
          
          console.log(`[AUTO-SCROLL] Scrolled to current date`);
        } else {
          console.log(`[AUTO-SCROLL] Current date element not found, trying fallback`);
          
          // Fallback: scroll to a reasonable position (middle of calendar)
          const scrollContainer = scrollContainerRef;
          if (scrollContainer) {
            const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            const middlePosition = maxScroll / 2;
            
            scrollContainer.scrollTo({
              top: middlePosition,
              behavior: 'smooth'
            });
            
            console.log(`[AUTO-SCROLL] Scrolled to middle position: ${middlePosition}`);
          }
        }
      }, 500); // Wait 500ms for DOM to render
    }
  }, [calendarData, scrollContainerRef]);

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const fetchUnifiedData = async () => {
    try {
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');
      
      if (!access_token) {
        console.error('[Calendar] No access token found');
        setError('Please sign in to view calendar');
        setLoading(false);
        return;
      }

      // Calendar is always fetched fresh from public.calendar table
      // Fetch all data (like dashboard) to get attendance data for semester extraction
      console.log(`[Calendar] 🚀 Fetching calendar data from API (always fresh from public.calendar)`);

      // Use request deduplication for unified API calls
      // Calendar is always fetched fresh from public.calendar table regardless
      const requestKey = `fetch_calendar_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await fetch('/api/data/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getRequestBodyWithPassword(access_token, false))
        });
        
        // Check if response is OK and has content before parsing JSON
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }
        
        // Check if response has content
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Invalid response format. Expected JSON, got ${contentType}`);
        }
        
        // Parse JSON with error handling
        let result;
        try {
          const responseText = await response.text();
          if (!responseText || responseText.trim().length === 0) {
            throw new Error('Empty response from server');
          }
          result = JSON.parse(responseText);
        } catch (jsonError) {
          throw new Error(`Failed to parse JSON response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`);
        }
        
        return { response, result };
      });
      
      const response = apiResult.response;
      const result = apiResult.result;

      console.log('[Calendar] ========================================');
      console.log('[Calendar] 📥 FRONTEND: Received API response');
      console.log('[Calendar]   - Response status:', response.status);
      console.log('[Calendar]   - Response OK:', response.ok);
      console.log('[Calendar]   - result.success:', result.success);
      console.log('[Calendar]   - result.error:', result.error || 'none');
      console.log('[Calendar]   - result.metadata:', result.metadata);
      console.log('[Calendar]   - result.semester:', (result as { semester?: number }).semester || 'none');
      console.log('[Calendar]   - result.course:', (result as { course?: string }).course || 'none');
      console.log('[Calendar] ========================================');

      // Handle session expiry
      if (!response.ok || (result?.error === 'session_expired')) {
        console.error('[Calendar] ❌ Session expired');
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      if (!result?.success) {
        console.error('[Calendar] ❌ API response not successful:', result?.error);
        throw new Error(result?.error || 'Failed to fetch data');
      }

      // Process calendar data
      // Handle both direct format and wrapped format
      let calendarEvents: CalendarEvent[] | null = null;
      
      if (Array.isArray(result.data.calendar)) {
        // Direct array format
        calendarEvents = result.data.calendar;
        console.log('[Calendar] Calendar data is direct array format');
      } else if (result.data.calendar && typeof result.data.calendar === 'object') {
        // Check if it's wrapped format: {success: true, data: [...]}
        if ('success' in result.data.calendar && 'data' in result.data.calendar) {
          const calendarWrapper = result.data.calendar as { success?: boolean | { data?: CalendarEvent[] }; data?: CalendarEvent[] };
          const successValue = calendarWrapper.success;
          const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
          if (isSuccess && Array.isArray(calendarWrapper.data)) {
            calendarEvents = calendarWrapper.data;
            console.log('[Calendar] Calendar data is wrapped format');
          }
        }
        // Check legacy nested format: {data: [...]}
        else if ('data' in result.data.calendar && Array.isArray((result.data.calendar as { data?: CalendarEvent[] }).data)) {
          calendarEvents = (result.data.calendar as { data: CalendarEvent[] }).data;
          console.log('[Calendar] Calendar data is legacy nested format');
        }
      }
      
      if (calendarEvents && calendarEvents.length > 0) {
        // Extract semester from multiple sources with fallbacks
        let extractedSemester: number | null = null;
        
        // 1. Try attendance data first - handle both direct and wrapped formats
        if (result.data.attendance && typeof result.data.attendance === 'object') {
          // Direct format: {metadata: {semester: ...}, ...}
          if ('metadata' in result.data.attendance && result.data.attendance.metadata && typeof result.data.attendance.metadata === 'object' && 'semester' in result.data.attendance.metadata) {
            extractedSemester = (result.data.attendance.metadata as { semester?: number }).semester || null;
            console.log('[Calendar] Semester from attendance.metadata.semester (direct):', extractedSemester);
          }
          // Wrapped format: {data: {metadata: {semester: ...}}, ...}
          else if ('data' in result.data.attendance && result.data.attendance.data && typeof result.data.attendance.data === 'object' && 'metadata' in result.data.attendance.data) {
            const attendanceData = result.data.attendance.data as { metadata?: { semester?: number } };
            if (attendanceData.metadata?.semester) {
              extractedSemester = attendanceData.metadata.semester;
              console.log('[Calendar] Semester from attendance.data.metadata.semester (wrapped):', extractedSemester);
            }
          }
          // Legacy: direct semester property
          else if ('semester' in result.data.attendance) {
            extractedSemester = (result.data.attendance as { semester?: number }).semester || null;
            console.log('[Calendar] Semester from attendance.semester (legacy):', extractedSemester);
          }
        } 
        // 2. Try response metadata
        else if (result.metadata?.semester) {
          extractedSemester = result.metadata.semester;
          console.log('[Calendar] Semester from metadata.semester:', extractedSemester);
        }
        // 3. Try response root
        else if ((result as { semester?: number }).semester) {
          extractedSemester = (result as { semester?: number }).semester!;
          console.log('[Calendar] Semester from root.semester:', extractedSemester);
        }
        // 4. Try storage cache
        else {
          const cachedSemester = getStorageItem('user_semester');
          if (cachedSemester) {
            extractedSemester = parseInt(cachedSemester, 10);
            console.log('[Calendar] Semester from storage cache:', extractedSemester);
          }
        }
        
        // Default to 1 if no semester found
        const finalSemester = extractedSemester || 1;
        
        // Store semester in storage if found
        if (extractedSemester) {
          setStorageItem('user_semester', extractedSemester.toString());
          console.log('[Calendar] 💾 Stored semester in storage:', extractedSemester);
        }
        
        const modifiedCalendarData = markSaturdaysAsHolidays(calendarEvents, finalSemester);
        console.log('[Calendar] Applied holiday logic for semester:', finalSemester);
        setCalendarData(modifiedCalendarData);
        console.log('[Calendar] ✅ Calendar data loaded:', modifiedCalendarData.length);
      } else {
        // Keep page visible even when calendar data is unavailable
        console.warn('[Calendar] ⚠️ ⚠️ ⚠️ CALENDAR DATA UNAVAILABLE');
        console.warn('[Calendar]   - calendarEvents:', calendarEvents);
        console.warn('[Calendar]   - calendarEvents length:', calendarEvents?.length || 0);
        console.warn('[Calendar]   - result.data.calendar type:', typeof result.data.calendar);
        console.warn('[Calendar]   - result.data.calendar is array:', Array.isArray(result.data.calendar));
        console.warn('[Calendar]   - result.data.calendar value:', result.data.calendar);
        console.warn('[Calendar]   - Full result.data:', result.data);
        setCalendarData([]);
        // Don't set error, just log it so page remains visible
      }
      
      // Register attendance/marks fetch for smart prefetch scheduling
      if (result.success && (result.data?.attendance?.success || result.data?.marks?.success)) {
        registerAttendanceFetch();
      }

    } catch (err) {
      console.error('[Calendar] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const convertPythonDataToCalendarEvents = (data: CalendarEvent[]): CalendarEvent[] => {
    return data.map(event => ({
      date: event.date,
      day_name: event.day_name,
      content: event.content,
      day_order: event.day_order,
      month: event.month,
      month_name: event.month_name,
      year: event.year
    }));
  };

  const displayEvents = convertPythonDataToCalendarEvents(calendarData);
  
  // Calculate day order statistics from current date to Nov 21, 2025
  const getDayOrderStats = () => {
    const stats: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const currentDateStr = getCurrentDateString();
    const endDateStr = "21/11/2025";
    
    console.log(`[STATS] Counting from ${currentDateStr} to ${endDateStr}`);
    
    // Parse dates for comparison
    const parseDate = (dateStr: string) => {
      const [day, month, year] = dateStr.split('/').map(Number);
      return new Date(year, month - 1, day);
    };
    
    const currentDate = parseDate(currentDateStr);
    const endDate = parseDate(endDateStr);
    
    displayEvents.forEach(event => {
      if (event.date && event.day_order && event.day_order.startsWith('DO ')) {
        const eventDate = parseDate(event.date);
        
        // Only count events from current date onwards and before/on end date
        if (eventDate >= currentDate && eventDate <= endDate) {
          const doNumber = parseInt(event.day_order.split(' ')[1]);
          if (doNumber >= 1 && doNumber <= 5) {
            stats[doNumber]++;
            console.log(`[STATS] Found DO ${doNumber} on ${event.date}`);
          }
        }
      }
    });
    
    console.log(`[STATS] Final counts:`, stats);
    return stats;
  };

  const dayOrderStats = getDayOrderStats();
  
  const currentWeekDates = getCurrentWeekDates();
  console.log(`Current week dates:`, currentWeekDates);
  console.log(`Today is: ${getCurrentDateString()}`);
  
  // Check if any current week dates exist in calendar data
  const currentWeekInCalendar = displayEvents.filter(event => currentWeekDates.includes(event.date));
  console.log(`Current week events in calendar:`, currentWeekInCalendar.length);
  if (currentWeekInCalendar.length > 0) {
    console.log(`Found current week events:`, currentWeekInCalendar.map(e => e.date));
  }
  
  // Sort events chronologically by date (DD/MM/YYYY format)
  const sortedEvents = displayEvents.sort((a, b) => {
    if (!a.date || !b.date) return 0;
    
    // Parse dates from DD/MM/YYYY format
    const parseDate = (dateStr: string) => {
      const [day, month, year] = dateStr.split('/').map(Number);
      return new Date(year, month - 1, day);
    };
    
    return parseDate(a.date).getTime() - parseDate(b.date).getTime();
  });

  if (loading) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-8 sm:pt-9 md:pt-9 lg:pt-10 gap-10 sm:gap-12 md:gap-14 lg:gap-16">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold">Academic Calendar 25-26 ODD</div>
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora">Loading calendar data...</div>
        <div className="max-w-2xl px-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
            Meanwhile, here are some interesting facts:
          </div>
          <div className="text-gray-200 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic">
            {currentFact}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-8 sm:pt-9 md:pt-9 lg:pt-10 gap-10 sm:gap-12 md:gap-14 lg:gap-16">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold">Academic Calendar 25-26 ODD</div>
        <div className="text-red-400 text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center px-4">{error}</div>
        <div className="flex gap-3 sm:gap-4">
          <button 
            onClick={() => fetchUnifiedData()}
            className="px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base"
          >
            Retry
          </button>
          {error.includes('session') && (
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </NavigationButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-10 gap-8">
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
          className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </Link>
      
      <div className="flex flex-col items-center gap-4">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold"> Academic Calendar 25-26 ODD </div>
        <div className="text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora">
          Today&apos;s Date: {getCurrentDateString()} 
        </div>
      </div>

        <div className="relative p-3 sm:p-4 md:p-4.5 lg:p-5 z-10 w-[95vw] sm:w-[92vw] md:w-[90vw] lg:w-[90vw] h-[65vh] sm:h-[68vh] md:h-[69vh] lg:h-[70vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center overflow-y-auto">
          <div 
            ref={setScrollContainerRef}
            className="relative overflow-y-auto p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-[90vw] sm:w-[85vw] md:w-[83vw] lg:w-[80vw] h-[55vh] sm:h-[58vh] md:h-[59vh] lg:h-[60vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-2 sm:gap-2.5 md:gap-3 lg:gap-3 justify-start items-center"
          >
            {sortedEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 h-full">
                <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
                  No calendar data available
                </div>
                <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
                  Calendar data will be loaded from the server
                </div>
              </div>
            ) : (
              sortedEvents.map((event, index) => {
              // Check if it's a holiday based on DO value being "-", "DO -", or "Holiday", or content includes "holiday"
              const isHoliday = event.day_order === "-" || event.day_order === "DO -" || event.day_order === "Holiday" || event.content.toLowerCase().includes('holiday');
              
              // Check if it's the current date
              const currentDateStr = getCurrentDateString();
              const isCurrentDate = event.date === currentDateStr;
              
              // Debug logging for current date detection
              if (isCurrentDate) {
                console.log(`Current date event found: ${event.date}`);
              }
              
              // Determine background color and text color
              let bgColor = 'bg-white/10';
              let textColor = 'text-white';
              
              if (isCurrentDate) {
                bgColor = 'bg-white';
                textColor = 'text-black';
              } else if (isHoliday) {
                bgColor = 'bg-green-500/80';
                textColor = 'text-white';
              }
              
              const hoverColor = isCurrentDate ? 'bg-gray-100' : (isHoliday ? 'bg-green-500' : 'bg-white/20');
              const doText = isHoliday ? 'Holiday' : event.day_order;
              
              return (
                <div 
                  key={index}
                  data-date={event.date}
                  className={`relative p-2.5 sm:p-2.5 md:p-3 lg:p-3 z-10 w-[85vw] sm:w-[80vw] md:w-[78vw] lg:w-[76vw] h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-between items-center hover:${hoverColor} transition-colors`}
                >
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[90px] sm:min-w-[100px] md:min-w-[110px] lg:min-w-[120px]`}>
                    {event.date} {isCurrentDate ? '' : ''}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex-1 text-center`}>{event.content || ''}</p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[75px] lg:min-w-[80px] text-right`}>{doText}</p>
                </div>
              );
              })
            )}
          </div>
        </div>
        
        {/* Day Order Statistics */}
        <div className="w-[95vw] sm:w-[92vw] md:w-[91vw] lg:w-[90vw] bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-5 md:p-5.5 lg:p-6 items-center justify-center gap-3 sm:gap-4 md:gap-4.5 lg:gap-5">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2 text-center">
            Day Order Statistics
            </div>
          <div className="text-white/70 text-xs sm:text-sm font-sora text-center mb-3 sm:mb-4">
            From {getCurrentDateString()} to 21/11/2025
            </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-3 sm:gap-4">
            {[1, 2, 3, 4, 5].map(doNumber => (
              <div key={doNumber} className="bg-white/20 rounded-2xl p-3 sm:p-3.5 md:p-4 lg:p-4 text-center">
                <div className="text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora font-bold mb-1.5 sm:mb-2">
                  DO {doNumber}
            </div>
                <div className="text-green-500 text-xl sm:text-2xl md:text-2xl lg:text-3xl font-sora font-bold">
                  {dayOrderStats[doNumber]}
            </div>
                <div className="text-white/70 text-xs sm:text-sm font-sora">
                  days left
            </div>
          </div> 
            ))}
          </div>
          <div className="text-gray-200 font-sora font-light text-[10px] sm:text-xs md:text-sm lg:text-sm"> Note: This is specifically for your course. For general course, please refer to the course calendar.</div>
        </div>


        {/* Re-auth Modal */}
        {showPasswordModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-gray-700 rounded-lg p-8 max-w-md w-full mx-4">
              <h2 className="text-2xl font-bold text-white mb-4">Session Expired</h2>
              <p className="text-gray-200 mb-6">
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
