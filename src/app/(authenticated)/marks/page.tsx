'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import ShinyText from '@/components/ShinyText';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { transformMarksIfNeeded } from "@/lib/dataFormatHandler";
import { deduplicateRequest } from "@/lib/requestDeduplication";

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
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/marks');
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentFact, setCurrentFact] = useState('');

  useEffect(() => {
    fetchUnifiedData();
    // Set initial fact on client side only to avoid hydration mismatch
    setCurrentFact(getRandomFact());
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
  };

  const refreshMarksData = async () => {
    try {
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Marks] No access token found');
        setError('Please sign in to view marks');
        setLoading(false);
        return;
      }

      console.log('[Marks] 🔄 Force refreshing marks data...');

      // Clear cache and fetch fresh
      removeClientCache('marks');
      await fetchUnifiedData(true);
    } catch (err) {
      console.error('[Marks] Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh marks data');
      setLoading(false);
    }
  };

  // Background fetch function - updates cache without blocking UI
  const fetchFreshDataInBackground = async (access_token: string, forceRefresh: boolean) => {
    try {
      console.log('[Marks] 🔄 Background fetch started...');

      const requestKey = `fetch_unified_all_bg_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await fetch('/api/data/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
        });

        const result = await response.json();
        return { response, result };
      });

      const response = apiResult.response;
      const result = apiResult.result;

      if (response.ok && result.success && result.data?.marks) {
        const marksDataObj = transformMarksIfNeeded(result.data.marks) as MarksData;

        // Update UI with fresh data
        setMarksData(marksDataObj);

        // Update cache
        setClientCache('marks', marksDataObj);

        console.log('[Marks] ✅ Background fetch completed - data updated');
      } else {
        console.log('[Marks] ⚠️ Background fetch completed but no new data');
      }
    } catch (err) {
      console.error('[Marks] ❌ Background fetch error (non-critical):', err);
      // Don't show error to user - we're already showing cached data
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Marks] No access token found');
        setError('Please sign in to view marks');
        setLoading(false);
        return;
      }

      // Check client-side cache FIRST before showing loading state
      let cachedMarks: MarksData | null = null;

      if (!forceRefresh) {
        cachedMarks = getClientCache<MarksData>('marks');

        // Use cached data immediately (stale-while-revalidate)
        if (cachedMarks) {
          console.log('[Marks] ✅ Using client-side cache for marks');
          setMarksData(cachedMarks);
          setLoading(false); // Don't show loading if we have cache
          setError(null);

          // Fetch in background to update cache (non-blocking)
          console.log('[Marks] 🔄 Fetching fresh data in background...');
          fetchFreshDataInBackground(access_token, false);
          return; // Return early - we'll update when background fetch completes
        }
      } else {
        // Force refresh: clear client cache
        removeClientCache('marks');
        console.log('[Marks] 🗑️ Cleared client cache for force refresh');
      }

      // No cache found - show loading and fetch
      setLoading(true);
      setError(null);
      console.log('[Marks] Fetching from API...', forceRefresh ? '(force refresh)' : '(no cache, fetching)');

      // Use request deduplication - ensures only ONE page calls backend at a time
      const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await fetch('/api/data/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
        });

        const result = await response.json();
        return { response, result };
      });

      const response = apiResult.response;
      const result = apiResult.result;
      console.log('[Marks] API response:', result);

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

      // Process marks data from unified endpoint
      // Unified endpoint returns: { success: boolean, data: { marks: MarksData, ... }, error?: string }
      let marksDataObj: MarksData | null = null;

      console.log('[Marks] Processing marks data from API response');
      console.log('[Marks] result.data type:', typeof result.data);
      console.log('[Marks] result.data keys:', result.data ? Object.keys(result.data) : 'null/undefined');

      // Extract marks from unified response: { data: { marks: MarksData, ... } }
      if (result.data && typeof result.data === 'object' && 'marks' in result.data) {
        const marksData = (result.data as { marks?: unknown }).marks;

        if (marksData && typeof marksData === 'object') {
          // Transform if needed (Go format -> Python format)
          let dataToProcess = transformMarksIfNeeded(marksData) as typeof marksData;

          // Check if data is wrapped in an extra 'data' property (legacy format)
          if ('data' in dataToProcess && typeof (dataToProcess as { data: unknown }).data === 'object') {
            console.log('[Marks] 🔄 Unwrapping nested data structure in frontend');
            dataToProcess = (dataToProcess as { data: unknown }).data as typeof marksData;
          }

          // Check if it's the expected MarksData format
          if ('all_courses' in dataToProcess || 'summary' in dataToProcess) {
            marksDataObj = dataToProcess as MarksData;
            console.log('[Marks] ✅ Marks data loaded');
            console.log('[Marks]   - all_courses count:', marksDataObj.all_courses?.length || 0);
            console.log('[Marks]   - summary exists:', !!marksDataObj.summary);
          } else {
            console.warn('[Marks] ⚠️ Marks data doesn\'t match expected format');
            console.warn('[Marks] Available keys:', Object.keys(dataToProcess));
          }
        }
      } else {
        console.warn('[Marks] ⚠️ result.data.marks is not available');
        console.warn('[Marks] result.data structure:', result.data);
      }

      if (marksDataObj && (marksDataObj.all_courses || marksDataObj.summary)) {
        setMarksData(marksDataObj);
        console.log('[Marks] Loaded marks with', marksDataObj.all_courses?.length || 0, 'courses');

        // Save to client cache
        setClientCache('marks', marksDataObj);
      } else {
        // Keep page visible even when marks data is unavailable
        // User can use refresh button to fetch data
        console.warn('[Marks] Marks data unavailable - keeping page visible for refresh');
        if (result && result.data) {
          console.warn('[Marks] Marks data type:', typeof result.data);
          console.warn('[Marks] Marks data value:', result.data);
        }
        setMarksData(null);
        // Don't throw error, just log it so page remains visible
      }

      // Register marks fetch for smart prefetch scheduling
      if (result.success && marksDataObj) {
        registerAttendanceFetch();
      }

    } catch (err) {
      console.error('[Marks] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
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
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="bg-orange-600 hover:bg-orange-700 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </NavigationButton>
          )}
        </div>
      </div>
    );
  }

  // Show empty state if no marks data but no error (allows refresh button to work)
  if (!marksData) {
    return (
      <div className="flex flex-col justify-start items-center py-8 gap-8">

        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Marks</div>
            <button
              onClick={refreshMarksData}
              disabled={loading}
              className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Refresh marks data"
              title="Refresh marks data"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-4 h-full">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
            No marks data available
          </div>
          <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
            Click the refresh button above to fetch marks data
          </div>
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

      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Marks</div>
          <button
            onClick={refreshMarksData}
            disabled={loading}
            className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh marks data"
            title="Refresh marks data"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>

      {/* Individual Course Cards */}
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6 lg:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] items-center">
        {(() => {
          // Safety check: ensure marksData and all_courses exist
          if (!marksData || !marksData.all_courses || !Array.isArray(marksData.all_courses) || marksData.all_courses.length === 0) {
            return (
              <div className="text-white/70 text-center p-8">
                <p>No marks data available. Please refresh to fetch your marks.</p>
              </div>
            );
          }

          // Deduplicate courses based on course_code + subject_type combination
          // If same course_code + subject_type appears multiple times, keep the one with more assessments
          const deduplicatedCourses = marksData.all_courses.reduce((acc, course) => {
            if (!course) return acc; // Skip null/undefined courses

            const existing = acc.find(c =>
              c && c.course_code === course.course_code &&
              c.subject_type === course.subject_type
            );

            // If duplicate found, keep the one with more assessments (or first one if equal)
            if (existing) {
              const existingAssessments = existing.assessments?.length || 0;
              const currentAssessments = course.assessments?.length || 0;

              if (currentAssessments > existingAssessments) {
                // Replace with the one with more assessments
                const index = acc.indexOf(existing);
                if (index !== -1) {
                  acc[index] = course;
                }
              }
              // Otherwise keep existing (don't add duplicate)
            } else {
              // New unique course, add it
              acc.push(course);
            }

            return acc;
          }, [] as MarksCourse[]);

          console.log('[Marks] Deduplication:', {
            original: marksData.all_courses.length,
            deduplicated: deduplicatedCourses.length,
            removed: marksData.all_courses.length - deduplicatedCourses.length
          });

          return deduplicatedCourses.map((course, index) => {
            if (!course) return null; // Skip null courses
            const lineChartData = createLineChartData(course);
            const courseTitle = getCourseTitle(course);

            // Skip courses with no assessments
            if (!course.assessments || course.assessments.length === 0) {
              return null;
            }

            return (
              <div key={`${course.course_code}-${course.subject_type}-${index}`} className="w-[95vw] sm:w-[90vw] md:w-[75vw] lg:w-[60vw] bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-lg lg:text-lg font-sora overflow-hidden flex flex-col">
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
                            textAnchor="start"
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
          });
        })()}
      </div>


      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-white mb-4">Session Expired</h2>
            <p className="text-gray-300 mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
            >
              Sign In
            </NavigationButton>
          </div>
        </div>
      )}
    </div>
  );
}
