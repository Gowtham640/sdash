'use client';
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from 'next/link';
import LiquidEther from "@/components/LiquidEther";
import { Calendar } from "@/components/ui/calendar";
import { markSaturdaysAsHolidays } from "@/lib/calendarHolidays";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";

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
  const router = useRouter();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFact, setCurrentFact] = useState(getRandomFact());
  const [error, setError] = useState<string | null>(null);
  const [scrollContainerRef, setScrollContainerRef] = useState<HTMLDivElement | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    router.push('/auth');
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
        console.error('[Calendar] No access token found');
        setError('Please sign in to view calendar');
        setLoading(false);
        return;
      }

      // ✅ STEP 1: Check browser cache first (unless force refresh)
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      const cacheMaxAge = 10 * 60 * 1000; // 10 minutes
      const refreshTriggerAge = 9 * 60 * 1000; // 9 minutes - start background refresh
      
      if (!forceRefresh) {
        const cachedData = getStorageItem(cacheKey);
        const cachedTimestamp = getStorageItem(cachedTimestampKey);
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp);
          
          if (age < cacheMaxAge) {
            console.log('[Calendar] ✅ Using browser cache');
            const result = JSON.parse(cachedData);
            
              // Process the cached data
            if (result.success) {
              setCacheInfo({
                cached: true,
                age: Math.floor((Date.now() - parseInt(cachedTimestamp)) / 1000)
              });

              // Process calendar data
              if (result.data.calendar?.success && result.data.calendar.data) {
                let calendarEvents = result.data.calendar.data;
                
                // Extract semester from multiple sources with fallbacks
                let extractedSemester: number | null = null;
                
                // 1. Try attendance data first
                if (result.data.attendance?.semester) {
                  extractedSemester = result.data.attendance.semester;
                  console.log('[Calendar] Semester from attendance.semester:', extractedSemester);
                } else if (result.data.attendance?.data?.metadata?.semester) {
                  extractedSemester = result.data.attendance.data.metadata.semester;
                  console.log('[Calendar] Semester from attendance.data.metadata.semester:', extractedSemester);
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
                const semester = extractedSemester || 1;
                
                // Store semester in storage if found
                if (extractedSemester) {
                  setStorageItem('user_semester', extractedSemester.toString());
                  console.log('[Calendar] 💾 Stored semester in storage:', extractedSemester);
                }
                
                console.log(`[Calendar] User semester: ${semester} (from cache)`);
                
                // Mark Saturdays as holidays if not semester 1
                calendarEvents = markSaturdaysAsHolidays(calendarEvents, semester);
                
                setCalendarData(calendarEvents);
                console.log('[Calendar] Loaded calendar with', calendarEvents.length, 'events');
              } else {
                throw new Error('Calendar data unavailable');
              }
              
              setLoading(false);
              return;
            }
          } else {
            console.log('[Calendar] Browser cache expired');
          }
        }
      }

      // ✅ STEP 2: Fetch from API (will use server cache if available)
      console.log('[Calendar] Fetching from API...', forceRefresh ? '(force refresh)' : '(checking server cache)');

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
      });

      const result = await response.json();
      console.log('[Calendar] Unified API response:', result);

      // ✅ STEP 3: Store in browser cache for next time
      if (result.success) {
        setStorageItem(cacheKey, JSON.stringify(result));
        setStorageItem(cachedTimestampKey, Date.now().toString());
        console.log('[Calendar] ✅ Stored in browser cache');
      }

      // Handle session expiry - use cached data if available
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[Calendar] Session expired - checking for cached data...');
        
        // Check if we have cached data to fall back to
        const cacheKey = 'unified_data_cache';
        const cachedData = getStorageItem(cacheKey);
        if (cachedData) {
          console.log('[Calendar] Using cached data as fallback');
          const cachedResult = JSON.parse(cachedData);
          
          if (cachedResult.success && cachedResult.data.calendar?.success && cachedResult.data.calendar.data) {
            let calendarEvents = cachedResult.data.calendar.data;
            
            // Extract semester from multiple sources with fallbacks
            let extractedSemester: number | null = null;
            
            // 1. Try attendance data first
            if (cachedResult.data.attendance?.semester) {
              extractedSemester = cachedResult.data.attendance.semester;
            } else if (cachedResult.data.attendance?.data?.metadata?.semester) {
              extractedSemester = cachedResult.data.attendance.data.metadata.semester;
            }
            // 2. Try response metadata
            else if (cachedResult.metadata?.semester) {
              extractedSemester = cachedResult.metadata.semester;
            }
            // 3. Try response root
            else if ((cachedResult as { semester?: number }).semester) {
              extractedSemester = (cachedResult as { semester?: number }).semester!;
            }
            // 4. Try storage cache
            else {
              const cachedSemester = getStorageItem('user_semester');
              if (cachedSemester) {
                extractedSemester = parseInt(cachedSemester, 10);
              }
            }
            
            // Default to 1 if no semester found
            const semester = extractedSemester || 1;
            
            // Store semester in storage if found
            if (extractedSemester) {
              setStorageItem('user_semester', extractedSemester.toString());
            }
            
            // Mark Saturdays as holidays if not semester 1
            calendarEvents = markSaturdaysAsHolidays(calendarEvents, semester);
            
            setCalendarData(calendarEvents);
            setCacheInfo({ cached: true, age: 9999 });
            setError('Showing cached data (session expired). Refresh to get latest data.');
            setLoading(false);
            return;
          }
        }
        
        // No cached data - show password modal
        console.error('[Calendar] No cached data, prompting for re-authentication');
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data');
      }

      // Extract cache info
      setCacheInfo({
        cached: result.metadata?.cached || false,
        age: result.metadata?.cache_age_seconds || 0
      });

      // Process calendar data
      if (result.data.calendar?.success && result.data.calendar.data) {
        let calendarEvents = result.data.calendar.data;
        
        // Extract semester from multiple sources with fallbacks
        let extractedSemester: number | null = null;
        
        // 1. Try attendance data first
        if (result.data.attendance?.semester) {
          extractedSemester = result.data.attendance.semester;
          console.log('[Calendar] Semester from attendance.semester:', extractedSemester);
        } else if (result.data.attendance?.data?.metadata?.semester) {
          extractedSemester = result.data.attendance.data.metadata.semester;
          console.log('[Calendar] Semester from attendance.data.metadata.semester:', extractedSemester);
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
        const semester = extractedSemester || 1;
        
        // Store semester in storage if found
        if (extractedSemester) {
          setStorageItem('user_semester', extractedSemester.toString());
          console.log('[Calendar] 💾 Stored semester in storage:', extractedSemester);
        }
        
        console.log(`[Calendar] User semester: ${semester}`);
        
        // Mark Saturdays as holidays if not semester 1
        calendarEvents = markSaturdaysAsHolidays(calendarEvents, semester);
        
        setCalendarData(calendarEvents);
        console.log('[Calendar] Loaded calendar with', calendarEvents.length, 'events');
      } else {
        throw new Error('Calendar data unavailable');
      }

    } catch (err) {
      console.error('[Calendar] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
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
            <button 
              onClick={handleReAuthenticate}
              className="px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </button>
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
            {sortedEvents.map((event, index) => {
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
            })}
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
              <button
                onClick={handleReAuthenticate}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
              >
                Sign In
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
