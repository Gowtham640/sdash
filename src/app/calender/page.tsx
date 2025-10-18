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

  useEffect(() => {
    fetchCalendarData();
  }, []);

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
        <div className="text-white text-lg font-sora opacity-70">
          Showing {sortedEvents.length} calendar events
        </div>
        <div className="relative p-4 z-10 w-[90vw] h-[70vh] backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-4 justify-start items-center overflow-y-auto">
          <div className="relative p-4 z-10 w-[80vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-3 justify-center items-center">
            {sortedEvents.map((event, index) => {
              // Check if it's a holiday based on DO value being "-" or "DO -"
              const isHoliday = event.day_order === "-" || event.day_order === "DO -" || event.content.toLowerCase().includes('holiday');
              const bgColor = isHoliday ? 'bg-green-500/80' : 'bg-white/10';
              const doText = isHoliday ? 'Holiday' : event.day_order;
              
              return (
                <div 
                  key={index}
                  className={`relative p-3 z-10 w-[76vw] h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl text-white text-lg font-sora flex flex-row gap-8 justify-between items-center hover:bg-white/20 transition-colors`}
                >
                  <p className="text-white text-lg font-sora font-bold min-w-[120px]">{event.date}</p>
                  <p className="text-white text-lg font-sora flex-1 text-center">{event.content || 'No event'}</p>
                  <p className="text-white text-lg font-sora font-bold min-w-[80px] text-right">{doText}</p>
                </div>
              );
            })}
          </div> 
        </div>
    </div>
  );
}
