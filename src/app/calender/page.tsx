'use client';
import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from 'next/link';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { DEFAULT_RANDOM_FACT, getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { getClientCache, removeClientCache, setClientCache } from "@/lib/clientCache";
import { trackPostRequest } from "@/lib/postAnalytics";
import { getSemesterLastWorkingDayInclusive } from "@/lib/calendarHolidays";
import TopAppBar from "@/components/sdash/TopAppBar";
import PillNav from "@/components/sdash/PillNav";
import GlassCard from "@/components/sdash/GlassCard";
import StatChip from "@/components/sdash/StatChip";
import { CalendarMonthGrid } from "@/components/sdash/CalendarMonthGrid";
import { Check } from "lucide-react";

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: number;
}

/** Parse API date string DD/MM/YYYY */
const parseDdMmYyyy = (dateStr: string): Date | null => {
  const parts = dateStr.split("/").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return null;
  }
  const [day, month, year] = parts;
  return new Date(year, month - 1, day);
};

/** e.g. 1 -> 1st, 29 -> 29th (for holiday row top-right). */
const formatOrdinalDayOfMonth = (d: Date): string => {
  const n = d.getDate();
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/** Portal-style holiday / day-off row (matches list + month cells). */
const isHolidayEvent = (event: CalendarEvent): boolean =>
  event.day_order === "-" ||
  event.day_order === "DO -" ||
  event.day_order === "Holiday" ||
  Boolean(event.content && event.content.toLowerCase().includes("holiday"));

/** Numeric day order 1–5 only; holidays excluded. */
const getNumericDayOrder = (event: CalendarEvent): number | null => {
  if (isHolidayEvent(event)) {
    return null;
  }
  const n = Number(String(event.day_order ?? "").trim());
  if (Number.isNaN(n) || n < 1 || n > 5) {
    return null;
  }
  return n;
};

export default function CalendarPage() {
  const initialCalendarCache = useMemo(() => getClientCache<CalendarEvent[]>('calendar') ?? [], []);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>(initialCalendarCache);
  const [loading, setLoading] = useState(initialCalendarCache.length === 0);
  const [currentFact, setCurrentFact] = useState(DEFAULT_RANDOM_FACT);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/calender');
  const [scrollContainerRef, setScrollContainerRef] = useState<HTMLDivElement | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const fetchUnifiedDataRef = useRef<(() => Promise<void>) | null>(null);
  /** List (grouped) vs month grid — academic-compass style */
  const [calendarUiMode, setCalendarUiMode] = useState<"list" | "month">("month");
  /** First day of the month shown in month view */
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

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
    fetchUnifiedDataRef.current = fetchUnifiedData;
  });

  useEffect(() => {
    void fetchUnifiedDataRef.current?.();
  }, []);

  // Rotate facts every 8 seconds while loading
  useEffect(() => {
    if (!loading) return;
    setCurrentFact(getRandomFact());

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
      const shouldShowLoading = calendarData.length === 0;
      setLoading(shouldShowLoading);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Calendar] No access token found');
        setError('Please sign in to view calendar');
        setLoading(false);
        return;
      }

      // Calendar is always fetched fresh from public.calendar table
      // Remove any old calendar cache that might exist
      removeClientCache('calendar');
      console.log('[Calendar] 🗑️ Removed any existing calendar cache (calendar is always fresh)');

      // Also check and clean unified cache if it contains calendar data
      const unifiedCache = getClientCache('unified');
      if (unifiedCache && typeof unifiedCache === 'object' && 'data' in unifiedCache) {
        const unifiedData = unifiedCache as { data?: { calendar?: unknown } };
        if (unifiedData.data?.calendar) {
          console.log('[Calendar] 🗑️ Found calendar in unified cache, removing it');
          // Remove calendar from unified cache data
          if (unifiedData.data) {
            delete unifiedData.data.calendar;
            setClientCache('unified', unifiedCache);
            console.log('[Calendar] ✅ Cleaned calendar from unified cache');
          }
        }
      }

      // Fetch all data (like dashboard) to get attendance data for semester extraction
      console.log(`[Calendar] 🚀 Fetching calendar data from API (always fresh from public.calendar)`);

      // Use request deduplication for unified API calls
      // Calendar is always fetched fresh from public.calendar table regardless
      const requestKey = `fetch_calendar_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await trackPostRequest('/api/data/all', {
          action: 'data_unified_fetch',
          dataType: 'user',
          payload: getRequestBodyWithPassword(access_token, false),
          omitPayloadKeys: ['password', 'access_token'],
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
      console.log('[Calendar] 📋 ========================================');
      console.log('[Calendar] 📋 CALENDAR PROCESSING - Starting calendar data processing');
      console.log('[Calendar] 📋   - result.data.calendar exists:', !!result.data.calendar);
      console.log('[Calendar] 📋   - result.data.calendar type:', typeof result.data.calendar);
      console.log('[Calendar] 📋   - result.data.calendar is array:', Array.isArray(result.data.calendar));
      if (result.data.calendar && Array.isArray(result.data.calendar)) {
        console.log('[Calendar] 📋   - Calendar array length:', result.data.calendar.length);
        if (result.data.calendar.length > 0) {
          console.log('[Calendar] 📋   - First event sample:', JSON.stringify(result.data.calendar[0], null, 2).substring(0, 200));
          console.log('[Calendar] 📋   - Last event sample:', JSON.stringify(result.data.calendar[result.data.calendar.length - 1], null, 2).substring(0, 200));
        }
      }
      console.log('[Calendar] 📋 ========================================');

      let calendarEvents: CalendarEvent[] | null = null;

      if (Array.isArray(result.data.calendar)) {
        // Map JSON format to CalendarEvent interface
        calendarEvents = result.data.calendar.map((e: any) => ({
          date: e.date,
          day_name: e.day_name,
          content: e.event ?? '',
          day_order: e.day_order,
          month: e.month,
          year: e.year
        }));
        console.log('[Calendar] ✅ Calendar data processed');
        console.log('[Calendar]   - Total events:', calendarEvents?.length ?? 0);
      } else if (result.data.calendar && typeof result.data.calendar === 'object') {
        // Check if it's wrapped format: {success: true, data: [...]}
        if ('success' in result.data.calendar && 'data' in result.data.calendar) {
          const calendarWrapper = result.data.calendar as { success?: boolean | { data?: CalendarEvent[] }; data?: CalendarEvent[] };
          const successValue = calendarWrapper.success;
          const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
          if (isSuccess && Array.isArray(calendarWrapper.data)) {
            calendarEvents = calendarWrapper.data;
            console.log('[Calendar] ✅ Calendar data is wrapped format');
            console.log('[Calendar]   - Total events:', calendarEvents?.length ?? 0);
          }
        }
        // Check legacy nested format: {data: [...]}
        else if ('data' in result.data.calendar && Array.isArray((result.data.calendar as { data?: CalendarEvent[] }).data)) {
          calendarEvents = (result.data.calendar as { data: CalendarEvent[] }).data;
          console.log('[Calendar] ✅ Calendar data is legacy nested format');
          console.log('[Calendar]   - Total events:', calendarEvents?.length ?? 0);
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

        console.log('[Calendar] 📋 Calendar events count:', calendarEvents.length);
        if (calendarEvents.length > 0) {
          console.log('[Calendar] 📋   - First event:', JSON.stringify(calendarEvents[0], null, 2).substring(0, 200));
          console.log('[Calendar] 📋   - Sample dates range:', calendarEvents[0]?.date, 'to', calendarEvents[calendarEvents.length - 1]?.date);
        }
        // Display calendar data as-is without holiday modifications
        setCalendarData(calendarEvents);
        console.log('[Calendar] ✅ ✅ ✅ Calendar data loaded and set:', calendarEvents.length, 'events');
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

  const sortedEvents = useMemo(() => {
    const list = calendarData.map((event) => ({
      date: event.date,
      day_name: event.day_name,
      content: event.content,
      day_order: event.day_order,
      month: event.month,
      month_name: event.month_name,
      year: event.year,
    }));
    return [...list].sort((a, b) => {
      if (!a.date || !b.date) {
        return 0;
      }
      const da = parseDdMmYyyy(a.date);
      const db = parseDdMmYyyy(b.date);
      if (!da || !db) {
        return 0;
      }
      return da.getTime() - db.getTime();
    });
  }, [calendarData]);

  const eventsGroupedByMonth = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    sortedEvents.forEach((event) => {
      if (!event.date) {
        return;
      }
      const d = parseDdMmYyyy(event.date);
      if (!d) {
        return;
      }
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(event);
    });
    return map;
  }, [sortedEvents]);

  /**
   * How many more times each day order (1–5) appears from today through the last working day
   * of the semester (unique dates per DO; non-holiday rows with valid DO only).
   * Window is capped by semester end and by the latest date present in loaded calendar data.
   */
  const { remainingDayOrderCountsThroughSemester, statsPeriodEndLabel } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    todayStart.setHours(0, 0, 0, 0);

    const semesterEnd = getSemesterLastWorkingDayInclusive();
    let maxData: Date | null = null;
    sortedEvents.forEach((e) => {
      const d = parseDdMmYyyy(e.date);
      if (!d) {
        return;
      }
      d.setHours(0, 0, 0, 0);
      if (!maxData || d.getTime() > maxData.getTime()) {
        maxData = d;
      }
    });

    const periodEnd = new Date(
      Math.min(semesterEnd.getTime(), (maxData ?? semesterEnd).getTime()),
    );
    periodEnd.setHours(0, 0, 0, 0);

    const datesPerDo: Record<number, Set<string>> = {
      1: new Set(),
      2: new Set(),
      3: new Set(),
      4: new Set(),
      5: new Set(),
    };

    sortedEvents.forEach((e) => {
      const d = parseDdMmYyyy(e.date);
      if (!d) {
        return;
      }
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < todayStart.getTime() || d.getTime() > periodEnd.getTime()) {
        return;
      }
      const n = getNumericDayOrder(e);
      if (n === null) {
        return;
      }
      datesPerDo[n].add(e.date);
    });

    const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (let n = 1; n <= 5; n++) {
      out[n] = datesPerDo[n].size;
    }

    const dd = String(periodEnd.getDate()).padStart(2, "0");
    const mm = String(periodEnd.getMonth() + 1).padStart(2, "0");
    const yyyy = periodEnd.getFullYear();
    const statsPeriodEndLabel = `${dd}/${mm}/${yyyy}`;

    return { remainingDayOrderCountsThroughSemester: out, statsPeriodEndLabel };
  }, [sortedEvents]);

  /**
   * Holidays in the real-world current month only (weekends excluded — not listed as holidays).
   * One card per date (first holiday row for that date wins).
   */
  const holidaysThisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const seenDate = new Set<string>();
    return sortedEvents.filter((e) => {
      if (!isHolidayEvent(e)) {
        return false;
      }
      const d = parseDdMmYyyy(e.date);
      if (!d || d.getFullYear() !== y || d.getMonth() !== mo) {
        return false;
      }
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        return false;
      }
      if (seenDate.has(e.date)) {
        return false;
      }
      seenDate.add(e.date);
      return true;
    });
  }, [sortedEvents]);

  const currentWeekDates = getCurrentWeekDates();
  console.log(`Current week dates:`, currentWeekDates);
  console.log(`Today is: ${getCurrentDateString()}`);

  // Check if any current week dates exist in calendar data
  const currentWeekInCalendar = sortedEvents.filter(event => currentWeekDates.includes(event.date));
  console.log(`Current week events in calendar:`, currentWeekInCalendar.length);
  if (currentWeekInCalendar.length > 0) {
    console.log(`Found current week events:`, currentWeekInCalendar.map(e => e.date));
  }

  const scrollToToday = () => {
    const currentDateStr = getCurrentDateString();
    const el = document.querySelector(`[data-date="${currentDateStr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } else if (scrollContainerRef) {
      const maxScroll = scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight;
      scrollContainerRef.scrollTo({ top: maxScroll / 2, behavior: "smooth" });
    }
  };

  const todayAction = (
    <button
      type="button"
      onClick={scrollToToday}
      className="rounded-[8px] border border-white/[0.08] bg-sdash-surface-1 px-2 py-0.5 text-md font-sora font-medium text-sdash-text-secondary pt-1 "
      style={{ minHeight: 0, height: "30px", lineHeight: 1.1 }}
    >
      <span className="text-sdash-accent">Today</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
        <TopAppBar title="Calendar" showBack />
        <main className="flex flex-col flex-1 justify-center gap-6 px-4 py-8">
          <div className="text-sdash-text-primary text-base font-sora text-center">Loading calendar data...</div>
          <div className="max-w-2xl mx-auto w-full">
            <div className="text-sdash-text-primary text-base font-sora font-bold mb-4 text-center">
              Meanwhile, here are some interesting facts:
            </div>
            <div className="text-sdash-text-secondary text-sm font-sora text-center italic">
              {currentFact}
            </div>
          </div>
        </main>
        <PillNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-hidden">
      <TopAppBar
        title="Calendar"
        showBack
        onRefresh={() => void fetchUnifiedData()}
        isRefreshing={loading}
        rightAction={todayAction}
      />

      <main className="flex flex-col gap-5 px-4 pt-3 flex-1 min-h-0 w-full max-w-lg mx-auto pb-3">
        <div className="flex rounded-[12px] border border-white/[0.08] bg-sdash-surface-1 p-1">
          <button
            type="button"
            onClick={() => setCalendarUiMode("list")}
            className={`flex-1 rounded-[8px] py-2 text-lg font-sora font-medium touch-target ${
              calendarUiMode === "list"
                ? "bg-sdash-accent text-sdash-text-primary"
                : "text-sdash-text-secondary"
            }`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setCalendarUiMode("month")}
            className={`flex-1 rounded-[8px] py-2 text-lg font-sora font-medium touch-target ${
              calendarUiMode === "month"
                ? "bg-sdash-accent text-sdash-text-primary"
                : "text-sdash-text-secondary"
            }`}
          >
            Month
          </button>
        </div>

        {calendarUiMode === "list" ? (
          <div
            ref={setScrollContainerRef}
            className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto max-h-[58vh] rounded-[20px] border border-sdash-accent/20 bg-transparent p-3"
          >
            {sortedEvents.length === 0 ? (
              <GlassCard className="p-6 text-center">
                <p className="text-sm text-sdash-text-primary font-sora">No calendar data available</p>
                <p className="text-xs text-sdash-text-muted font-sora mt-2">
                  Use refresh in the header to load from the server.
                </p>
              </GlassCard>
            ) : (
              Array.from(eventsGroupedByMonth.entries())
                .sort(([ka], [kb]) => {
                  const [ya, ma] = ka.split("-").map(Number);
                  const [yb, mb] = kb.split("-").map(Number);
                  return ya === yb ? ma - mb : ya - yb;
                })
                .map(([monthKey, monthEvents]) => {
                  const [yStr, mStr] = monthKey.split("-");
                  const label = new Date(Number(yStr), Number(mStr), 1).toLocaleString(undefined, {
                    month: "long",
                    year: "numeric",
                  });
                  return (
                    <div key={monthKey} className="space-y-2">
                      <p className="section-label px-1">{label}</p>
                      <div className="flex flex-col gap-2">
                        {monthEvents.map((event, index) => {
                          const isHoliday = isHolidayEvent(event);
                          const currentDateStr = getCurrentDateString();
                          const isCurrentDate = event.date === currentDateStr;
                          if (isCurrentDate) {
                            console.log(`[Calendar] Current date row: ${event.date}`);
                          }
                          const doNum = Number(String(event.day_order ?? "").trim());
                          const hasNumericDayOrder =
                            !isHoliday &&
                            !Number.isNaN(doNum) &&
                            doNum >= 1 &&
                            doNum <= 5;
                          const dayOrderCapsuleText = `Day Order ${String(doNum).padStart(2, "0")}`;
                          return (
                            <div key={`${monthKey}-${event.date}-${index}`} data-date={event.date}>
                              <GlassCard
                                className={`!rounded-[10px] p-4 flex flex-col gap-2 border ${
                                  isCurrentDate
                                    ? "!border-2 !border-dashed !border-sdash-accent bg-sdash-accent/5"
                                    : isHoliday
                                      ? "border-sdash-success/30"
                                      : "border-white/[0.06]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-wrap items-baseline gap-x-1 min-w-0 text-xl font-sora font-semibold text-sdash-text-primary leading-tight">
                                    <span>{event.date}</span>
                                    {event.day_name ? (
                                      <span> - {event.day_name}</span>
                                    ) : null}
                                  </div>
                                  {isHoliday ? (
                                    <span className="text-sm font-sora font-semibold shrink-0 text-right leading-tight text-red-500">
                                      Holiday
                                    </span>
                                  ) : hasNumericDayOrder ? (
                                    <span
                                      className="inline-flex shrink-0 items-center justify-center rounded-full border border-sdash-accent/35 bg-sdash-accent/10 px-3 py-1 text-sm font-sora font-semibold text-sdash-accent text-right leading-tight"
                                    >
                                      {dayOrderCapsuleText}
                                    </span>
                                  ) : (
                                    <span className="text-sm font-sora font-semibold shrink-0 text-right leading-tight text-red-500">
                                      HD
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-sdash-text-secondary font-sora leading-snug">
                                  {event.content ? <>✨{event.content}✨</> : "—"}
                                </p>
                              </GlassCard>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        ) : (
          <GlassCard className="p-3 flex flex-col gap-3">
            <CalendarMonthGrid
              sortedEvents={sortedEvents}
              viewMonth={viewMonth}
              onViewMonthChange={(next) => setViewMonth(next)}
              todayDateStr={getCurrentDateString()}
            />
          </GlassCard>
        )}

        {(() => {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const monthTitle = new Date().toLocaleString(undefined, {
            month: "long",
            year: "numeric",
          });
          return (
            <>
              <GlassCard className="p-3">
                <p className="font-sora font-semibold text-md text-sdash-text-primary text-left mb-1">
                  Day order statistics
                </p>
                <p className="text-[11px] text-sdash-text-muted font-sora mb-3">
                  Distinct dates from today through last working day of the semester (inclusive cap{" "}
                  <span className="text-sdash-text-secondary">{statsPeriodEndLabel}</span>).
                </p>
                <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1">
                  {[1, 2, 3, 4, 5].map((doNumber) => {
                    const remaining = remainingDayOrderCountsThroughSemester[doNumber];
                    return (
                      <StatChip key={doNumber}>
                        <span className="stat-number text-[13px] text-sdash-text-primary">
                          {remaining}
                        </span>
                        <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">
                          remaining
                        </span>
                        <span className="text-[13px] text-sdash-text-muted whitespace-nowrap">
                          · DO {doNumber}
                        </span>
                      </StatChip>
                    );
                  })}
                </div>
              </GlassCard>

              <GlassCard className="p-3 flex flex-col gap-3">
                <div>
                  <p className="font-sora font-semibold text-md text-sdash-text-primary text-left">
                    Holidays this month
                  </p>
                  <p className="text-[11px] text-sdash-text-muted font-sora mt-0.5">{monthTitle}</p>
                </div>
                {holidaysThisMonth.length === 0 ? (
                  <p className="text-sm text-sdash-text-secondary font-sora text-center py-4">
                    No holidays this month
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {holidaysThisMonth.map((event, index) => {
                      const evDay = parseDdMmYyyy(event.date);
                      if (evDay) {
                        evDay.setHours(0, 0, 0, 0);
                      }
                      const isPast = evDay
                        ? evDay.getTime() < todayStart.getTime()
                        : false;
                      const titleText =
                        event.content?.trim() && event.content.trim().length > 0
                          ? event.content.trim()
                          : "Holiday";
                      const dayLabel =
                        event.day_name?.trim() ||
                        (evDay
                          ? evDay.toLocaleString(undefined, { weekday: "long" })
                          : "");
                      const topRightDate =
                        evDay && dayLabel
                          ? `${formatOrdinalDayOfMonth(evDay)} · ${dayLabel}`
                          : evDay
                            ? formatOrdinalDayOfMonth(evDay)
                            : "";
                      return (
                        <GlassCard
                          key={`holiday-month-${event.date}-${index}`}
                          className="!rounded-[10px] border border-white/[0.06] p-3 flex flex-col gap-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 flex items-center gap-2">
                              <p className="text-xl font-sora font-semibold text-sdash-text-primary leading-snug pr-1">
                                {titleText}
                              </p>
                              {isPast ? (
                                <Check
                                  className="h-5 w-5 shrink-0 text-sdash-accent"
                                  strokeWidth={2.5}
                                  aria-label="Past holiday"
                                />
                              ) : null}
                            </div>
                            {topRightDate ? (
                              <span className="shrink-0 text-xl font-sora font-semibold text-sdash-text-primary text-right leading-tight whitespace-nowrap">
                                {topRightDate}
                              </span>
                            ) : null}
                          </div>
                        </GlassCard>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            </>
          );
        })()}
      </main>

      <PillNav />

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-sdash-surface-1 border border-white/[0.08] rounded-[20px] p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-sora font-semibold text-sdash-text-primary mb-4">Session expired</h2>
            <p className="text-sdash-text-secondary text-sm mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <Link
              href="/auth"
              onClick={handleReAuthenticate}
              className="block w-full text-center bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
