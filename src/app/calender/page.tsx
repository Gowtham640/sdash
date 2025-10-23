'use client';
import React, { useState, useEffect } from "react";
import Image from "next/image";
import LiquidEther from "@/components/LiquidEther";
import { Calendar } from "@/components/ui/calendar"

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
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrollContainerRef, setScrollContainerRef] = useState<HTMLDivElement | null>(null);

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
    fetchCalendarData();
  }, []);

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


  const fetchCalendarData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[FRONTEND] Fetching calendar data...', forceRefresh ? '(force refresh)' : '');
      
      const refreshParam = forceRefresh ? '&refresh=true' : '';
      const response = await fetch(`/api/data/calender?email=gr8790@srmist.edu.in&password=h!Grizi34${refreshParam}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[FRONTEND] API response:', result);
      
      if (result.success && result.data) {
        setCalendarData(result.data);
        console.log('[FRONTEND] Calendar data set:', result.data.length, 'events');
      } else {
        throw new Error(result.error || 'Failed to fetch calendar data');
      }
    } catch (err) {
      console.error('[FRONTEND] Error fetching calendar data:', err);
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
      <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-10 gap-16">
        <div className="text-white text-4xl font-sora font-bold">Academic Calendar 25-26 ODD</div>
        <div className="text-white text-2xl font-sora">Loading calendar data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-10 gap-16">
        <div className="text-white text-4xl font-sora font-bold">Academic Calendar 25-26 ODD</div>
        <div className="text-red-400 text-2xl font-sora">Error: {error}</div>
        <button 
          onClick={() => fetchCalendarData()}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-black items-center min-h-screen flex flex-col overflow-hidden pt-10 gap-8">
        <div className="text-white text-4xl font-sora font-bold"> Academic Calendar 25-26 ODD </div>
        <div className="text-white text-lg font-sora">
          Today's Date: {getCurrentDateString()} 
        </div>
        <div className="relative p-5 z-10 w-[90vw] h-[70vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-4 justify-center items-center overflow-y-auto">
          <div 
            ref={setScrollContainerRef}
            className="relative overflow-y-auto p-4 z-10 w-[80vw] h-[60vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-3 justify-start items-center"
          >
            {sortedEvents.map((event, index) => {
              // Check if it's a holiday based on DO value being "-" or "DO -"
              const isHoliday = event.day_order === "-" || event.day_order === "DO -" || event.content.toLowerCase().includes('holiday');
              
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
              
              const hoverColor = isCurrentDate ? 'bg-gray-200' : (isHoliday ? 'bg-green-500' : 'bg-white/20');
              const doText = isHoliday ? 'Holiday' : event.day_order;
              
              return (
                <div 
                  key={index}
                  data-date={event.date}
                  className={`relative p-3 z-10 w-[76vw] h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-lg font-sora flex flex-row gap-8 justify-between items-center hover:${hoverColor} transition-colors`}
                >
                  <p className={`${textColor} text-lg font-sora font-bold min-w-[120px]`}>
                    {event.date} {isCurrentDate ? '' : ''}
                  </p>
                  <p className={`${textColor} text-lg font-sora flex-1 text-center`}>{event.content || ''}</p>
                  <p className={`${textColor} text-lg font-sora font-bold min-w-[80px] text-right`}>{doText}</p>
                </div>
              );
            })}
            </div>
            </div>
        
        {/* Day Order Statistics */}
        <div className="w-[90vw] bg-white/10 border border-white/20 rounded-3xl p-6 items-center justify-center gap-5">
          <div className="text-white text-2xl font-sora font-bold mb-2 text-center">
            Day Order Statistics
            </div>
          <div className="text-white/70 text-sm font-sora text-center mb-4">
            From {getCurrentDateString()} to 21/11/2025
            </div>
          <div className="grid grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(doNumber => (
              <div key={doNumber} className="bg-white/20 rounded-2xl p-4 text-center">
                <div className="text-white text-lg font-sora font-bold mb-2">
                  DO {doNumber}
            </div>
                <div className="text-green-500 text-3xl font-sora font-bold">
                  {dayOrderStats[doNumber]}
            </div>
                <div className="text-white/70 text-sm font-sora">
                  days left
            </div>
          </div> 
            ))}
          </div>
          <div className="text-gray-300 font-sora font-light text-sm"> Note: This is for all students. For specific course, please refer to the course calendar.</div>
        </div>
    </div>
  );
}
