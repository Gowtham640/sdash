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

  const fetchCalendarData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[FRONTEND] Fetching calendar data...');
      
      const response = await fetch('/api/data/calender?email=gr8790@srmist.edu.in&password=h!Grizi34');
      
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
  
  // Ensure we always have at least 7 events for the UI (pad with empty events if needed)
  while (displayEvents.length < 7) {
    displayEvents.push({
      date: '',
      day_name: '',
      content: '',
      day_order: ''
    });
  }

  // Take only the first 7 events for display
  const eventsToShow = displayEvents.slice(0, 7);

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
          onClick={fetchCalendarData}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-black items-center  min-h-screen flex flex-col overflow-hidden pt-10 gap-16">
        <div className="text-white text-4xl font-sora font-bold"> Academic Calendar 25-26 ODD </div>
        <div className="relative p-4 z-10 w-[90vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="relative p-4 z-10 w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-5 justify-center items-center">
            {eventsToShow.map((event, index) => {
              const isHoliday = event.content.toLowerCase().includes('holiday');
              const bgColor = isHoliday ? 'bg-green-500/80' : 'bg-white/10';
              const doText = isHoliday ? 'Holiday' : event.day_order;
              
              return (
                <div 
                  key={index}
                  className={`relative p-4 z-10 w-[56vw] h-auto backdrop-blur ${bgColor} border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center`}
                >
                  <p className="text-white text-xl font-sora font-bold">{event.date}</p>
                  <p className="text-white text-xl font-sora">{event.content}</p>
                  <p className="text-white text-xl font-sora font-bold">{doText}</p>
                </div>
              );
            })}
          </div> 
        </div>
    </div>
  );
}
