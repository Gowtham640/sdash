'use client';
import React, { useState, useEffect, useMemo } from "react";
import { getStorageItem } from "@/lib/browserStorage";
import { Checkbox } from "@/components/ui/checkbox";
import { trackPostRequest } from "@/lib/postAnalytics";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';

type PageType = 'analytics' | 'modifications';

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string | null;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: string;
}

// New calendar structure interfaces
interface CalendarDay {
  date: string;
  day: string;
  event: string;
  dayOrder: string;
}

interface CalendarMonth {
  month: string;
  days: CalendarDay[];
}

interface CalendarResponse {
  error: boolean;
  status: number;
  today: CalendarDay;
  tomorrow: CalendarDay;
  index: number;
  calendar: CalendarMonth[];
}

export default function AdminPage() {
  const [activePage, setActivePage] = useState<PageType>('analytics');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Sidebar starts closed, will be toggled by user
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState<{
    summary?: {
      totalUsers: number;
      totalEvents: number;
      pageViews: number;
      cacheHits: number;
      apiRequests: number;
      siteOpens: number;
      errors: number;
      featureClicks: number;
      totalSessions: number;
      sessions: number;
      uniqueSessions: number;
      activeSessions: number;
    totalPostRequests?: number;
    topDataType?: { type: string; count: number };
    };
    charts?: {
      pageVisitsByPage: Array<{ page: string; count: number }>;
      cacheHitsByType: Array<{ type: string; count: number }>;
      apiRequestsByEndpoint: Array<{ endpoint: string; count: number }>;
      browserDistribution: Array<{ browser: string; count: number }>;
      deviceDistribution: Array<{ device: string; count: number }>;
      featureUsage: Array<{ feature: string; count: number }>;
      errorTypes: Array<{ type: string; count: number }>;
      pageVisitsOverTime: Array<{ date: string; count: number }>;
      siteOpensOverTime: Array<{ date: string; count: number }>;
      totalUsersOverTime: Array<{ date: string; count: number }>;
      cacheHitsOverTime: Array<{ date: string; count: number }>;
      apiRequestsOverTime: Array<{ date: string; count: number }>;
      errorsOverTime: Array<{ date: string; count: number }>;
      featureClicksOverTime: Array<{ date: string; count: number }>;
      uniqueSessionsOverTime: Array<{ date: string; count: number }>;
    };
    metrics?: {
      avgCacheResponseTime: number;
      avgApiResponseTime: number;
      avgSessionDuration: number;
      heavyUsers: number;
      casualUsers: number;
      avgDaysPerWeek: number;
      avgSessionsPerUser: number;
      avgSiteOpensPerUser: number;
    };
    responseTimes?: {
      cache: { min: number; max: number; avg: number };
      api: { min: number; max: number; avg: number };
    };
  requestAnalytics?: {
    dataRequestsByType: Array<{ type: string; count: number }>;
    errorsByReason: Array<{ reason: string; count: number }>;
    successFailureOverTime: Array<{ date: string; success: number; failure: number }>;
    loginSummary: { total: number; success: number; failure: number };
    loginOverTime: Array<{ date: string; success: number; failure: number }>;
  };
  } | null>(null);
  const formatDataTypeLabel = (type?: string) =>
    type ? type.replace(/_/g, " ") : "N/A";
  const requestAnalyticsData = analyticsData?.requestAnalytics;
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Modal state for stat card details
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{ title: string; data: Array<{ date: string; count: number }>; color: string } | null>(null);

  // Analytics filters
  const [analyticsSemester, setAnalyticsSemester] = useState<string>('all');
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState<string>('30d'); // Default: past month

  // Helper function to get time range label
  const getTimeRangeLabel = (timeRange: string): string => {
    const labels: Record<string, string> = {
      '1h': 'Past 1 Hour',
      '24h': 'Past 24 Hours',
      '48h': 'Past 48 Hours',
      '7d': 'Past Week',
      '30d': 'Past Month',
      '180d': 'Past 6 Months',
      '365d': 'Past 1 Year',
      'all': 'All Time',
    };
    return labels[timeRange] || 'Selected Period';
  };

  // Helper function to generate mini graph SVG background with smooth curves
  const generateMiniGraph = (data: Array<{ date: string; count: number }>, color: string): string => {
    if (!data || data.length === 0) return '';
    const maxCount = Math.max(...data.map(d => d.count), 1);
    const width = 120;
    const height = 60;
    const padding = 5;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;
    
    // Create smooth curved path using quadratic bezier curves
    if (data.length > 1) {
      const points = data.map((d, i) => {
        const x = padding + (i / Math.max(data.length - 1, 1)) * graphWidth;
        const y = padding + graphHeight - (d.count / maxCount) * graphHeight;
        return { x, y };
      });
      
      // Create a smooth path with bezier curves
      let path = `M ${points[0].x} ${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        const midX = (current.x + next.x) / 2;
        const midY = (current.y + next.y) / 2;
        
        // Use quadratic bezier for smooth curves
        if (i === 0) {
          path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
        } else {
          const prev = points[i - 1];
          const controlX = current.x;
          const controlY = current.y;
          path += ` Q ${controlX} ${controlY} ${midX} ${midY}`;
        }
      }
      // Complete the path to the last point
      const lastPoint = points[points.length - 1];
      path += ` Q ${lastPoint.x} ${lastPoint.y} ${lastPoint.x} ${lastPoint.y}`;
      
      return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="position: absolute; bottom: 0; right: 0; width: 100%; height: 100%; pointer-events: none;"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.25" /></svg>`;
    } else {
      // Single point - show a simple curved line
      const y = padding + graphHeight - (data[0]?.count || 0) / maxCount * graphHeight;
      const midX = width / 2;
      return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="position: absolute; bottom: 0; right: 0; width: 100%; height: 100%; pointer-events: none;"><path d="M ${padding} ${padding + graphHeight} Q ${midX} ${y} ${width - padding} ${y}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity="0.25" /></svg>`;
    }
  };

  // Helper function to open modal with chart data
  const openStatModal = (title: string, chartKey: string, color: string) => {
    if (!analyticsData?.charts) return;
    const data = analyticsData.charts[chartKey as keyof typeof analyticsData.charts] as Array<{ date: string; count: number }> | undefined;
    if (data && data.length > 0) {
      setModalData({ title, data, color });
      setModalOpen(true);
    }
  };

  // Modifications state
  const [selectedCourses, setSelectedCourses] = useState<string[]>(['BTech']);
  const [selectedSemesters, setSelectedSemesters] = useState<number[]>([1]);
  const [fullCalendarData, setFullCalendarData] = useState<any>(null); // Store full JSON structure
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]); // Extracted events for display
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set()); // Selected dates for modification
  const [showModal, setShowModal] = useState(false);
  const [editingDate, setEditingDate] = useState<string>('');
  const [editingDayOrder, setEditingDayOrder] = useState<string>('');
  const [editingContent, setEditingContent] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkAdminAccess();
  }, []);

  useEffect(() => {
    if (activePage === 'analytics' && isAdmin) {
      fetchAnalytics();
    } else if (activePage === 'modifications' && isAdmin && selectedCourses.length > 0 && selectedSemesters.length > 0) {
      // Fetch for first selected course and semester (or handle multiple)
      fetchCalendarForEditing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, isAdmin, selectedCourses, selectedSemesters, analyticsSemester, analyticsTimeRange]);

  // Auto-scroll to current date within calendar container only
  useEffect(() => {
    if (calendarEvents.length > 0 && scrollContainerRef.current) {
      const currentDateStr = getCurrentDateString();
      setTimeout(() => {
        const currentDateElement = scrollContainerRef.current?.querySelector(`[data-date="${currentDateStr}"]`);
        if (currentDateElement && scrollContainerRef.current) {
          // Scroll within the container, not the whole page
          const container = scrollContainerRef.current;
          const element = currentDateElement as HTMLElement;
          
          // Get element position relative to container
          const elementTop = element.offsetTop;
          const elementHeight = element.offsetHeight;
          const containerHeight = container.clientHeight;
          
          // Calculate scroll position to center the element
          const scrollPosition = elementTop - (containerHeight / 2) + (elementHeight / 2);
          
          container.scrollTo({
            top: Math.max(0, scrollPosition),
            behavior: 'smooth'
          });
        }
      }, 500);
    }
  }, [calendarEvents]);

  const checkAdminAccess = async () => {
    try {
      const access_token = getStorageItem('access_token');
      if (!access_token) {
        setError('Please sign in to access admin panel');
        setLoading(false);
        return;
      }

      const response = await trackPostRequest('/api/admin/check', {
        action: 'admin_access_check',
        dataType: 'user',
        primary: false,
        payload: { access_token },
        omitPayloadKeys: ['access_token'],
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to verify admin access');
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      setLoading(false);
    } catch (err) {
      console.error('[Admin] Error checking access:', err);
      setError('Failed to verify admin access');
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      setAnalyticsLoading(true);
      const params = new URLSearchParams();
      params.append('timeRange', analyticsTimeRange);
      if (analyticsSemester !== 'all') {
        params.append('semester', analyticsSemester);
      }
      const response = await fetch(`/api/admin/analytics?${params.toString()}`);
      const result = await response.json();

      if (result.success && result.data) {
        setAnalyticsData(result.data);
      }
    } catch (err) {
      console.error('[Admin] Error fetching analytics:', err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const fetchCalendarForEditing = async () => {
    try {
      // Fetch from public.calendar (API will handle fallback to default/0)
      // Use first selected course and semester for now
      const course = selectedCourses[0] || 'BTech';
      const semester = selectedSemesters[0] || 1;
      console.log(`[Admin] Fetching calendar for course: ${course}, semester: ${semester}`);
      
      const response = await fetch(`/api/admin/calendar?course=${encodeURIComponent(course)}&semester=${semester}`);
      const result = await response.json();

      console.log('[Admin] Calendar API response:', result);

      if (result.success && result.data) {
        console.log('[Admin] Calendar data received:', result.data);
        // Store the full calendar JSON structure
        setFullCalendarData(result.data);

        // Extract events array for display - handle new calendar structure
        let events: CalendarEvent[] = [];

        if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          const calendarData = result.data as CalendarResponse;

          // Check if this is the new calendar structure
          if (calendarData.calendar && Array.isArray(calendarData.calendar)) {
            console.log('[Admin] Detected new calendar structure with months');

            // Transform the new calendar structure into CalendarEvent format
            events = calendarData.calendar.flatMap((monthObj: CalendarMonth) => {
              // Validate month object and month string
              if (!monthObj || !monthObj.month || typeof monthObj.month !== 'string') {
                console.warn('[Admin] Skipping invalid month object:', monthObj);
                return [];
              }

              const monthParts = monthObj.month.split(' ');
              if (monthParts.length < 2) {
                console.warn('[Admin] Month string not in expected format "Month \'YY":', monthObj.month);
                return [];
              }

              const [monthName, year] = monthParts;

              // Validate days array
              if (!monthObj.days || !Array.isArray(monthObj.days)) {
                console.warn('[Admin] Month object missing valid days array:', monthObj);
                return [];
              }

              return monthObj.days.map((day: CalendarDay) => {
                // Validate day object
                if (!day || typeof day !== 'object') {
                  console.warn('[Admin] Skipping invalid day object:', day);
                  return null;
                }

                const event: CalendarEvent = {
                  date: `${day.date || '01'}/${monthObj.month}`, // Format: "19/Jul '25"
                  day_name: day.day || 'Mon', // "Fri"
                  content: day.event || null, // Event description or null
                  day_order: day.dayOrder || '-', // "1", "2", etc. or "-"
                  month: monthObj.month, // "Jul '25"
                  month_name: monthName, // "Jul"
                  year: year, // "'25"
                };

                return event;
              }).filter((event): event is CalendarEvent => event !== null); // Remove null entries
            });

            console.log('[Admin] Transformed new calendar structure, events count:', events.length);
          } else {
            // Fallback to old structure handling
            console.log('[Admin] Calendar data is object, checking for arrays...');
            // Check if it has an events array or data array (using any type for backward compatibility)
            const legacyData = calendarData as any;
            if (Array.isArray(legacyData.events)) {
              events = legacyData.events;
              console.log('[Admin] Calendar has events array, count:', events.length);
            } else if (Array.isArray(legacyData.data)) {
              events = legacyData.data;
              console.log('[Admin] Calendar has data array, count:', events.length);
            } else {
              // If it's an object but no array found, try to extract all date-based properties
              console.warn('[Admin] Calendar data is object but no events array found. Data structure:', Object.keys(legacyData));
              // Try to find any array property
              const keys = Object.keys(legacyData);
              for (const key of keys) {
                if (Array.isArray(legacyData[key])) {
                  events = legacyData[key];
                  console.log(`[Admin] Found array in key "${key}", count:`, events.length);
                  break;
                }
              }
            }
          }
        } else if (Array.isArray(result.data)) {
          // Direct array format (old structure)
          events = result.data;
          console.log('[Admin] Calendar is direct array, events count:', events.length);
        }
        
        // Sort events chronologically by date (handle both DD/MM/YYYY and DD/Month 'YY formats)
        if (events.length > 0) {
          events.sort((a, b) => {
            if (!a.date || !b.date) return 0;

            const parseDate = (dateStr: string) => {
              // Handle new format: "19/Jul '25"
              if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts.length === 2) {
                  const [day, monthYear] = parts;
                  const [month, year] = monthYear.split(' ');
                  const monthNames: { [key: string]: number } = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                  };
                  const monthNum = monthNames[month];
                  const yearNum = year ? 2000 + parseInt(year.replace("'", "")) : new Date().getFullYear();
                  return new Date(yearNum, monthNum, parseInt(day));
                }
              }
              // Fallback to old DD/MM/YYYY format
              const [day, month, year] = dateStr.split('/').map(Number);
              return new Date(year, month - 1, day);
            };

            try {
              return parseDate(a.date).getTime() - parseDate(b.date).getTime();
            } catch (error) {
              console.warn('[Admin] Error parsing date for sorting:', a.date, b.date);
              return 0;
            }
          });
        }
        
        console.log('[Admin] Final events count:', events.length);
        setCalendarEvents(events);
      } else {
        console.warn('[Admin] No calendar data received. Success:', result.success, 'Data:', result.data);
        setFullCalendarData(null);
        setCalendarEvents([]);
      }
    } catch (err) {
      console.error('[Admin] Error fetching calendar:', err);
      setFullCalendarData(null);
      setCalendarEvents([]);
    }
  };

  const getCurrentDateString = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[now.getMonth()];
    const year = `'${now.getFullYear().toString().slice(-2)}`;
    return `${day}/${month} ${year}`;
  };

  const handleToggleDateSelection = (date: string) => {
    const newSelected = new Set(selectedDates);
    if (newSelected.has(date)) {
      newSelected.delete(date);
    } else {
      newSelected.add(date);
    }
    setSelectedDates(newSelected);
  };

  const handleOpenModal = () => {
    if (selectedDates.size === 0) {
      setError('Please select at least one date to modify');
      return;
    }
    // If only one date selected, pre-fill the form
    if (selectedDates.size === 1) {
      const date = Array.from(selectedDates)[0];
      const event = calendarEvents.find(e => e.date === date);
      if (event) {
        setEditingDate(event.date);
        setEditingDayOrder(event.day_order);
        setEditingContent(event.content ?? '');
      }
    } else {
      // Multiple dates selected - clear form
      setEditingDate('');
      setEditingDayOrder('');
      setEditingContent('');
    }
    setShowModal(true);
    setError(null);
  };

  const handleSaveCalendar = async () => {
    if (!editingDayOrder) {
      setError('Please select Day Order/Holiday');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Start with the full calendar JSON structure (or create new one if none exists)
      let updatedFullCalendar: any;
      
      if (fullCalendarData === null || fullCalendarData === undefined) {
        // No existing data - create new structure as array
        updatedFullCalendar = [];
      } else if (Array.isArray(fullCalendarData)) {
        // Existing data is an array - clone it
        updatedFullCalendar = JSON.parse(JSON.stringify(fullCalendarData));
      } else {
        // Existing data is an object - clone it to preserve structure
        updatedFullCalendar = JSON.parse(JSON.stringify(fullCalendarData));
      }

      // Find the events array within the structure
      let eventsArray: CalendarEvent[] = [];
      let eventsPath: string[] = [];
      
      if (Array.isArray(updatedFullCalendar)) {
        // Direct array format
        eventsArray = updatedFullCalendar;
        eventsPath = [];
      } else if (updatedFullCalendar && typeof updatedFullCalendar === 'object') {
        // Find the events array in the object
        if (Array.isArray(updatedFullCalendar.events)) {
          eventsArray = updatedFullCalendar.events;
          eventsPath = ['events'];
        } else if (Array.isArray(updatedFullCalendar.data)) {
          eventsArray = updatedFullCalendar.data;
          eventsPath = ['data'];
        } else if (Array.isArray(updatedFullCalendar.calendar)) {
          eventsArray = updatedFullCalendar.calendar;
          eventsPath = ['calendar'];
        } else {
          // No events array found - create one
          eventsArray = [];
          eventsPath = ['events'];
        }
      }

      // Update all selected dates
      selectedDates.forEach(dateStr => {
        const eventIndex = eventsArray.findIndex(e => e.date === dateStr);
        const updatedEvent: CalendarEvent = {
          date: dateStr,
          day_name: new Date(dateStr.split('/').reverse().join('-')).toLocaleDateString('en-US', { weekday: 'short' }),
          content: editingContent || null, // Allow null/empty content
          day_order: editingDayOrder
        };
        
        if (eventIndex >= 0) {
          // Update existing event
          eventsArray[eventIndex] = updatedEvent;
        } else {
          // Add new event
          eventsArray.push(updatedEvent);
        }
      });

      // Sort events by date (handle both DD/MM/YYYY and DD/Month 'YY formats)
      eventsArray.sort((a, b) => {
        // Handle undefined/null dates
        if (!a?.date) return 1; // Move items without dates to end
        if (!b?.date) return -1; // Move items without dates to end

        const parseDate = (dateStr: string) => {
          try {
            // Handle new format: "19/Jul '25"
            if (dateStr.includes('/')) {
              const parts = dateStr.split('/');
              if (parts.length === 2) {
                const [day, monthYear] = parts;
                const [month, year] = monthYear.split(' ');
                const monthNames: { [key: string]: number } = {
                  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const monthNum = monthNames[month];
                if (monthNum !== undefined) {
                  const yearNum = year ? 2000 + parseInt(year.replace("'", "")) : new Date().getFullYear();
                  return new Date(yearNum, monthNum, parseInt(day));
                }
              }
            }
            // Fallback to old DD/MM/YYYY format or simple parsing
            const dateParts = dateStr.split('/').reverse();
            return new Date(dateParts.join('-'));
          } catch (error) {
            console.warn('[Admin] Error parsing individual date:', dateStr, error);
            return new Date(); // Return current date as fallback
          }
        };

        try {
          const dateA = parseDate(a.date);
          const dateB = parseDate(b.date);
          return dateA.getTime() - dateB.getTime();
        } catch (error) {
          console.warn('[Admin] Error comparing dates for sorting:', a.date, b.date, error);
          return 0;
        }
      });

      // Update the events array in the full structure
      if (eventsPath.length === 0) {
        // Direct array - replace the whole thing
        updatedFullCalendar = eventsArray;
      } else {
        // Object structure - update the nested array
        let current: any = updatedFullCalendar;
        for (let i = 0; i < eventsPath.length - 1; i++) {
          current = current[eventsPath[i]];
        }
        current[eventsPath[eventsPath.length - 1]] = eventsArray;
      }

      // Save the full calendar structure to public.calendar table
      // Save for all selected courses and semesters
      const course = selectedCourses[0] || 'BTech';
      const semester = selectedSemesters[0] || 1;
      const response = await trackPostRequest('/api/admin/calendar', {
        action: 'admin_calendar_save',
        dataType: 'calendar',
        payload: {
          course,
          semester,
          calendarData: updatedFullCalendar
        },
        payloadSummary: { course, semester },
        omitPayloadKeys: ['calendarData'],
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save calendar');
      }

      // Update local state
      setFullCalendarData(updatedFullCalendar);
      setCalendarEvents(eventsArray);
      setSelectedDates(new Set());
      setShowModal(false);
      setEditingDate('');
      setEditingDayOrder('');
      setEditingContent('');
      setSaving(false);
    } catch (err) {
      console.error('[Admin] Error saving calendar:', err);
      setError(err instanceof Error ? err.message : 'Failed to save calendar');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Loading Admin Panel...
        </div>
      </div>
    );
  }

  if (error && !isAdmin) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="text-red-400 text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center px-4">{error}</div>
      </div>
    );
  }

  return (
    <div className="relative bg-black min-h-screen flex overflow-hidden">
      {/* Menu Toggle Button - Visible on all screen sizes */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`fixed top-4 left-4 z-50 p-3 backdrop-blur bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/15 transition-all duration-200 ${
          sidebarOpen ? 'lg:left-[272px]' : 'lg:left-4'
        }`}
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar Overlay - Visible when sidebar is open on mobile */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed lg:fixed w-64 min-w-[256px] h-full backdrop-blur bg-white/10 border-r border-white/20 flex flex-col z-40 transition-transform duration-300 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:-translate-x-full'
      }`}>
        <div className="p-6 border-b border-white/20 flex items-center justify-between">
          <h1 className="text-white text-xl font-sora font-bold">Admin Panel</h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-white/70 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <button
            onClick={() => setActivePage('analytics')}
            className={`relative p-4 rounded-2xl backdrop-blur border border-white/20 text-left transition-all duration-200 ${
              activePage === 'analytics'
                ? 'bg-white/20 text-white shadow-lg shadow-white/10'
                : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white hover:shadow-md hover:shadow-white/5 hover:scale-[1.02]'
            }`}
          >
            <div className="text-base font-sora font-semibold">Analytics</div>
          </button>
          <button
            onClick={() => setActivePage('modifications')}
            className={`relative p-4 rounded-2xl backdrop-blur border border-white/20 text-left transition-all duration-200 ${
              activePage === 'modifications'
                ? 'bg-white/20 text-white shadow-lg shadow-white/10'
                : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white hover:shadow-md hover:shadow-white/5 hover:scale-[1.02]'
            }`}
          >
            <div className="text-base font-sora font-semibold">Modifications</div>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 lg:p-10 pt-16 lg:pt-16">
        {activePage === 'analytics' && (
          <div className="flex flex-col gap-4 sm:gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4">
              <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold">
                Analytics Dashboard
              </div>
              {analyticsLoading && (
                <div className="text-white/70 text-sm font-sora">Loading...</div>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-start sm:items-center">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-1/2 sm:w-auto">
                <label className="text-white/70 text-sm font-sora whitespace-nowrap">Time Range:</label>
                <select
                  value={analyticsTimeRange}
                  onChange={(e) => setAnalyticsTimeRange(e.target.value)}
                  className="w-full sm:w-auto px-3 sm:px-4 py-2 rounded-lg font-sora focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all text-sm sm:text-base"
                  style={{ 
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.6) 0%, rgba(37, 99, 235, 0.7) 100%)',
                    border: '1px solid rgba(96, 165, 250, 0.4)',
                    color: '#ffffff',
                    boxShadow: '0 2px 10px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                  }}
                >
                  <option value="1h" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past 1 Hour</option>
                  <option value="24h" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past 24 Hours</option>
                  <option value="48h" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past 48 Hours</option>
                  <option value="7d" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past Week</option>
                  <option value="30d" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past Month</option>
                  <option value="180d" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past 6 Months</option>
                  <option value="365d" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Past 1 Year</option>
                  <option value="all" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>From the Start</option>
                </select>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-1/2 sm:w-auto">
                <label className="text-white/70 text-sm font-sora whitespace-nowrap">Semester:</label>
                <select
                  value={analyticsSemester}
                  onChange={(e) => setAnalyticsSemester(e.target.value)}
                  className="w-full sm:w-auto px-3 sm:px-4 py-2 rounded-lg font-sora focus:outline-none focus:ring-2 focus:ring-violet-400/50 transition-all text-sm sm:text-base"
                  style={{ 
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.6) 0%, rgba(124, 58, 237, 0.7) 100%)',
                    border: '1px solid rgba(167, 139, 250, 0.4)',
                    color: '#ffffff',
                    boxShadow: '0 2px 10px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                  }}
                >
                  <option value="all" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>All Semesters</option>
                  <option value="1" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 1</option>
                  <option value="2" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 2</option>
                  <option value="3" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 3</option>
                  <option value="4" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 4</option>
                  <option value="5" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 5</option>
                  <option value="6" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 6</option>
                  <option value="7" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 7</option>
                  <option value="8" style={{ background: 'rgba(30, 27, 75, 0.95)', color: '#ffffff' }}>Semester 8</option>
                </select>
              </div>
            </div>

            {analyticsLoading ? (
              <div className="text-white/70 text-center py-12">Loading analytics data...</div>
            ) : analyticsData ? (
              <>
                {/* Summary Stats Cards */}
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-emerald-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.4) 0%, rgba(5, 150, 105, 0.5) 100%)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Total Users', 'totalUsersOverTime', '#10b981')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.totalUsersOverTime || [], '#10b981') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Total Users</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.totalUsers || 0}</div>
                          </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-blue-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4) 0%, rgba(37, 99, 235, 0.5) 100%)', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Page Views', 'pageVisitsOverTime', '#3b82f6')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.pageVisitsOverTime || [], '#3b82f6') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Page Views</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.pageViews || 0}</div>
                          </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-purple-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4) 0%, rgba(147, 51, 234, 0.5) 100%)', boxShadow: '0 4px 15px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Cache Hits', 'cacheHitsOverTime', '#a855f7')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.cacheHitsOverTime || [], '#a855f7') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Cache Hits</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.cacheHits || 0}</div>
                        </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-amber-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.4) 0%, rgba(245, 158, 11, 0.5) 100%)', boxShadow: '0 4px 15px rgba(251, 191, 36, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('API Requests', 'apiRequestsOverTime', '#fbbf24')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.apiRequestsOverTime || [], '#fbbf24') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">API Requests</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.apiRequests || 0}</div>
                      </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-rose-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.4) 0%, rgba(225, 29, 72, 0.5) 100%)', boxShadow: '0 4px 15px rgba(244, 63, 94, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Errors', 'errorsOverTime', '#f43f5e')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.errorsOverTime || [], '#f43f5e') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Errors</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.errors || 0}</div>
                  </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-fuchsia-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(240, 171, 252, 0.4) 0%, rgba(217, 70, 239, 0.5) 100%)', boxShadow: '0 4px 15px rgba(240, 171, 252, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Feature Used', 'featureClicksOverTime', '#e879f9')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.featureClicksOverTime || [], '#e879f9') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Feature Used</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.featureClicks || 0}</div>
                  </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-cyan-400/30 overflow-hidden transition-transform hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.4) 0%, rgba(14, 165, 233, 0.5) 100%)', boxShadow: '0 4px 15px rgba(56, 189, 248, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">POST Requests</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.totalPostRequests || 0}</div>
                    <div className="relative text-white/70 text-xs font-sora">
                      Most requested: {formatDataTypeLabel(analyticsData.summary?.topDataType?.type)}
                      <span className="block text-white/60 text-[0.65rem] mt-1">
                        ({analyticsData.summary?.topDataType?.count || 0})
                      </span>
                    </div>
                  </div>
                  </div>
                  
                  
                  {/* Expandable Additional Stats */}
                  <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 transition-all duration-300 overflow-hidden ${
                    statsExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                  }`}>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-cyan-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.4) 0%, rgba(6, 182, 212, 0.5) 100%)', boxShadow: '0 4px 15px rgba(34, 211, 238, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Site Opens', 'siteOpensOverTime', '#22d3ee')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.siteOpensOverTime || [], '#22d3ee') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Site Opens</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.siteOpens || 0}</div>
                          </div>
                  <div 
                    className="relative p-4 backdrop-blur rounded-2xl border border-indigo-400/30 overflow-hidden cursor-pointer transition-transform hover:scale-105" 
                    style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.4) 0%, rgba(79, 70, 229, 0.5) 100%)', boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}
                    onClick={() => openStatModal('Unique Sessions', 'uniqueSessionsOverTime', '#6366f1')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div 
                      className="absolute bottom-0 right-0 w-20 h-10 sm:w-24 sm:h-16"
                      dangerouslySetInnerHTML={{ __html: generateMiniGraph(analyticsData.charts?.uniqueSessionsOverTime || [], '#6366f1') }}
                    ></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Unique Sessions</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.uniqueSessions || 0}</div>
                          </div>
                  <div className="relative p-4 backdrop-blur rounded-2xl border border-teal-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.4) 0%, rgba(15, 118, 110, 0.5) 100%)', boxShadow: '0 4px 15px rgba(20, 184, 166, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Active Sessions</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.activeSessions || 0}</div>
                        </div>
                  <div className="relative p-4 backdrop-blur rounded-2xl border border-blue-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4) 0%, rgba(37, 99, 235, 0.5) 100%)', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Total Sessions</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.totalSessions || 0}</div>
                  </div>
                  <div className="relative p-4 backdrop-blur rounded-2xl border border-pink-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.4) 0%, rgba(219, 39, 119, 0.5) 100%)', boxShadow: '0 4px 15px rgba(236, 72, 153, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Ended Sessions</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.summary?.sessions || 0}</div>
                      </div>
                  <div className="relative p-4 backdrop-blur rounded-2xl border border-violet-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, rgba(124, 58, 237, 0.5) 100%)', boxShadow: '0 4px 15px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Avg Sessions/User</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgSessionsPerUser?.toFixed(1) || '0.0'}</div>
                  </div>
                  <div className="relative p-4 backdrop-blur rounded-2xl border border-orange-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.4) 0%, rgba(234, 88, 12, 0.5) 100%)', boxShadow: '0 4px 15px rgba(251, 146, 60, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
                    <div className="relative text-white/90 text-xs font-sora mb-1">Avg Opens/User</div>
                    <div className="relative text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgSiteOpensPerUser?.toFixed(1) || '0.0'}</div>
                  </div>
                  </div>
                  
                  {/* Expand/Collapse Button */}
                  <button
                    onClick={() => setStatsExpanded(!statsExpanded)}
                    className="w-full sm:w-auto mx-auto px-6 py-3 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white font-sora font-semibold hover:bg-white/15 hover:border-white/30 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {statsExpanded ? (
                      <>
                        <span>Show Less</span>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </>
                    ) : (
                      <>
                        <span>Show All Stats</span>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>

                {/* Page Visits & Site Opens Over Time */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  {analyticsData.charts?.pageVisitsOverTime && analyticsData.charts.pageVisitsOverTime.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-blue-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.4) 100%)', boxShadow: '0 4px 20px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Page Visits ({getTimeRangeLabel(analyticsTimeRange)})</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={analyticsData.charts.pageVisitsOverTime}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#ffffff80" 
                            tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }}
                            interval={2}
                          />
                          <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'rgba(0, 0, 0, 0.8)', 
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              fontFamily: 'var(--font-circular-std), sans-serif'
                            }}
                            labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }}
                            itemStyle={{ color: '#60a5fa', fontFamily: 'var(--font-circular-std), sans-serif' }}
                          />
                          <Line type="monotone" dataKey="count" stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa', r: 4 }} isAnimationActive={true} animationDuration={500} />
                        </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {analyticsData.charts?.siteOpensOverTime && analyticsData.charts.siteOpensOverTime.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-emerald-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(5, 150, 105, 0.4) 100%)', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Site Opens ({getTimeRangeLabel(analyticsTimeRange)})</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={analyticsData.charts.siteOpensOverTime}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#ffffff80" 
                            tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }}
                            interval={2}
                          />
                          <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'rgba(0, 0, 0, 0.8)', 
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              fontFamily: 'var(--font-circular-std), sans-serif'
                            }}
                            labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }}
                            itemStyle={{ color: '#34d399', fontFamily: 'var(--font-circular-std), sans-serif' }}
                          />
                          <Line type="monotone" dataKey="count" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399', r: 4 }} isAnimationActive={true} animationDuration={500} />
                        </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>

                {requestAnalyticsData && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-blue-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.4) 100%)', boxShadow: '0 4px 20px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Data Requests</div>
                      <div className="relative mb-2 text-white/70 text-sm font-sora">Counts per data type</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={requestAnalyticsData.dataRequestsByType}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                            <XAxis dataKey="type" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} angle={-45} textAnchor="end" height={70} />
                            <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }} labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }} itemStyle={{ color: '#38bdf8', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                            <Bar dataKey="count" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-rose-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.3) 0%, rgba(225, 29, 72, 0.4) 100%)', boxShadow: '0 4px 20px rgba(244, 63, 94, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Error Reasons</div>
                      <div className="relative mb-2 text-white/70 text-sm font-sora">Grouped by backend message</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={requestAnalyticsData.errorsByReason}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                            <XAxis dataKey="reason" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif', fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                            <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }} labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }} itemStyle={{ color: '#fb7185', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                            <Bar dataKey="count" fill="#fb7185" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {requestAnalyticsData && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                    {requestAnalyticsData.successFailureOverTime && requestAnalyticsData.successFailureOverTime.length > 0 && (
                      <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-emerald-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(5, 150, 105, 0.4) 100%)', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                        <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Success vs Failure</div>
                        <div className="w-full" style={{ aspectRatio: '16/9' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={requestAnalyticsData.successFailureOverTime}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                              <XAxis dataKey="date" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif', fontSize: 12 }} />
                              <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                              <Tooltip contentStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px' }} labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }} itemStyle={{ fontFamily: 'var(--font-circular-std), sans-serif' }} />
                              <Legend wrapperStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif', marginTop: 8 }} />
                              <Line type="monotone" dataKey="success" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399', r: 4 }} isAnimationActive />
                              <Line type="monotone" dataKey="failure" stroke="#fb7185" strokeWidth={2} dot={{ fill: '#fb7185', r: 4 }} isAnimationActive />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {requestAnalyticsData.loginOverTime && requestAnalyticsData.loginOverTime.length > 0 && (
                      <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-amber-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.3) 0%, rgba(245, 158, 11, 0.4) 100%)', boxShadow: '0 4px 20px rgba(251, 191, 36, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                        <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Login Activity</div>
                        <div className="relative text-white/70 text-sm font-sora mb-2">Success vs failure (per time bucket)</div>
                        <div className="w-full" style={{ aspectRatio: '16/9' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={requestAnalyticsData.loginOverTime}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                              <XAxis dataKey="date" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif', fontSize: 12 }} />
                              <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                              <Tooltip contentStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px' }} labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }} itemStyle={{ fontFamily: 'var(--font-circular-std), sans-serif' }} />
                              <Legend wrapperStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif', marginTop: 8 }} />
                              <Bar dataKey="success" stackId="login" fill="#34d399" radius={[8, 8, 0, 0]} />
                              <Bar dataKey="failure" stackId="login" fill="#fb7185" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  {/* Page Visits by Page */}
                  {analyticsData.charts?.pageVisitsByPage && analyticsData.charts.pageVisitsByPage.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-purple-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3) 0%, rgba(147, 51, 234, 0.4) 100%)', boxShadow: '0 4px 20px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Page Visits by Page</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.charts.pageVisitsByPage.map(item => {
                          let pageName = item.page.startsWith('/') ? item.page.substring(1) : item.page;
                          // Format page names for better readability
                          if (pageName === '' || pageName === '/') {
                            pageName = 'Home';
                          } else if (pageName === 'auth') {
                            pageName = 'Auth';
                          } else {
                            // Capitalize first letter
                            pageName = pageName.charAt(0).toUpperCase() + pageName.slice(1);
                          }
                          return {
                            ...item,
                            page: pageName
                          };
                        })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis dataKey="page" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontSize: 12, fontFamily: 'var(--font-circular-std), sans-serif' }} angle={-45} textAnchor="end" height={80} />
                          <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <Bar dataKey="count" fill="#60a5fa" radius={[8, 8, 0, 0]} isAnimationActive={true} animationDuration={500} />
                        </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Feature Used by Feature */}
                  {analyticsData.charts?.featureUsage && analyticsData.charts.featureUsage.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-fuchsia-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(240, 171, 252, 0.3) 0%, rgba(217, 70, 239, 0.4) 100%)', boxShadow: '0 4px 20px rgba(240, 171, 252, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Feature Used by Feature</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.charts.featureUsage.map(item => ({
                          ...item,
                          feature: item.feature.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis dataKey="feature" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontSize: 12, fontFamily: 'var(--font-circular-std), sans-serif' }} angle={-45} textAnchor="end" height={80} />
                          <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <Bar dataKey="count" fill="#e879f9" radius={[8, 8, 0, 0]} isAnimationActive={true} animationDuration={500} />
                        </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  {/* Browser Distribution */}
                  {analyticsData.charts?.browserDistribution && analyticsData.charts.browserDistribution.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-cyan-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.3) 0%, rgba(6, 182, 212, 0.4) 100%)', boxShadow: '0 4px 20px rgba(34, 211, 238, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Browser Distribution</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={(() => {
                              const total = analyticsData.charts.browserDistribution.reduce((sum, item) => sum + item.count, 0);
                              return analyticsData.charts.browserDistribution.map(item => ({
                                ...item,
                                percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'
                              }));
                            })()}
                            dataKey="count"
                            nameKey="browser"
                            cx="55%"
                            cy="50%"
                            outerRadius={80}
                            label={(props: any) => {
                              const browser = props.browser || props.payload?.browser || '';
                              const percentage = props.percentage || props.payload?.percentage || '0.0';
                              return (
                                <text
                                  x={props.x}
                                  y={props.y}
                                  fill="#ffffff"
                                  textAnchor={props.textAnchor}
                                  dominantBaseline="central"
                                  style={{ fontFamily: 'var(--font-circular-std), sans-serif', fontSize: '12px' }}
                                >
                                  {`${browser}: ${percentage}%`}
                                </text>
                              );
                            }}
                            labelLine={{ stroke: '#ffffff', strokeWidth: 1 }}
                            isAnimationActive={true}
                            animationDuration={500}
                          >
                            {analyticsData.charts.browserDistribution.map((entry, index) => {
                              const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb7185'];
                              return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                            })}
                          </Pie>
                        </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Device Type Distribution */}
                  {analyticsData.charts?.deviceDistribution && analyticsData.charts.deviceDistribution.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-purple-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3) 0%, rgba(139, 92, 246, 0.4) 100%)', boxShadow: '0 4px 20px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Device Type Distribution</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={(() => {
                              const total = analyticsData.charts.deviceDistribution.reduce((sum, item) => sum + item.count, 0);
                              return analyticsData.charts.deviceDistribution.map(item => ({
                                ...item,
                                percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'
                              }));
                            })()}
                            dataKey="count"
                            nameKey="device"
                            cx="55%"
                            cy="50%"
                            outerRadius={80}
                            label={(props: any) => {
                              const device = props.device || props.payload?.device || '';
                              const percentage = props.percentage || props.payload?.percentage || '0.0';
                              return (
                                <text
                                  x={props.x}
                                  y={props.y}
                                  fill="#ffffff"
                                  textAnchor={props.textAnchor}
                                  dominantBaseline="central"
                                  style={{ fontFamily: 'var(--font-circular-std), sans-serif', fontSize: '12px' }}
                                >
                                  {`${device}: ${percentage}%`}
                                </text>
                              );
                            }}
                            labelLine={{ stroke: '#ffffff', strokeWidth: 1 }}
                            isAnimationActive={true}
                            animationDuration={500}
                          >
                            {analyticsData.charts.deviceDistribution.map((entry, index) => {
                              const colors = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#fb7185', '#22d3ee'];
                              return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                            })}
                          </Pie>
                        </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>

                {/* Charts Row 2.5 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
                  {/* Cache Hits vs API Requests */}
                  <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-amber-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.3) 0%, rgba(245, 158, 11, 0.4) 100%)', boxShadow: '0 4px 20px rgba(251, 191, 36, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                    <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Cache Hits vs API Requests</div>
                    <div className="w-full" style={{ aspectRatio: '16/9' }}>
                      <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Cache Hits', count: analyticsData.summary?.cacheHits || 0 },
                        { name: 'API Requests', count: analyticsData.summary?.apiRequests || 0 },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                        <XAxis dataKey="name" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                        <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                        <Bar dataKey="count" fill="#34d399" radius={[8, 8, 0, 0]} isAnimationActive={true} animationDuration={500} />
                      </BarChart>
                      </ResponsiveContainer>
                    </div>
              </div>
            </div>

                {/* Charts Row 3 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                  {/* Cache Hits by Type */}
                  {analyticsData.charts?.cacheHitsByType && analyticsData.charts.cacheHitsByType.length > 0 && (
                    <div className="relative p-4 sm:p-6 backdrop-blur rounded-3xl border border-indigo-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(79, 70, 229, 0.4) 100%)', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                      <div className="relative text-white text-lg sm:text-xl font-sora font-bold mb-3 sm:mb-4">Cache Hits by Data Type</div>
                      <div className="w-full" style={{ aspectRatio: '16/9' }}>
                        <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.charts.cacheHitsByType}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis dataKey="type" stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <YAxis stroke="#ffffff80" tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }} />
                          <Bar dataKey="count" radius={[8, 8, 0, 0]} isAnimationActive={true} animationDuration={500}>
                            {analyticsData.charts.cacheHitsByType.map((entry, index) => {
                              // Different colors for each data type
                              const typeColors: Record<string, string> = {
                                'attendance': '#60a5fa',
                                'marks': '#34d399',
                                'calendar': '#fbbf24',
                                'timetable': '#f87171',
                              };
                              const color = typeColors[entry.type.toLowerCase()] || '#a78bfa';
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Bar>
                        </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                </div>

                {/* Session Metrics */}
                <div className="relative p-6 backdrop-blur rounded-3xl border border-teal-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.3) 0%, rgba(15, 118, 110, 0.4) 100%)', boxShadow: '0 4px 20px rgba(20, 184, 166, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                  <div className="relative text-white text-xl font-sora font-bold mb-4">Session Metrics</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-white/70 text-sm font-sora mb-1">Avg Session Duration</div>
                      <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgSessionDuration || 0} min</div>
                    </div>
                    <div>
                      <div className="text-white/70 text-sm font-sora mb-1">Avg Sessions per User</div>
                      <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgSessionsPerUser?.toFixed(1) || '0.0'}</div>
                    </div>
                    <div>
                      <div className="text-white/70 text-sm font-sora mb-1">Avg Site Opens per User</div>
                      <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgSiteOpensPerUser?.toFixed(1) || '0.0'}</div>
                    </div>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="relative p-6 backdrop-blur rounded-3xl border border-violet-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(124, 58, 237, 0.4) 100%)', boxShadow: '0 4px 20px rgba(139, 92, 246, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                    <div className="relative text-white text-xl font-sora font-bold mb-4">Response Times</div>
                    <div className="relative flex flex-col gap-3">
                      <div>
                        <div className="text-white/70 text-sm font-sora mb-1">Avg Cache Response</div>
                        <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgCacheResponseTime || 0}ms</div>
                      </div>
                      <div>
                        <div className="text-white/70 text-sm font-sora mb-1">Avg API Response</div>
                        <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgApiResponseTime || 0}ms</div>
                      </div>
                    </div>
                  </div>

                  <div className="relative p-6 backdrop-blur rounded-3xl border border-orange-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3) 0%, rgba(234, 88, 12, 0.4) 100%)', boxShadow: '0 4px 20px rgba(251, 146, 60, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                    <div className="relative text-white text-xl font-sora font-bold mb-4">User Engagement</div>
                    <div className="relative flex flex-col gap-3">
                      <div>
                        <div className="text-white/70 text-sm font-sora mb-1">Avg Days/Week</div>
                        <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.avgDaysPerWeek || 0}</div>
                      </div>
                    </div>
                  </div>

                  <div className="relative p-6 backdrop-blur rounded-3xl border border-sky-400/30 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.3) 0%, rgba(2, 132, 199, 0.4) 100%)', boxShadow: '0 4px 20px rgba(14, 165, 233, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
                    <div className="relative text-white text-xl font-sora font-bold mb-4">User Types</div>
                    <div className="relative flex flex-col gap-3">
                      <div>
                        <div className="text-white/70 text-sm font-sora mb-1">Heavy Users</div>
                        <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.heavyUsers || 0}</div>
                      </div>
                      <div>
                        <div className="text-white/70 text-sm font-sora mb-1">Casual Users</div>
                        <div className="text-white text-2xl font-sora font-bold">{analyticsData.metrics?.casualUsers || 0}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-white/70 text-center py-12">No analytics data available</div>
            )}
          </div>
        )}

        {activePage === 'modifications' && (
          <div className="flex flex-col gap-6">
            <div className="text-white text-2xl sm:text-3xl md:text-4xl font-sora font-bold">
              Calendar Modifications
            </div>

             {/* Course and Semester Selection */}
             <div className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl transition-all duration-200 hover:bg-white/12">
               <div className="text-white text-lg font-sora font-bold mb-4">Select Course & Semester</div>
               <div className="flex flex-col sm:flex-row gap-6">
                 <div className="flex-1">
                   <label className="text-white/70 text-sm font-sora mb-3 block transition-colors duration-200 hover:text-white/90">Course</label>
                   <div className="flex flex-col gap-3 p-4 backdrop-blur bg-white/5 border border-white/10 rounded-2xl transition-all duration-200 hover:bg-white/8 hover:border-white/20">
                     {['BTech', 'MTech'].map((course) => (
                       <label
                         key={course}
                         className="flex items-center gap-3 cursor-pointer group hover:bg-white/8 p-2 rounded-xl transition-all duration-200 hover:scale-[1.02]"
                       >
                         <Checkbox
                           checked={selectedCourses.includes(course)}
                           onCheckedChange={(checked) => {
                             if (checked) {
                               setSelectedCourses([...selectedCourses, course]);
                             } else {
                               setSelectedCourses(selectedCourses.filter(c => c !== course));
                             }
                           }}
                           className="h-5 w-5 rounded-full border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                         />
                         <span className="text-white font-sora text-base group-hover:text-white/90 transition-colors">
                           {course}
                         </span>
                       </label>
                     ))}
                   </div>
                 </div>
                 <div className="flex-1">
                   <label className="text-white/70 text-sm font-sora mb-3 block transition-colors duration-200 hover:text-white/90">Semester</label>
                   <div className="grid grid-cols-4 gap-3 p-4 backdrop-blur bg-white/5 border border-white/10 rounded-2xl transition-all duration-200 hover:bg-white/8 hover:border-white/20">
                     {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                       <label
                         key={sem}
                         className="flex items-center gap-2 cursor-pointer group hover:bg-white/8 p-2 rounded-xl transition-all duration-200 hover:scale-[1.02]"
                       >
                         <Checkbox
                           checked={selectedSemesters.includes(sem)}
                           onCheckedChange={(checked) => {
                             if (checked) {
                               setSelectedSemesters([...selectedSemesters, sem]);
                             } else {
                               setSelectedSemesters(selectedSemesters.filter(s => s !== sem));
                             }
                           }}
                           className="h-5 w-5 rounded-full border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                         />
                         <span className="text-white font-sora text-base group-hover:text-white/90 transition-colors">
                           {sem}
                         </span>
                       </label>
                     ))}
                   </div>
                 </div>
               </div>
               {selectedDates.size > 0 && (
                 <div className="mt-6 flex gap-3 flex-wrap">
                   <button
                     onClick={handleOpenModal}
                     className="relative px-6 py-3 backdrop-blur bg-blue-500/80 border border-blue-400/30 rounded-2xl text-white font-sora font-bold hover:bg-blue-500 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.05] transition-all duration-200 shadow-lg shadow-blue-500/20"
                   >
                     Modify Selected ({selectedDates.size})
                   </button>
                   <button
                     onClick={() => setSelectedDates(new Set())}
                     className="relative px-6 py-3 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white/70 font-sora hover:bg-white/15 hover:text-white hover:border-white/30 hover:shadow-md hover:shadow-white/5 hover:scale-[1.05] transition-all duration-200"
                   >
                     Clear Selection
                   </button>
                 </div>
               )}
             </div>

             {/* Calendar Display - Same style as calendar page */}
             <div className="relative p-3 sm:p-4 md:p-4.5 lg:p-5 z-10 w-full h-[65vh] sm:h-[68vh] md:h-[69vh] lg:h-[70vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center overflow-y-auto">
               <div 
                 ref={scrollContainerRef}
                 className="relative overflow-y-auto p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-[55vh] sm:h-[58vh] md:h-[59vh] lg:h-[60vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-2 sm:gap-2.5 md:gap-3 lg:gap-3 justify-start items-center"
               >
                 {calendarEvents.length === 0 ? (
                   <div className="flex flex-col items-center justify-center gap-4 h-full">
                     <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
                       No calendar data available
                     </div>
                     <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
                       Select course and semester to load calendar
                     </div>
                   </div>
                 ) : (
                   calendarEvents.map((event, index) => {
                     // Check if it's a holiday
                     const isHoliday = event.day_order === "-" || event.day_order === "DO -" || event.day_order === "Holiday" || (event.content && event.content.toLowerCase().includes('holiday'));
                     
                     // Check if it's the current date
                     const currentDateStr = getCurrentDateString();
                     const isCurrentDate = event.date === currentDateStr;
                     
                     // Check if date is selected
                     const isSelected = selectedDates.has(event.date);
                     
                     // Determine background color and text color
                     let bgColor = 'bg-white/10';
                     let textColor = 'text-white';
                     
                     if (isSelected) {
                       bgColor = 'bg-blue-500/80';
                       textColor = 'text-white';
                     } else if (isCurrentDate) {
                       bgColor = 'bg-white';
                       textColor = 'text-black';
                     } else if (isHoliday) {
                       bgColor = 'bg-green-500/80';
                       textColor = 'text-white';
                     }
                     
                     const hoverColor = isSelected ? 'bg-blue-500' : (isCurrentDate ? 'bg-gray-100' : (isHoliday ? 'bg-green-500' : 'bg-white/20'));
                     const doText = isHoliday ? 'Holiday' : event.day_order;
                     
  return (
                       <div 
                         key={index}
                         data-date={event.date}
                         onClick={(e) => {
                           // Don't toggle if clicking on checkbox
                           const target = e.target as HTMLElement;
                           if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type !== 'checkbox') {
                             handleToggleDateSelection(event.date);
                           }
                         }}
                         className={`relative p-2.5 sm:p-2.5 md:p-3 lg:p-3 z-10 w-[85%] sm:w-[80%] md:w-[78%] lg:w-[76%] h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-between items-center hover:${hoverColor} transition-all duration-200 cursor-pointer transform hover:scale-[1.02]`}
                       >
                         <div onClick={(e) => e.stopPropagation()}>
                           <Checkbox
                             checked={isSelected}
                             onCheckedChange={() => {
                               handleToggleDateSelection(event.date);
                             }}
                             className="h-5 w-5 rounded-full border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                           />
                         </div>
                         <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[90px] sm:min-w-[100px] md:min-w-[110px] lg:min-w-[120px]`}>
                           {event.date}
                         </p>
                         <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora flex-1 text-center`}>
                           {event.content ?? ''}
                         </p>
                         <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[75px] lg:min-w-[80px] text-right`}>
                           {doText}
                         </p>
                       </div>
                     );
                   })
                 )}
               </div>
             </div>

             {/* Modal for editing */}
             {showModal && (
               <div 
                 className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
                 onClick={() => {
                   setShowModal(false);
                   setError(null);
                 }}
               >
                 <div 
                   className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl max-w-md w-full animate-in zoom-in-95 duration-200 shadow-2xl"
                   onClick={(e) => e.stopPropagation()}
                 >
                   <div className="text-white text-lg font-sora font-bold mb-4">Edit Calendar Event{selectedDates.size > 1 ? `s (${selectedDates.size})` : ''}</div>
                   <div className="flex flex-col gap-4">
                     {selectedDates.size === 1 && (
                       <div>
                         <label className="text-white/70 text-sm font-sora mb-2 block">Date (DD/MM/YYYY)</label>
                         <input
                           type="text"
                           value={editingDate}
                           onChange={(e) => setEditingDate(e.target.value)}
                           placeholder="09/10/2025"
                           disabled
                           className="w-full p-3 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white/70 font-sora placeholder-white/50 cursor-not-allowed transition-all duration-200"
                         />
                       </div>
                     )}
                     {selectedDates.size > 1 && (
                       <div className="text-white/70 text-sm font-sora p-3 backdrop-blur bg-white/5 border border-white/10 rounded-2xl">
                         Editing {selectedDates.size} dates
                       </div>
                     )}
                     <div>
                       <label className="text-white/70 text-sm font-sora mb-2 block">Day Order / Holiday</label>
                       <select
                         value={editingDayOrder}
                         onChange={(e) => setEditingDayOrder(e.target.value)}
                         className="w-full p-3 backdrop-blur bg-gray-800/90 border border-white/20 rounded-2xl text-white font-sora focus:outline-none focus:ring-2 focus:ring-blue-500/50 hover:bg-gray-800 hover:border-white/30 transition-all duration-200 cursor-pointer"
                       >
                         <option value="" className="bg-gray-800 text-white">Select...</option>
                         <option value="DO 1" className="bg-gray-800 text-white">DO 1</option>
                         <option value="DO 2" className="bg-gray-800 text-white">DO 2</option>
                         <option value="DO 3" className="bg-gray-800 text-white">DO 3</option>
                         <option value="DO 4" className="bg-gray-800 text-white">DO 4</option>
                         <option value="DO 5" className="bg-gray-800 text-white">DO 5</option>
                         <option value="-" className="bg-gray-800 text-white">- (Holiday)</option>
                         <option value="DO -" className="bg-gray-800 text-white">DO - (Holiday)</option>
                         <option value="Holiday" className="bg-gray-800 text-white">Holiday</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-white/70 text-sm font-sora mb-2 block">Event / Content (leave empty for null)</label>
                       <input
                         type="text"
                         value={editingContent}
                         onChange={(e) => setEditingContent(e.target.value)}
                         placeholder="Holiday / Event name (or leave empty)"
                         className="w-full p-3 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white font-sora placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 hover:bg-white/15 hover:border-white/30 transition-all duration-200"
                       />
                     </div>
                     <div className="flex gap-3">
                       <button
                         onClick={handleSaveCalendar}
                         disabled={saving}
                         className="flex-1 relative p-4 backdrop-blur bg-blue-500/80 border border-blue-400/30 rounded-2xl text-white font-sora font-bold hover:bg-blue-500 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100 shadow-lg shadow-blue-500/20"
                       >
                         {saving ? 'Saving...' : 'Update Calendar'}
                       </button>
                       <button
                         onClick={() => {
                           setShowModal(false);
                           setError(null);
                         }}
                         className="relative p-4 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white font-sora hover:bg-white/15 hover:border-white/30 hover:shadow-md hover:shadow-white/5 hover:scale-[1.02] transition-all duration-200"
                       >
                         Cancel
                       </button>
                     </div>
                     {error && (
                       <div className="text-red-400 text-sm font-sora p-3 backdrop-blur bg-red-500/10 border border-red-500/20 rounded-2xl">{error}</div>
                     )}
                   </div>
                 </div>
               </div>
             )}
          </div>
        )}
      </div>

      {/* Stat Card Detail Modal */}
      {modalOpen && modalData && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div 
            className="relative w-[90%] max-w-4xl p-6 backdrop-blur rounded-3xl border overflow-hidden"
            style={{ 
              background: `linear-gradient(135deg, ${modalData.color}20 0%, ${modalData.color}30 100%)`,
              borderColor: `${modalData.color}40`,
              boxShadow: `0 8px 32px ${modalData.color}30, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-60"></div>
            <div className="relative">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-white text-2xl font-sora font-bold">{modalData.title} Over Time</h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-white/70 hover:text-white transition-colors text-2xl font-bold"
                >
                  ×
                </button>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={modalData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#ffffff80" 
                    tick={{ fill: '#ffffff80', fontSize: 12, fontFamily: 'var(--font-circular-std), sans-serif' }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    interval={2}
                  />
                  <YAxis 
                    stroke="#ffffff80" 
                    tick={{ fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }}
                    label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#ffffff80', fontFamily: 'var(--font-circular-std), sans-serif' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(0, 0, 0, 0.8)', 
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      fontFamily: 'var(--font-circular-std), sans-serif'
                    }}
                    labelStyle={{ color: '#ffffff', fontFamily: 'var(--font-circular-std), sans-serif' }}
                    itemStyle={{ color: modalData.color, fontFamily: 'var(--font-circular-std), sans-serif' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke={modalData.color} 
                    strokeWidth={3} 
                    dot={{ fill: modalData.color, r: 5 }} 
                    isAnimationActive={true} 
                    animationDuration={500}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
