'use client';

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getTimetableSummary, type DayOrderStats, type SlotOccurrence } from '@/lib/timetableUtils';
import { AttendancePredictionModal } from '@/components/AttendancePredictionModal';
import { ODMLModal } from '@/components/ODMLModal';
import { calculatePredictedAttendance, calculateODMLAdjustedAttendance, calculateSubjectHoursInDateRange, type PredictionResult, type LeavePeriod } from '@/lib/attendancePrediction';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import ShinyText from '../../components/ShinyText';

interface AttendanceSubject {
  row_number: number;
  subject_code: string;
  course_title: string;
  category: string;
  faculty_name: string;
  slot: string;
  room: string;
  hours_conducted: string;
  hours_absent: string;
  attendance: string;
  attendance_percentage: string;
}

interface AttendanceData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    institution: string;
    college: string;
    scraped_at: string;
  };
  summary: {
    total_subjects: number;
    theory_subjects: number;
    lab_subjects: number;
    other_subjects: number;
    total_hours_conducted: number;
    total_hours_absent: number;
    overall_attendance_percentage: string;
  };
  subjects: {
    theory: AttendanceSubject[];
    lab: AttendanceSubject[];
    other: AttendanceSubject[];
  };
  all_subjects: AttendanceSubject[];
}

interface AttendanceApiResponse {
  success: boolean;
  data?: AttendanceData;
  error?: string;
  count?: number;
}


// Component for displaying remaining hours (using bulletproof pre-calculated data)
const RemainingHoursDisplay = ({ courseTitle, category, dayOrderStats, slotOccurrences }: { 
  courseTitle: string; 
  category: string;
  dayOrderStats: DayOrderStats | null;
  slotOccurrences: SlotOccurrence[];
}) => {
  // Find the matching subject in slot occurrences with BOTH course title AND category matching
  const slotData = slotOccurrences.find(occurrence => {
    const courseTitleMatch = occurrence.courseTitle.toLowerCase().includes(courseTitle.toLowerCase()) ||
                           courseTitle.toLowerCase().includes(occurrence.courseTitle.toLowerCase());
    
    // Handle different category formats (Practical vs Lab, Theory vs Theoretical, etc.)
    const normalizeCategory = (cat: string) => {
      const normalized = cat.toLowerCase().trim();
      if (normalized.includes('practical') || normalized.includes('lab')) return 'practical';
      if (normalized.includes('theory')) return 'theory';
      return normalized;
    };
    
    const categoryMatch = normalizeCategory(occurrence.category) === normalizeCategory(category);
    
    console.log(`[Matching] Checking: "${occurrence.courseTitle}" (${occurrence.category}) vs "${courseTitle}" (${category})`);
    console.log(`[Matching] Title match: ${courseTitleMatch}, Category match: ${categoryMatch}`);
    
    return courseTitleMatch && categoryMatch;
  });

  if (!slotData || !dayOrderStats) {
    console.log(`[RemainingHoursDisplay] No match found for: ${courseTitle} (${category})`);
    return <span>0 hours</span>;
  }

  console.log(`[RemainingHoursDisplay] Matched: ${courseTitle} (${category}) -> ${slotData.courseTitle} (${slotData.category})`);

  // Calculate remaining hours using bulletproof data from timetable
  let totalRemainingHours = 0;
  Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
    const doNumber = parseInt(dayOrder);
    const remainingDays = dayOrderStats[doNumber] || 0;
    totalRemainingHours += remainingDays * hoursPerDay;
  });

  return <span>{totalRemainingHours} hours</span>;
};

export default function AttendancePage() {
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [subjectRemainingHours, setSubjectRemainingHours] = useState<any[]>([]);
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [calendarData, setCalendarData] = useState<any[]>([]);
  const [predictionResults, setPredictionResults] = useState<PredictionResult[]>([]);
  const [isPredictionMode, setIsPredictionMode] = useState(false);
  const [leavePeriods, setLeavePeriods] = useState<LeavePeriod[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showODMLModal, setShowODMLModal] = useState(false);
  const [odmlPeriods, setOdmlPeriods] = useState<LeavePeriod[]>([]);
  const [isOdmlMode, setIsOdmlMode] = useState(false);

  useEffect(() => {
    fetchAttendanceData();
  }, []);

  const handlePredictionCalculate = async (periods: LeavePeriod[]) => {
    if (!attendanceData) {
      return;
    }

    setIsCalculating(true);
    try {
      const results = calculatePredictedAttendance(
        attendanceData,
        slotOccurrences,
        calendarData,
        periods,
        odmlPeriods
      );
      setPredictionResults(results);
      setIsPredictionMode(true);
      setShowPredictionModal(false);
    } catch (err) {
      console.error('Prediction calculation error:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleODMLCalculate = async (periods: LeavePeriod[]) => {
    if (!attendanceData) {
      return;
    }

    setIsCalculating(true);
    try {
      const results = calculateODMLAdjustedAttendance(
        attendanceData,
        slotOccurrences,
        calendarData,
        periods
      );
      setPredictionResults(results);
      setIsOdmlMode(true);
      setIsPredictionMode(false);
      setShowODMLModal(false);
    } catch (err) {
      console.error('OD/ML calculation error:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleCancelPrediction = () => {
    setIsPredictionMode(false);
    setIsOdmlMode(false);
    setPredictionResults([]);
    setLeavePeriods([]);
    setOdmlPeriods([]);
  };

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);
      const email = "gr8790@srmist.edu.in"; // You can make this dynamic
      const password = "h!Grizi34"; // You can make this dynamic
      
      // Fetch attendance data
      const response = await fetch(`/api/data/attendance?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
      const result: AttendanceApiResponse = await response.json();

      console.log('API Response:', result);
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      console.log('Result success:', result.success);
      console.log('Result data exists:', !!result.data);
      console.log('Result data type:', typeof result.data);

      if (result.success && result.data) {
        console.log('Data structure:', result.data);
        console.log('All subjects length:', result.data.all_subjects?.length);
        setAttendanceData(result.data);
      } else {
        console.error('API Error:', result.error);
        console.error('Full result:', result);
        setError(result.error || 'Failed to fetch attendance data');
      }

      // Also fetch comprehensive timetable data (only if attendance data is successful)
      if (result.success) {
        try {
          // Get comprehensive timetable data using the bulletproof utility function
          const timetableSummary = await getTimetableSummary(email, password);
          
          // Set all the data from the summary
          setDayOrderStats(timetableSummary.dayOrderStats);
          setSlotOccurrences(timetableSummary.slotOccurrences);
          setSubjectRemainingHours(timetableSummary.subjectRemainingHours);
          setCalendarData(timetableSummary.calendarData);
          
          console.log('Timetable summary loaded:', {
            dayOrderStats: timetableSummary.dayOrderStats,
            slotOccurrences: timetableSummary.slotOccurrences.length,
            subjectRemainingHours: timetableSummary.subjectRemainingHours.length
          });

          // Debug: Log slot occurrences to see the data structure
          console.log('Slot occurrences:', timetableSummary.slotOccurrences.map(s => ({
            courseTitle: s.courseTitle,
            category: s.category,
            slots: s.slot
          })));
        } catch (fetchErr) {
          console.error('Error fetching timetable summary:', fetchErr);
          // Don't fail the entire operation if additional fetches fail
        }
      }
    } catch (err) {
      setError(`Failed to fetch attendance data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error fetching attendance data:', err);
    } finally {
      setLoading(false);
    }
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  const getAttendancePercentage = (attendanceStr: string): number => {
    const match = attendanceStr.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const createPieChartData = (subject: AttendanceSubject) => {
    const conducted = parseInt(subject.hours_conducted) || 0;
    const absent = parseInt(subject.hours_absent) || 0;
    const present = conducted - absent;

    return [
      { name: 'Present', value: present, color: '#10B981' },
      { name: 'Absent', value: absent, color: '#EF4444' }
    ];
  };

  const calculateRequiredMargin = (subject: AttendanceSubject) => {
    const conducted = parseInt(subject.hours_conducted) || 0;
    const absent = parseInt(subject.hours_absent) || 0;
    const present = conducted - absent;
    const currentAttendance = conducted > 0 ? (present / conducted) * 100 : 0;

    if (currentAttendance >= 75) {
      // Calculate how many hours can be missed while staying above 75%
      let tempConducted = conducted;
      let tempAbsent = absent;
      let margin = 0;

      while (tempConducted > 0 && ((tempConducted - tempAbsent) / tempConducted) * 100 >= 75) {
        tempConducted += 1;
        tempAbsent += 1;
        margin += 1;
      }

      return {
        type: 'margin',
        value: margin - 1, // Subtract 1 because the last iteration would go below 75%
        text:  `${margin - 1}`
      };
    } else {
      // Calculate how many more hours need to be attended to reach 75%
      let tempConducted = conducted;
      let tempPresent = present;
      let required = 0;

      while (tempConducted > 0 && (tempPresent / tempConducted) * 100 < 75) {
        tempConducted += 1;
        tempPresent += 1;
        required += 1;
      }

      return {
        type: 'required',
        value: required,
        text: ` ${required}`
      };
    }
  };


  const toggleExpanded = (subjectCode: string) => {
    const newExpanded = new Set(expandedSubjects);
    if (newExpanded.has(subjectCode)) {
      newExpanded.delete(subjectCode);
    } else {
      newExpanded.add(subjectCode);
    }
    setExpandedSubjects(newExpanded);
  };

  if (loading) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-9">
        <div className="text-white font-sora text-6xl font-bold justify-center items-center">Attendance</div>
        <div className="text-white font-sora text-xl">Loading attendance data...</div>
      </div>
    );
  }

  if (error || !attendanceData) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-9">
        <div className="text-white font-sora text-6xl font-bold justify-center items-center">Attendance</div>
        <div className="text-red-400 font-sora text-xl">Error: {error}</div>
        <button 
          onClick={fetchAttendanceData}
          className="bg-blue-500 hover:bg-blue-600 text-white font-sora px-6 py-3 rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
      <div className="text-white font-sora text-8xl font-bold">Attendance</div>
      
      {/* Prediction Controls */}
      <div className="flex gap-4 items-center">
        {!isPredictionMode && !isOdmlMode ? (
          <div className="flex gap-4 items-center">
            <button
                onClick={() => setShowPredictionModal(true)}
                className="bg-white/10 border border-gray-400 text-white font-sora px-6 py-3 rounded-2xl transition-colors duration-200 flex items-center gap-2"
                >
                <ShinyText 
                    text="Predict Attendance" 
                    disabled={false} 
                    speed={3} 
                    className="text-white"
                />
            </button>
            <button
                onClick={() => setShowODMLModal(true)}
                className="bg-white/10 border border-gray-400 text-white font-sora px-6 py-3 rounded-2xl transition-colors duration-200 flex items-center gap-2"
                >
                <ShinyText 
                    text="Add OD/ML" 
                    disabled={false} 
                    speed={3} 
                    className="text-white"
                />
            </button>
          </div>
        ) : (
          <div className="flex gap-4 items-center">
            <div className="text-white font-sora px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-2xl">
              <ShinyText
                text={isPredictionMode ? 'Prediction Mode Active' : 'OD/ML Mode Active'}
                disabled={false}
                speed={3}
                className="text-white"
              />
            </div>
            <button 
              onClick={handleCancelPrediction}
              className="bg-red-600 hover:bg-red-700 text-white font-sora px-6 py-2 rounded-2xl transition-colors duration-200 flex items-center gap-2"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Individual Subject Cards */}
      <div className="flex flex-col gap-6 w-[80vw] items-center">
        {attendanceData.all_subjects.map((subject, index) => {
          // Get prediction data if in prediction mode or OD/ML mode
          const prediction = (isPredictionMode || isOdmlMode) ? predictionResults.find(p => 
            p.subject.subject_code === subject.subject_code && 
            p.subject.category === subject.category
          ) : null;
          
          const pieChartData = createPieChartData(subject);
          const attendancePercentage = prediction ? prediction.predictedAttendance : getAttendancePercentage(subject.attendance);
          const currentAttendance = prediction ? prediction.currentAttendance : getAttendancePercentage(subject.attendance);
          const requiredMargin = calculateRequiredMargin(subject);
          const isExpanded = expandedSubjects.has(subject.subject_code);

          // Debug: Log attendance subject data
          console.log(`[Attendance] Subject: ${subject.course_title} (${subject.category})`);
          
          // Debug: Log prediction matching
          if (prediction) {
            console.log(`[DEBUG] Found prediction for ${subject.course_title} (${subject.category}):`, {
              predictedAttendance: prediction.predictedAttendance,
              totalHoursTillEndDate: prediction.totalHoursTillEndDate,
              absentHoursDuringLeave: prediction.absentHoursDuringLeave
            });
          } else if (isPredictionMode || isOdmlMode) {
            console.warn(`[DEBUG] No prediction found for ${subject.course_title} (${subject.category})`);
          }
          
  return (
            <div key={`${subject.subject_code}-${index}`} className="w-[60vw] bg-white/10 border border-white/20 rounded-3xl text-white text-lg font-sora overflow-hidden flex flex-col">
              {/* Main Card Content */}
              <div className="flex justify-between items-center p-6 gap-6 min-h-[300px]">
                {/* Left Side - Subject Info */}
                <div className="flex flex-col justify-start items-start gap-4 flex-1">
          <div>
                    <div className="text-2xl font-sora font-bold max-w-[400px] leading-tight">
                      {subject.course_title}
                    </div>
                    <div className="text-gray-400 text-sm font-sora mt-1">
                      {subject.subject_code}
                    </div>
                    <div className="text-gray-500 text-sm font-sora">
                      {subject.faculty_name}
                    </div>
                    <div className="text-gray-600 text-xs font-sora mt-1">
                      {subject.category} • Slot: {subject.slot} • Room: {subject.room}
                    </div>
          </div>
                  <div className="flex flex-col justify-center items-start gap-3">
                    <div className="bg-white/10 border w-[200px] border-white/20 rounded-3xl text-white text-sm font-sora p-2">
              <span className="text-blue-400 text-sm font-sora">Total: </span>
                      {prediction ? 
                        (isOdmlMode ? 
                          `${subject.hours_conducted} hours` : // OD/ML: total stays same
                          `${parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate} hours` // Prediction: add future hours
                        ) :
                        `${subject.hours_conducted} hours`
                      }
                      {prediction && !isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {subject.hours_conducted} + {prediction.totalHoursTillEndDate}
                        </div>
                      )}
                      {prediction && isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {subject.hours_conducted} (unchanged)
                        </div>
                      )}
            </div>
                    <div className="bg-white/10 border w-[200px] border-white/20 rounded-3xl text-white text-sm font-sora p-2">
              <span className="text-red-400 text-sm font-sora">Absent: </span>
                      {prediction ? 
                        (isOdmlMode ? 
                          `${prediction.absentHoursDuringLeave} hours` : // OD/ML: show adjusted absent
                          `${parseInt(subject.hours_absent) + prediction.absentHoursDuringLeave} hours` // Prediction: add future absent
                        ) :
                        `${subject.hours_absent} hours`
                      }
                      {prediction && !isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {subject.hours_absent} + {prediction.absentHoursDuringLeave}
                        </div>
                      )}
                      {prediction && isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {subject.hours_absent} - {prediction.odmlReductionHours}
                        </div>
                      )}
            </div>
                    <div className="bg-white/10 border w-[200px] border-white/20 rounded-3xl text-white text-sm font-sora p-2">
              <span className="text-green-400 text-sm font-sora">Present: </span>
                      {prediction ? 
                        (isOdmlMode ? 
                          `${prediction.presentHoursTillStartDate} hours` : // OD/ML: show adjusted present
                          `${(parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate) - (parseInt(subject.hours_absent) + prediction.absentHoursDuringLeave)} hours` // Prediction: calculate total present
                        ) :
                        `${calculatePresentHours(subject.hours_conducted, subject.hours_absent)} hours`
                      }
                      {prediction && !isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {calculatePresentHours(subject.hours_conducted, subject.hours_absent)} + {prediction.presentHoursTillStartDate}
                        </div>
                      )}
                      {prediction && isOdmlMode && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {calculatePresentHours(subject.hours_conducted, subject.hours_absent)} + {prediction.odmlReductionHours}
                        </div>
                      )}
                    </div>
                    <div className={`bg-white/10 border w-[200px] border-white/20 rounded-3xl text-white text-lg font-sora p-2 ${
                      prediction ? 
                        (prediction.predictedAttendance >= 75 ? 'border-green-400/50 bg-green-500/10' : 'border-red-400/50 bg-red-500/10') :
                        (requiredMargin.type === 'required' ? 'border-red-400/50 bg-red-500/10' : 'border-green-400/50 bg-green-500/10')
                    }`}>
                      <span className={`text-lg font-semibold font-sora ${
                        prediction ?
                          (prediction.predictedAttendance >= 75 ? 'text-green-400' : 'text-red-400') :
                          (requiredMargin.type === 'required' ? 'text-red-400' : 'text-green-400')
                      }`}>
                        {prediction ? 
                          (prediction.predictedAttendance >= 75 ? 'Margin: ' : 'Required: ') :
                          (requiredMargin.type === 'required' ? 'Required: ' : 'Margin: ')
                        }
                      </span>
                      {prediction ? 
                        (prediction.predictedAttendance >= 75 ? 
                          (isOdmlMode ? 
                            `${Math.floor((prediction.predictedAttendance - 75) / 100 * parseInt(subject.hours_conducted))} hours` : // OD/ML: use original total
                            `${Math.floor((prediction.predictedAttendance - 75) / 100 * (parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate))} hours` // Prediction: use future total
                          ) :
                          (isOdmlMode ? 
                            `${Math.ceil((75 - prediction.predictedAttendance) / 100 * parseInt(subject.hours_conducted))} hours` : // OD/ML: use original total
                            `${Math.ceil((75 - prediction.predictedAttendance) / 100 * (parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate))} hours` // Prediction: use future total
                          )
                        ) :
                        requiredMargin.text
                      }
                      {prediction && (
                        <div className="text-xs text-gray-400 mt-1">
                          Current: {requiredMargin.text}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side - Pie Chart */}
                <div className="flex flex-col items-center justify-center w-80 h-80">
                  {pieChartData.length > 0 ? (
                    <div className="relative w-80 h-80">
                      <ResponsiveContainer width={320} height={320}>
                        <PieChart>
                          <Pie
                            data={pieChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={140}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-white font-sora text-3xl font-bold">
                            {attendancePercentage.toFixed(1)}%
                          </div>
                          <div className="text-gray-400 font-sora text-sm">
                            {prediction ? (isOdmlMode ? 'OD/ML Adjusted' : 'Predicted') : 'Attendance'}
                          </div>
                          {prediction && (
                            <div className="text-gray-500 font-sora text-xs mt-1">
                              Current: {currentAttendance.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-400 font-sora">No data available</div>
                  )}
                </div>
              </div>

              {/* Expand Button */}
              <div className="flex justify-center pb-4">
                <button
                  onClick={() => toggleExpanded(subject.subject_code)}
                  className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-4 py-2 text-white font-sora text-sm transition-colors"
                >
                  {isExpanded ? '▼ Less Details' : '▶ More Details'}
                </button>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-6 pb-6 border-t border-white/20 pt-4">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Hours Remaining */}
                    <div className="bg-white/10 border border-white/20 rounded-3xl p-4">
                      <div className="text-white font-sora text-lg font-bold mb-3">Hours Remaining</div>
                      <div className="text-blue-400 font-sora text-2xl font-bold">
                        {prediction && dayOrderStats ? 
                          `${calculateSubjectHoursInDateRange(subject, slotOccurrences, dayOrderStats)} hours` :
                          <RemainingHoursDisplay 
                            courseTitle={subject.course_title} 
                            category={subject.category}
                            dayOrderStats={dayOrderStats}
                            slotOccurrences={slotOccurrences}
                          />
                        }
                      </div>
                      
                    </div>

                    {/* Absent Days */}
                    <div className="bg-white/10 border border-white/20 rounded-3xl p-4">
                      <div className="text-white font-sora text-lg font-bold mb-3">Absent Days</div>
                      <div className="text-gray-400 font-sora text-sm">
                        Absent days list will be displayed here
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Summary Stats */}
        <div className="w-[60vw] flex flex-col items-center bg-white/10 border border-white/20 rounded-3xl p-6">
            <div className="text-white font-sora text-xl mb-4">
              {isPredictionMode ? 'Predicted Summary' : 'Overall Summary'}
            </div>
            <div className="flex gap-4 text-white font-sora items-center justify-center">
            <div className="bg-white/10 border border-white/20 rounded-lg p-3">
                <div className="text-blue-400 text-sm">Total Subjects</div>
                <div className="text-lg font-bold">{attendanceData.summary.total_subjects}</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-3">
                <div className="text-green-400 text-sm">
                  {isPredictionMode ? 'Predicted Attendance' : 'Overall Attendance'}
                </div>
                <div className="text-lg font-bold">
                  {isPredictionMode && predictionResults.length > 0 ? 
                    `${(predictionResults.reduce((sum, p) => sum + p.predictedAttendance, 0) / predictionResults.length).toFixed(1)}%` :
                    attendanceData.summary.overall_attendance_percentage
                  }
                </div>
                {isPredictionMode && predictionResults.length > 0 && (
                  <div className="text-xs text-gray-400 mt-1">
                    Current: {attendanceData.summary.overall_attendance_percentage}
                  </div>
                )}
            </div>
          </div>
        </div>
        </div>
      
      {/* Attendance Prediction Modal */}
      {attendanceData && (
        <AttendancePredictionModal
          attendanceData={attendanceData}
          slotOccurrences={slotOccurrences}
          calendarData={calendarData}
          isOpen={showPredictionModal}
          onClose={() => setShowPredictionModal(false)}
          onCalculate={handlePredictionCalculate}
          leavePeriods={leavePeriods}
          setLeavePeriods={setLeavePeriods}
          isCalculating={isCalculating}
        />
      )}
      
      {/* OD/ML Modal */}
      {attendanceData && (
        <ODMLModal
          attendanceData={attendanceData}
          slotOccurrences={slotOccurrences}
          calendarData={calendarData}
          isOpen={showODMLModal}
          onClose={() => setShowODMLModal(false)}
          onCalculate={handleODMLCalculate}
          odmlPeriods={odmlPeriods}
          setOdmlPeriods={setOdmlPeriods}
          isCalculating={isCalculating}
        />
      )}
    </div>
  );
}
