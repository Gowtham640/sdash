'use client';
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { 
  getCachedTimetable, 
  getCachedCalendar, 
  isLongTermCacheValid, 
  storeLongTermCache,
  getLongTermCacheAge,
  getLongTermCacheDaysRemaining 
} from '@/lib/longTermCache';

// Import types
interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
}

interface AttendanceSubject {
  course_title: string;
  category: string;
  hours_conducted: string;
  hours_absent: string;
  hours_required: string;
  attendance_percentage: string;
}

interface AttendanceData {
  all_subjects: AttendanceSubject[];
}

interface MarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: Array<{
    assessment_name: string;
    marks_obtained: string;
    total_marks: string;
    percentage: string;
  }>;
}

interface MarksData {
  all_courses: MarksCourse[];
}

interface TimeSlot {
  time: string;
  course_title: string;
  category: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [timetableData, setTimetableData] = useState<{
    timetable?: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }>;
    slot_mapping?: Record<string, string>;
  } | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentFact, setCurrentFact] = useState(getRandomFact());
  const menuItems = [
    { label: 'Home', ariaLabel: 'Go to home page', link: '/' },
    { label: 'About', ariaLabel: 'Learn about us', link: '/about' },
    { label: 'Services', ariaLabel: 'View our services', link: '/services' },
    { label: 'Contact', ariaLabel: 'Get in touch', link: '/contact' }
  ];
  
  const socialItems = [
    { label: 'Twitter', link: 'https://twitter.com' },
    { label: 'GitHub', link: 'https://github.com' },
    { label: 'LinkedIn', link: 'https://linkedin.com' }
  ];

  // Get current date in DD/MM/YYYY format
  const getCurrentDateString = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Get yesterday, today, and tomorrow dates
  const getThreeDayDates = () => {
    const today = new Date();
    const dates = [];
    
    for (let i = -1; i <= 1; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      dates.push({
        dateStr: `${day}/${month}/${year}`,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateObj: date
      });
    }
    
    return dates;
  };

  // Get current day's day order
  const getCurrentDayOrder = () => {
    const currentDate = getCurrentDateString();
    const currentEvent = calendarData.find(event => event.date === currentDate);
    return currentEvent?.day_order || null;
  };

  // Get current day's day order number
  const getCurrentDayOrderNumber = () => {
    const dayOrder = getCurrentDayOrder();
    if (dayOrder && dayOrder.startsWith('DO ')) {
      return parseInt(dayOrder.split(' ')[1]);
    }
    return null;
  };

  // Get today's timetable based on day order
  const getTodaysTimetable = () => {
    const doNumber = getCurrentDayOrderNumber();
    if (!doNumber || !timetableData?.timetable) {
      return [];
    }

    const doKey = `DO ${doNumber}`;
    const dayTimetable = timetableData?.timetable?.[doKey];
    
    if (!dayTimetable?.time_slots) {
      return [];
    }

    // Convert to array of {time, course_title, category}
    const timeSlots: TimeSlot[] = [];
    Object.entries(dayTimetable.time_slots).forEach(([time, slot]: [string, unknown]) => {
      const typedSlot = slot as { slot_code?: string; slot_type?: string };
      if (typedSlot?.slot_code) {
        // Find course title from slot mapping
        const slotCode = typedSlot.slot_code;
        const slotMapping = timetableData?.slot_mapping || {};
        const courseTitle = slotMapping[slotCode] || '';
        
        timeSlots.push({
          time,
          course_title: courseTitle,
          category: typedSlot.slot_type || ''
        });
      }
    });

    return timeSlots.sort((a, b) => a.time.localeCompare(b.time));
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

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
    router.push('/auth');
  };

  const refreshInBackground = async () => {
    if (isRefreshing) {
      return; // Already refreshing
    }
    
    setIsRefreshing(true);
    console.log('[Dashboard] Background refresh started');
    
    try {
      const access_token = localStorage.getItem('access_token');
      if (!access_token) {
        console.error('[Dashboard] No access token for background refresh');
        return;
      }

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, false))
      });

      const result = await response.json();

      if (result.success) {
        const cacheKey = 'unified_data_cache';
        const cachedTimestampKey = 'unified_data_cache_timestamp';
        
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cachedTimestampKey, Date.now().toString());
        console.log('[Dashboard] ✅ Cache refreshed in background');
      } else {
        console.error('[Dashboard] ❌ Background refresh failed:', result.error);
      }
    } catch (err) {
      console.error('[Dashboard] Background refresh error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const access_token = localStorage.getItem('access_token');
      
      if (!access_token) {
        console.error('[Dashboard] No access token found');
        setError('Please sign in to view dashboard');
        setLoading(false);
        return;
      }

      // Check browser cache first
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      const cacheMaxAge = 10 * 60 * 1000; // 10 minutes
      const refreshTriggerAge = 9 * 60 * 1000; // 9 minutes - start background refresh
      
      if (!forceRefresh) {
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTimestamp = localStorage.getItem(cachedTimestampKey);
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp);
          
          if (age < cacheMaxAge) {
            console.log('[Dashboard] ✅ Using browser cache');
            const result = JSON.parse(cachedData);
            
            if (result.success) {
              processUnifiedData(result);
              setLoading(false);
              
              // Background refresh if cache is expiring soon
              const isExpiringSoon = age > refreshTriggerAge;
              if (isExpiringSoon && !isRefreshing) {
                console.log('[Dashboard] ⏰ Cache expiring soon, refreshing in background...');
                refreshInBackground();
              }
              
              return;
            }
          }
        }
      }

      // Check long-term cache for timetable/calendar
      console.log("[Dashboard] 🔍 Checking long-term cache...");
      const cachedTimetable = !forceRefresh ? getCachedTimetable() : null;
      const cachedCalendar = !forceRefresh ? getCachedCalendar() : null;
      const hasLongTermCache = !!(isLongTermCacheValid() && cachedTimetable && cachedCalendar);

      if (hasLongTermCache) {
        const daysLeft = getLongTermCacheDaysRemaining();
        const cacheAge = getLongTermCacheAge();
        console.log(`[Dashboard] ✅ Long-term cache FOUND`);
        console.log(`[Dashboard]   - Cache age: ${cacheAge} days`);
        console.log(`[Dashboard]   - Days remaining: ${daysLeft} days`);
      } else {
        console.log(`[Dashboard] ❌ Long-term cache NOT FOUND or EXPIRED`);
      }

      // Fetch from API
      const apiStartTime = Date.now();
      const fetchType = forceRefresh ? '(force refresh all)' : (hasLongTermCache ? '(fetching attendance/marks only - optimized)' : '(fetching all data)');
      console.log(`[Dashboard] 🚀 Fetching from API ${fetchType}`);
      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh, hasLongTermCache))
      });

      const apiDuration = Date.now() - apiStartTime;
      let result = await response.json();
      
      console.log(`[Dashboard] 📡 API response received: ${apiDuration}ms`);
      console.log(`[Dashboard]   - Success: ${result.success}`);
      console.log(`[Dashboard]   - Status: ${response.status}`);
      console.log(`[Dashboard]   - Partial data: ${result.metadata?.partial_data || false}`);

      // Merge long-term cache with API response if needed
      if (hasLongTermCache && result.metadata?.partial_data && !forceRefresh) {
        console.log('[Dashboard] 🔗 Merging long-term cache with fresh attendance/marks');
        result = {
          ...result,
          data: {
            ...result.data,
            timetable: {
              success: true,
              data: cachedTimetable,
              cached: true,
              age_days: getLongTermCacheAge()
            },
            calendar: {
              success: true,
              data: cachedCalendar,
              cached: true,
              age_days: getLongTermCacheAge()
            }
          },
          metadata: {
            ...result.metadata,
            timetable_cached: true,
            calendar_cached: true,
            cache_days_remaining: getLongTermCacheDaysRemaining()
          }
        };
      }

      // Store timetable/calendar in long-term cache if fresh data received
      if (result.success && !hasLongTermCache && result.data?.timetable?.success && result.data?.timetable?.data &&
          result.data?.calendar?.success && result.data?.calendar?.data) {
        console.log('[Dashboard] 💾 Storing timetable & calendar in long-term cache...');
        storeLongTermCache(
          result.data.timetable.data,
          result.data.calendar.data
        );
        console.log('[Dashboard] ✅ Stored in long-term cache (valid for 30 days)');
      }

      // Store in browser cache
      if (result.success) {
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cachedTimestampKey, Date.now().toString());
      }

      if (!response.ok || (result.error === 'session_expired')) {
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data');
      }

      processUnifiedData(result);

    } catch (err) {
      console.error('[Dashboard] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const processUnifiedData = (result: {
    data: {
      calendar?: { data?: Array<unknown>; success?: { data?: Array<unknown> } } | null;
      attendance?: { data?: { all_subjects: unknown[] }; success?: { data?: { all_subjects: unknown[] } } } | null;
      marks?: { data?: { all_courses: unknown[] }; success?: { data?: { all_courses: unknown[] } } } | null;
      timetable?: { data?: unknown; success?: { data?: unknown } } | null;
    };
  }) => {
    console.log('[Dashboard] Processing unified data:', result);
    console.log('[Dashboard] Attendance data:', result.data.attendance);
    console.log('[Dashboard] Marks data:', result.data.marks);
    
    // Process calendar data - handle both nested structures
    const calendar = result.data.calendar?.data || result.data.calendar?.success?.data;
    if (calendar && Array.isArray(calendar)) {
      setCalendarData(calendar as CalendarEvent[]);
      console.log('[Dashboard] ✅ Calendar data loaded:', calendar.length);
    } else {
      console.warn('[Dashboard] ⚠️ No calendar data found');
    }

    // Process attendance data - handle both nested structures
    const attendance = result.data.attendance?.data || result.data.attendance?.success?.data;
    if (attendance && attendance.all_subjects) {
      setAttendanceData(attendance as AttendanceData);
      console.log('[Dashboard] ✅ Attendance data loaded:', attendance.all_subjects.length);
    } else {
      console.warn('[Dashboard] ⚠️ No attendance data found', attendance);
    }

    // Process marks data - handle both nested structures
    const marks = result.data.marks?.data || result.data.marks?.success?.data;
    if (marks && marks.all_courses) {
      setMarksData(marks as MarksData);
      console.log('[Dashboard] ✅ Marks data loaded:', marks.all_courses.length);
    } else {
      console.warn('[Dashboard] ⚠️ No marks data found', marks);
    }

    // Process timetable data - handle both nested structures
    const timetable = result.data.timetable?.data || result.data.timetable?.success?.data;
    if (timetable) {
      setTimetableData(timetable);
      
      try {
        const occurrences = getSlotOccurrences(timetable);
        setSlotOccurrences(occurrences);
        console.log('[Dashboard] ✅ Timetable data loaded:', occurrences.length);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing timetable:', err);
      }
    } else {
      console.warn('[Dashboard] ⚠️ No timetable data found');
    }

    // Process day order stats
    if (calendar && Array.isArray(calendar)) {
      try {
        const stats = getDayOrderStats(calendar);
        setDayOrderStats(stats);
        console.log('[Dashboard] ✅ Day order stats loaded:', stats);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing day order stats:', err);
      }
    }
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  if (loading) {
  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
      <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Loading your Dashboard...
        </div>
        <div className="max-w-2xl px-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
            Meanwhile, here are some interesting facts:
          </div>
          <div className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic">
            {currentFact}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
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

  const threeDayDates = getThreeDayDates();
  const todaysTimetable = getTodaysTimetable();
  const currentDayOrder = getCurrentDayOrder();

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
      <PillNav
        logo=""
        logoAlt=""
        items={[
          { label: 'Attendance', href: '/attendance' },
          { label: 'Timetable', href: '/timetable' },
          { label: 'Marks', href: '/marks' },
          { label: 'Calendar', href: '/calender' }
        ]}
        activeHref="/dashboard"
        className="custom-nav"
        ease="power2.easeOut"
        pillColor="#000000"
        baseColor="#ffffff"
        hoveredPillTextColor="#000000"
        pillTextColor="#ffffff"
      />
      <div className="mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Welcome to your Dashboard
        </div>
      </div>

      {/* Calendar Section - Show 3 days (Yesterday, Today, Tomorrow) */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Upcoming Calendar
        </div>
        <div className="flex flex-col gap-3 w-full">
          {threeDayDates.map((dayInfo) => {
            const event = calendarData.find(e => e.date === dayInfo.dateStr);
            const isToday = dayInfo.dateStr === getCurrentDateString();
            const isHoliday = event?.day_order === "-" || event?.day_order === "DO -" || event?.content.toLowerCase().includes('holiday');
            
            let bgColor = 'bg-white/10';
            let textColor = 'text-white';
            
            if (isToday) {
              bgColor = 'bg-white';
              textColor = 'text-black';
            } else if (isHoliday) {
              bgColor = 'bg-green-500/80';
              textColor = 'text-white';
            }
            
            return (
              <div 
                key={dayInfo.dateStr}
                className={`relative p-2.5 sm:p-2.5 md:p-3 lg:p-3 z-10 w-full h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-between items-center`}
              >
                <div className="flex gap-2 sm:gap-3 md:gap-4 lg:gap-4 items-center">
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[70px] sm:min-w-[80px] md:min-w-[90px] lg:min-w-[100px]`}>
                    {dayInfo.dayName}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora`}>
                    {dayInfo.dateStr}
                  </p>
                </div>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex-1 text-center`}>
                  {event?.content || 'No events'}
                </p>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[75px] lg:min-w-[80px] text-right`}>
                  {event?.day_order || '-'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Timetable Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Today&apos;s Timetable {currentDayOrder && `- ${currentDayOrder}`}
        </div>
        {todaysTimetable.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {todaysTimetable.map((slot, index) => (
              <div 
                key={index}
                className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-start items-center"
              >
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-light min-w-[100px] sm:min-w-[120px] md:min-w-[130px] lg:min-w-[150px]">
                  {slot.time}
                </div>
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold flex-1">
                  {slot.course_title || 'No class'}
                </div>
                {slot.category && (
                  <div className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                    {slot.category}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            {currentDayOrder ? 'No classes today' : 'Unable to determine day order'}
          </div>
        )}
      </div>

      {/* Attendance Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Attendance Overview
        </div>
        {attendanceData?.all_subjects && attendanceData.all_subjects.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {attendanceData.all_subjects.map((subject, index) => {
              const attendancePercent = parseFloat(subject.attendance_percentage.replace('%', ''));
              
              return (
                <div 
                  key={index}
                  className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                      {subject.course_title}
                    </p>
                    <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                      {subject.category}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className={`text-lg sm:text-xl md:text-2xl lg:text-2xl font-bold ${attendancePercent >= 75 ? 'text-green-400' : 'text-red-400'}`}>
                      {subject.attendance_percentage}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No attendance data available
          </div>
        )}
      </div>

      {/* Marks Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Marks Overview
        </div>
        {marksData?.all_courses && marksData.all_courses.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {marksData.all_courses
              .filter(course => course.assessments && course.assessments.length > 0)
              .filter((course, index, self) => 
                index === self.findIndex(c => 
                  c.course_code === course.course_code && c.subject_type === course.subject_type
                )
              )
              .map((course, index) => {
              const getCourseTitle = (course: MarksCourse): string => {
                return course.course_title || course.course_code;
              };

              const getTotalMarks = () => {
                if (!course.assessments || course.assessments.length === 0) return { obtained: 0, total: 0 };
                const obtained = course.assessments.reduce((sum, a) => sum + (parseFloat(a.marks_obtained) || 0), 0);
                const total = course.assessments.reduce((sum, a) => sum + (parseFloat(a.total_marks) || 0), 0);
                return { obtained, total };
              };

              const { obtained, total } = getTotalMarks();
              
              return (
                <div 
                  key={`${course.course_code}-${course.subject_type}-${index}`}
                  className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                      {getCourseTitle(course)}
                    </p>
                    <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                      {course.course_code} • {course.subject_type}
                    </p>
                  </div>
                  <div className="flex gap-4 sm:gap-5 md:gap-6 lg:gap-6 items-center">
                    <div className="text-center">
                      <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Obtained</p>
                      <p className="text-green-400 text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{obtained.toFixed(1)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Total</p>
                      <p className="text-white text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{total.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No marks data available
          </div>
        )}
      </div>

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-white mb-4">Session Expired</h2>
            <p className="text-gray-300 mb-6">
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
