'use client';
import React, { useState, useEffect } from "react";
import { getStorageItem } from "@/lib/browserStorage";
import { Checkbox } from "@/components/ui/checkbox";

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

export default function AdminPage() {
  const [activePage, setActivePage] = useState<PageType>('analytics');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Analytics state
  const [userCount, setUserCount] = useState<number>(0);
  const [requestsPerDay, setRequestsPerDay] = useState<number>(0);
  const [activityData, setActivityData] = useState<any[]>([]);

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
  }, [activePage, isAdmin, selectedCourses, selectedSemesters]);

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

      const response = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token })
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
      const response = await fetch('/api/admin/analytics');
      const result = await response.json();

      if (result.success && result.data) {
        setUserCount(result.data.userCount || 0);
        setRequestsPerDay(result.data.requestsPerDay || 0);
        setActivityData(result.data.activityData || []);
      }
    } catch (err) {
      console.error('[Admin] Error fetching analytics:', err);
    }
  };

  const fetchCalendarForEditing = async () => {
    try {
      // Fetch from user_cache initially (API will handle fallback to public.calendar)
      // Use first selected course and semester for now
      const course = selectedCourses[0] || 'BTech';
      const semester = selectedSemesters[0] || 1;
      const response = await fetch(`/api/admin/calendar?course=${encodeURIComponent(course)}&semester=${semester}`);
      const result = await response.json();

      if (result.success && result.data) {
        // Store the full calendar JSON structure
        setFullCalendarData(result.data);
        
        // Extract events array for display (handle both array and object structures)
        let events: CalendarEvent[] = [];
        if (Array.isArray(result.data)) {
          // Direct array format
          events = result.data;
        } else if (result.data && typeof result.data === 'object') {
          // Check if it has an events array or data array
          if (Array.isArray(result.data.events)) {
            events = result.data.events;
          } else if (Array.isArray(result.data.data)) {
            events = result.data.data;
          } else if (Array.isArray(result.data.calendar)) {
            events = result.data.calendar;
          } else {
            // If it's an object but no array found, try to extract all date-based properties
            console.warn('[Admin] Calendar data is object but no events array found, treating as empty');
            events = [];
          }
        }
        
        // Sort events chronologically by date (DD/MM/YYYY format)
        events.sort((a, b) => {
          if (!a.date || !b.date) return 0;
          const parseDate = (dateStr: string) => {
            const [day, month, year] = dateStr.split('/').map(Number);
            return new Date(year, month - 1, day);
          };
          return parseDate(a.date).getTime() - parseDate(b.date).getTime();
        });
        
        setCalendarEvents(events);
      } else {
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
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
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

      // Sort events by date
      eventsArray.sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA.getTime() - dateB.getTime();
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
      const response = await fetch('/api/admin/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: course,
          semester: semester,
          calendarData: updatedFullCalendar
        })
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
      {/* Sidebar */}
      <div className="relative w-64 min-w-[256px] backdrop-blur bg-white/10 border-r border-white/20 flex flex-col">
        <div className="p-6 border-b border-white/20">
          <h1 className="text-white text-xl font-sora font-bold">Admin Panel</h1>
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
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 md:p-10">
        {activePage === 'analytics' && (
          <div className="flex flex-col gap-6">
            <div className="text-white text-2xl sm:text-3xl md:text-4xl font-sora font-bold">
              Analytics
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl transition-all duration-200 hover:bg-white/15 hover:border-white/30 hover:shadow-lg hover:shadow-white/5 hover:scale-[1.02] cursor-default">
                <div className="text-white/70 text-sm font-sora mb-2 transition-colors duration-200 hover:text-white/90">Total Users</div>
                <div className="text-white text-3xl font-sora font-bold">{userCount}</div>
              </div>
              <div className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl transition-all duration-200 hover:bg-white/15 hover:border-white/30 hover:shadow-lg hover:shadow-white/5 hover:scale-[1.02] cursor-default">
                <div className="text-white/70 text-sm font-sora mb-2 transition-colors duration-200 hover:text-white/90">Requests Today</div>
                <div className="text-white text-3xl font-sora font-bold">{requestsPerDay}</div>
              </div>
              <div className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl transition-all duration-200 hover:bg-white/15 hover:border-white/30 hover:shadow-lg hover:shadow-white/5 hover:scale-[1.02] cursor-default">
                <div className="text-white/70 text-sm font-sora mb-2 transition-colors duration-200 hover:text-white/90">Cache Entries</div>
                <div className="text-white text-3xl font-sora font-bold">{activityData.length}</div>
              </div>
            </div>

            {/* Activity Log */}
            <div className="relative p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl transition-all duration-200 hover:bg-white/12">
              <div className="text-white text-xl font-sora font-bold mb-4">Recent Activity</div>
              <div className="flex flex-col gap-3">
                {activityData.length > 0 ? (
                  activityData.slice(0, 20).map((activity, index) => (
                    <div
                      key={index}
                      className="relative p-3 backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-sm font-sora transition-all duration-200 hover:bg-white/15 hover:border-white/30 hover:shadow-md hover:shadow-white/5 hover:scale-[1.01] cursor-default"
                    >
                      <div className="flex justify-between items-center">
                        <span className="transition-colors duration-200 hover:text-white/90">{activity.data_type}</span>
                        <span className="text-white/70 transition-colors duration-200 hover:text-white/90">
                          {new Date(activity.updated_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-white/70 text-sm font-sora">No recent activity</div>
                )}
              </div>
            </div>
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
    </div>
  );
}
