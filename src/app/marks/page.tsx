'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import ShinyText from '../../components/ShinyText';

interface Assessment {
  assessment_name: string;
  total_marks: string;
  marks_obtained: string;
  percentage: string;
}

interface MarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: Assessment[];
  total_assessments: number;
}

interface MarksData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    institution: string;
    college: string;
    scraped_at: string;
  };
  summary: {
    total_courses: number;
    theory_courses: number;
    lab_courses: number;
    other_courses: number;
    total_assessments: number;
  };
  courses: {
    theory: MarksCourse[];
    lab: MarksCourse[];
    other: MarksCourse[];
  };
  all_courses: MarksCourse[];
}

interface MarksApiResponse {
  success: boolean;
  data?: MarksData;
  error?: string;
  count?: number;
}

export default function MarksPage() {
  const router = useRouter();
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchUnifiedData();
  }, []);

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
    router.push('/auth');
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      if (forceRefresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const access_token = localStorage.getItem('access_token');
      
      if (!access_token) {
        console.error('[Marks] No access token found');
        setError('Please sign in to view marks');
        setLoading(false);
        return;
      }

      // ✅ STEP 1: Check browser cache first (unless force refresh)
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
            console.log('[Marks] ✅ Using browser cache');
            const result = JSON.parse(cachedData);
            
              // Process the cached data
            if (result.success) {
              setCacheInfo({
                cached: true,
                age: Math.floor((Date.now() - parseInt(cachedTimestamp)) / 1000)
              });

              // Process marks data
              if (result.data.marks?.success && result.data.marks.data) {
                setMarksData(result.data.marks.data);
                console.log('[Marks] Loaded marks with', result.data.marks.data.all_courses?.length, 'courses');
              } else {
                throw new Error('Marks data unavailable');
              }
              
              setLoading(false);
              return;
            }
          } else {
            console.log('[Marks] Browser cache expired');
          }
        }
      }

      // ✅ STEP 2: Fetch from API (will use server cache if available)
      console.log('[Marks] Fetching from API...', forceRefresh ? '(force refresh)' : '(checking server cache)');

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          access_token,
          force_refresh: forceRefresh
        })
      });

      const result = await response.json();
      console.log('[Marks] Unified API response:', result);

      // ✅ STEP 3: Store in browser cache for next time
      if (result.success) {
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cachedTimestampKey, Date.now().toString());
        console.log('[Marks] ✅ Stored in browser cache');
      }

      // Handle session expiry
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[Marks] Session expired or invalid');
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

      // Process marks data
      if (result.data.marks?.success && result.data.marks.data) {
        setMarksData(result.data.marks.data);
        console.log('[Marks] Loaded marks with', result.data.marks.data.all_courses?.length, 'courses');
      } else {
        throw new Error('Marks data unavailable');
      }

    } catch (err) {
      console.error('[Marks] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const createLineChartData = (course: MarksCourse) => {
    // Create a copy of the array and reverse it (last to first)
    const reversedAssessments = [...course.assessments].reverse();
    return reversedAssessments.map(assessment => ({
      assessment: assessment.assessment_name,
      percentage: parseFloat(assessment.percentage.replace('%', '')) || 0,
      marksObtained: parseFloat(assessment.marks_obtained) || 0,
      totalMarks: parseFloat(assessment.total_marks) || 0
    }));
  };

  const getCourseTitle = (course: MarksCourse): string => {
    // Use course_title from API if available, otherwise fallback to course_code
    return course.course_title || course.course_code;
  };

  if (loading) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-6 sm:gap-8 md:gap-9 lg:gap-9">
        <div className="text-white font-sora text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold justify-center items-center">Marks</div>
        <div className="text-white font-sora text-base sm:text-lg md:text-xl lg:text-xl">Loading marks data...</div>
      </div>
    );
  }

  if (error || !marksData) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-6 sm:gap-8 md:gap-9 lg:gap-9">
        <div className="text-white font-sora text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold justify-center items-center">Marks</div>
        <div className="text-red-400 font-sora text-base sm:text-lg md:text-xl lg:text-xl text-center px-4">{error}</div>
        <div className="flex gap-3 sm:gap-4">
          <button 
            onClick={() => fetchUnifiedData()}
            className="bg-blue-500 hover:bg-blue-600 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
          >
            Retry
          </button>
          {error && error.includes('session') && (
            <button 
              onClick={handleReAuthenticate}
              className="bg-orange-600 hover:bg-orange-700 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
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
      
      <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Marks</div>
      
      {/* Individual Course Cards */}
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6 lg:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] items-center">
        {marksData.all_courses.map((course, index) => {
          const lineChartData = createLineChartData(course);
          const courseTitle = getCourseTitle(course);
          
          // Skip courses with no assessments
          if (!course.assessments || course.assessments.length === 0) {
            return null;
          }
          
  return (
            <div key={`${course.course_code}-${index}`} className="w-[95vw] sm:w-[90vw] md:w-[75vw] lg:w-[60vw] bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-lg lg:text-lg font-sora overflow-hidden flex flex-col">
              {/* Main Card Content */}
              <div className="flex flex-col justify-start items-start p-4 sm:p-5 md:p-6 lg:p-6 gap-4 sm:gap-4 md:gap-5 lg:gap-6 min-h-[400px]">
                {/* Course Details - UPDATED to show course title from mapping */}
          <div className="flex flex-col justify-start items-start gap-2">
                  <div className="text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold max-w-[400px] leading-tight">
                    {courseTitle}
                  </div>
                  <div className="text-gray-400 text-xs sm:text-sm font-sora mt-1">
                    {course.course_code}
                  </div>
                  <div className="text-gray-500 text-xs sm:text-sm font-sora">
                    {course.subject_type}
                  </div>
                </div>

                {/* Line Chart */}
                <div className="flex flex-col items-center justify-center w-full sm:w-[110%] md:w-full lg:w-full h-[280px] sm:h-[320px] md:h-[300px] lg:h-80">
                  {lineChartData.length > 0 ? (
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineChartData} margin={{ left: 40, right: 40, top: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="6 6" stroke="#374151" />
                          <XAxis 
                            dataKey="assessment" 
                            stroke="#9CA3AF"
                            fontSize={10}
                            angle={0}
                            textAnchor="front"
                            height={50}
                            domain={['dataMin', 'dataMax']}
                            tick={{ fontSize: 10 }}
                            interval={0}
                            padding={{ left: 20, right: 20 }}
                          />
                          <YAxis 
                            stroke="#9CA3AF"
                            fontSize={10}
                            domain={[0, 100]}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <Tooltip 
                            contentStyle={{
                              backgroundColor: '#1F2937',
                              border: '1px solid #374151',
                              borderRadius: '8px',
                              color: '#F9FAFB'
                            }}
                            formatter={(value: number | string, name: string) => [
                              name === 'percentage' ? `${value}%` : value,
                              name === 'percentage' ? 'Percentage' : 'Marks'
                            ]}
                            labelFormatter={(label) => `Assessment: ${label}`}
                          />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="percentage" 
                            stroke="#FFFFFF" 
                            strokeWidth={4}
                            dot={{ 
                              fill: '#FFFFFF', 
                              strokeWidth: 3, 
                              r: 6,
                              filter: 'drop-shadow(0 8px 16px rgba(255, 255, 255, 0.8))'
                            }}
                            activeDot={{ 
                              r: 8, 
                              stroke: '#FFFFFF', 
                              strokeWidth: 3,
                              filter: 'drop-shadow(0 12px 24px rgba(255, 255, 255, 1))'
                            }}
                            style={{
                              filter: 'drop-shadow(0 12px 24px rgba(255, 255, 255, 0.8))'
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-gray-400 font-sora">No assessment data available</div>
                  )}
          </div>

                {/* Assessment Cards */}
                <div className="flex flex-wrap justify-start items-start gap-2">
                  {[...course.assessments]
                    .sort((a, b) => {
                      // Sort assessments by name (latest first)
                      return b.assessment_name.localeCompare(a.assessment_name);
                    })
                    .map((assessment, assessmentIndex) => (
                    <div key={assessmentIndex} className="bg-white/10 w-[100px] sm:w-[110px] md:w-[115px] lg:w-[120px] h-auto p-3 sm:p-3.5 md:p-4 lg:p-4 border gap-2 border-white/20 rounded-2xl text-white text-xs sm:text-sm font-sora flex flex-col justify-start items-center">
                      <div className="text-green-400 text-xs sm:text-sm font-sora font-bold">{assessment.assessment_name}</div>
                      <div className="text-gray-200 text-xs sm:text-sm font-sora font-bold">{assessment.marks_obtained}/{assessment.total_marks}</div>
                      <div className="text-gray-400 text-[10px] sm:text-xs font-sora">{assessment.percentage}</div>
            </div>
                  ))}
            </div>
          </div>
        </div>
          );
        })}
      </div>

      {/* Marks Summary - Latest Courses First */}
      <div className="w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-5 md:p-6 lg:p-6 mb-6 sm:mb-7 md:mb-8 lg:mb-8">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 sm:mb-5 md:mb-6 lg:mb-6 text-center">
          Marks Summary
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-auto-fit gap-3 sm:gap-4">
          {[...marksData.all_courses]
            .filter(course => course.assessments && course.assessments.length > 0)
            .map(course => {
              // Sort assessments within each course by assessment name (latest first)
              const sortedAssessments = [...course.assessments].sort((a, b) => {
                // Extract assessment type and number for comparison
                const getAssessmentOrder = (name: string) => {
                  if (name.includes('FT-')) return 1; // FT assessments first
                  if (name.includes('FP-')) return 2; // FP assessments second  
                  if (name.includes('LLJ-')) return 3; // LLJ assessments third
                  return 4; // Other assessments last
                };
                
                const orderA = getAssessmentOrder(a.assessment_name);
                const orderB = getAssessmentOrder(b.assessment_name);
                
                if (orderA !== orderB) return orderA - orderB;
                
                // If same type, sort by name alphabetically (reverse for latest first)
                return b.assessment_name.localeCompare(a.assessment_name);
              });
              
              return { ...course, assessments: sortedAssessments };
            })
            .sort((a, b) => {
              // Sort courses by their latest assessment
              const latestAssessmentA = a.assessments[0]?.assessment_name || '';
              const latestAssessmentB = b.assessments[0]?.assessment_name || '';
              return latestAssessmentB.localeCompare(latestAssessmentA);
            })
            .map((course, index) => {
              const avgPercentage = course.assessments.length > 0
                ? (course.assessments.reduce((sum, a) => sum + parseFloat(a.percentage.replace('%', '') || '0'), 0) / course.assessments.length)
                : 0;
              
              return (
                <div 
                  key={`summary-${index}`} 
                  className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-3.5 md:p-4 lg:p-4 hover:bg-white/10 transition-colors"
                >
                  <div className="text-white/80 text-[10px] sm:text-xs font-sora font-bold mb-2 truncate" title={getCourseTitle(course)}>
                    {getCourseTitle(course)}
                  </div>
                  <div className="text-gray-400 text-[10px] sm:text-xs font-sora mb-2 sm:mb-3">
                    {course.course_code}
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/60 text-[10px] sm:text-xs">Avg:</span>
                    <span className={`text-base sm:text-lg font-bold ${avgPercentage >= 75 ? 'text-green-400' : avgPercentage >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {avgPercentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 sm:h-2 overflow-hidden">
                    <div 
                      className={`h-full ${avgPercentage >= 75 ? 'bg-green-500' : avgPercentage >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(avgPercentage, 100)}%` }}
                    />
                  </div>
                  <div className="text-white/50 text-[10px] sm:text-xs font-sora mt-2">
                    {course.assessments.length} assessment{course.assessments.length > 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
        </div>
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
