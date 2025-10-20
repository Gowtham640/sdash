'use client';
import React, { useState, useEffect } from "react";

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

  useEffect(() => {
    fetchTimetableData();
  }, []);

  const fetchTimetableData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[FRONTEND] Fetching timetable data...', forceRefresh ? '(force refresh)' : '');
      
      const refreshParam = forceRefresh ? '&refresh=true' : '';
      const response = await fetch(`/api/data/timetable?email=gr8790@srmist.edu.in&password=h!Grizi34${refreshParam}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[FRONTEND] API response:', result);
      
      if (result.success && result.data) {
        setRawTimetableData(result.data);
        const convertedData = convertTimetableDataToTimeSlots(result.data);
        setTimetableData(convertedData);
        console.log('[FRONTEND] Timetable data set:', convertedData.length, 'time slots');
      } else {
        throw new Error(result.error || 'Failed to fetch timetable data');
      }
    } catch (err) {
      console.error('[FRONTEND] Error fetching timetable data:', err);
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
    }
  };

  const convertTimetableDataToTimeSlots = (data: TimetableData): TimeSlot[] => {
    const timeSlots: TimeSlot[] = [];
    
    // Get the time slots from the data
    const timeSlotKeys = data.time_slots || [
      "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
      "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
    ];
    
    console.log('[FRONTEND] Converting timetable data:', data);
    
    // Create time slot entries
    timeSlotKeys.forEach(timeSlot => {
      const timeSlotEntry: TimeSlot = {
        time: timeSlot,
        do1: "",
        do2: "",
        do3: "",
        do4: "",
        do5: ""
      };
      
      // Map each DO to the time slot
      ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach((doName, index) => {
        const doData = data.timetable[doName];
        if (doData && doData.time_slots && doData.time_slots[timeSlot]) {
          const slotInfo = doData.time_slots[timeSlot];
          const courseTitle = slotInfo.course_title || slotInfo.slot_code || "";
          
          // Map to the correct DO property
          const doKey = `do${index + 1}` as keyof TimeSlot;
          // Show "Free" if no course title, otherwise show course title
          timeSlotEntry[doKey] = courseTitle ? courseTitle : "Free";
          
          console.log(`[FRONTEND] Mapped ${timeSlot} for ${doName}: ${courseTitle || ' '}`);
        }
      });
      
      timeSlots.push(timeSlotEntry);
    });
    
    console.log('[FRONTEND] Final timeSlots:', timeSlots);
    return timeSlots;
  };

  const days = ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'];
  const dayKeys = ['do1', 'do2', 'do3', 'do4', 'do5'] as const;

  if (loading) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-white text-2xl font-sora">Loading timetable data...</div>
        </div>
      </div>
    );
  }

  if (error) {
  return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-red-400 text-2xl font-sora">Error: {error}</div>
          <button 
            onClick={() => fetchTimetableData()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
    </div>
  );
}

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden pt-10">
      <div className="text-white text-6xl font-sora font-bold mb-6">Timetable</div>
      
      
      
      <div className="w-[95vw] h-[80vh] bg-white/10 border border-white/20 rounded-3xl text-white text-lg font-sora overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full h-full border-collapse">
            <thead className="sticky top-0 bg-black/50 backdrop-blur-sm z-10">
              <tr>
                <th className="border border-white/30 bg-white/20 p-3 text-center font-bold min-w-[100px]">
                  Time
                </th>
                {days.map((day) => (
                  <th key={day} className="border border-white/30 bg-white/20 p-3 text-center font-bold min-w-[150px]">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            
            <tbody>
              {timetableData.map((slot, index) => (
                <tr key={slot.time}>
                  <td className="border border-white/30 bg-white/10 p-3 text-center font-bold">
                    {slot.time}
                  </td>
                  
                  {dayKeys.map((dayKey) => (
                    <td key={dayKey} className="border border-white/30 p-3 text-center">
                      {slot[dayKey] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}