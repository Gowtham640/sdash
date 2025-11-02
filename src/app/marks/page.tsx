'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import ShinyText from '../../components/ShinyText';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";

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
  const [currentFact, setCurrentFact] = useState(getRandomFact());

  useEffect(() => {
    fetchUnifiedData();
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
    router.push('/auth');
  };

  const refreshInBackground = async () => {
    if (isRefreshing) {
      return; // Already refreshing
    }
    
    setIsRefreshing(true);
    console.log('[Marks] Background refresh started');
    
    try {
      const access_token = getStorageItem('access_token');
      if (!access_token) {
        console.error('[Marks] No access token for background refresh');
        return;
      }

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, false))
      });

      const result = await response.json();

      if (result.success) {
        const cacheKey = 'unified_data_cache';
        const cachedTimestampKey = 'unified_data_cache_timestamp';
        
        setStorageItem(cacheKey, JSON.stringify(result));
        setStorageItem(cachedTimestampKey, Date.now().toString());
        console.log('[Marks] ✅ Cache refreshed in background');
      } else {
        console.error('[Marks] ❌ Background refresh failed:', result.error);
      }
    } catch (err) {
      console.error('[Marks] Background refresh error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      if (forceRefresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const access_token = getStorageItem('access_token');
      
      if (!access_token) {
        console.error('[Marks] No access token found');
        setError('Please sign in to view marks');
        setLoading(false);
        return;
      }

      // ✅ STEP 1: Check browser cache first (unless force refresh)
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      const cacheMaxAge = 6 * 60 * 60 * 1000; // 6 hours
      
      /**
       * Calculate dynamic refresh trigger based on backend queue load (Render Python scraper)
       * - Normal load: 5 minutes before expiration
       * - Medium load: 20 minutes before expiration
       * - High load: 40 minutes before expiration
       */
      const getDynamicRefreshTrigger = (queueInfo: { backend_queue?: { total_pending_backend_requests?: number } } | undefined): number => {
        const cacheDuration = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
        
        if (!queueInfo?.backend_queue) {
          // Normal load: 5 minutes before expiration
          const normalTrigger = cacheDuration - (5 * 60 * 1000); // 5 hours 55 minutes
          console.log('[Marks] Using normal refresh trigger: 5 minutes before expiration (no backend queue info)');
          return normalTrigger;
        }
        
        // Use backend queue to determine load (requests waiting in Render Python scraper)
        const backendPending = queueInfo.backend_queue.total_pending_backend_requests || 0;
        
        // Determine load level based on backend queue
        const MEDIUM_LOAD_THRESHOLD = 3; // 3+ requests waiting in backend
        const HIGH_LOAD_THRESHOLD = 5; // 5+ requests waiting in backend
        
        // Calculate refresh trigger based on backend queue load
        let refreshTrigger: number;
        if (backendPending >= HIGH_LOAD_THRESHOLD) {
          // High load: 40 minutes before expiration
          refreshTrigger = cacheDuration - (40 * 60 * 1000); // 5 hours 20 minutes
          console.log(`[Marks] 🔴 HIGH BACKEND LOAD detected: ${backendPending} requests waiting in Render queue`);
          console.log(`[Marks]   - Refresh trigger: 40 minutes before expiration`);
        } else if (backendPending >= MEDIUM_LOAD_THRESHOLD) {
          // Medium load: 20 minutes before expiration
          refreshTrigger = cacheDuration - (20 * 60 * 1000); // 5 hours 40 minutes
          console.log(`[Marks] 🟡 MEDIUM BACKEND LOAD detected: ${backendPending} requests waiting in Render queue`);
          console.log(`[Marks]   - Refresh trigger: 20 minutes before expiration`);
        } else {
          // Normal load: 5 minutes before expiration
          refreshTrigger = cacheDuration - (5 * 60 * 1000); // 5 hours 55 minutes
          console.log(`[Marks] 🟢 Normal backend load: ${backendPending} requests waiting in Render queue`);
          console.log(`[Marks]   - Refresh trigger: 5 minutes before expiration`);
        }
        
        return refreshTrigger;
      };
      
      if (!forceRefresh) {
        const cachedData = getStorageItem(cacheKey);
        const cachedTimestamp = getStorageItem(cachedTimestampKey);
        
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
              
              // Get queue info from cached result
              const queueInfo = result.metadata?.queue_info;
              
              // Calculate dynamic refresh trigger based on queue load
              const refreshTriggerAge = getDynamicRefreshTrigger(queueInfo);
              
              // Background refresh if cache is expiring soon
              const isExpiringSoon = age > refreshTriggerAge;
              if (isExpiringSoon && !isRefreshing) {
                const minutesUntilExpiration = Math.floor((cacheMaxAge - age) / (60 * 1000));
                console.log(`[Marks] ⏰ Cache expiring soon (${minutesUntilExpiration} min remaining), refreshing in background...`);
                refreshInBackground();
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
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
      });

      const result = await response.json();
      console.log('[Marks] Unified API response:', result);

      // ✅ STEP 3: Store in browser cache for next time
      if (result.success) {
        setStorageItem(cacheKey, JSON.stringify(result));
        setStorageItem(cachedTimestampKey, Date.now().toString());
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
      
      <div className="flex flex-col items-center gap-4">
        <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Marks</div>
      </div>
      
      {/* Individual Course Cards */}
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6 lg:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] items-center">
        {(() => {
          // Deduplicate courses based on course_code + subject_type combination
          // If same course_code + subject_type appears multiple times, keep the one with more assessments
          const deduplicatedCourses = marksData.all_courses.reduce((acc, course) => {
            const existing = acc.find(c => 
              c.course_code === course.course_code && 
              c.subject_type === course.subject_type
            );
            
            // If duplicate found, keep the one with more assessments (or first one if equal)
            if (existing) {
              const existingAssessments = existing.assessments?.length || 0;
              const currentAssessments = course.assessments?.length || 0;
              
              if (currentAssessments > existingAssessments) {
                // Replace with the one with more assessments
                const index = acc.indexOf(existing);
                acc[index] = course;
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
