'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getStorageItem } from "@/lib/browserStorage";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { transformMarksIfNeeded } from "@/lib/dataFormatHandler";

interface MarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: Array<{
    assessment_name: string;
    total_marks: string;
    marks_obtained: string;
    percentage: string;
  }>;
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

interface MarksButtonProps {
  expandedButton: 'marks' | 'attendance' | null;
  onExpand: (button: 'marks' | 'attendance' | null) => void;
}

export default function MarksButton({ expandedButton, onExpand }: MarksButtonProps) {
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [marksLoading, setMarksLoading] = useState(false);

  // Fetch marks data when marks button is expanded and no data exists
  useEffect(() => {
    if (expandedButton === 'marks' && !marksData && !marksLoading) {
      console.log('[MarksButton] 📚 Marks button expanded but no marks data - fetching...');
      fetchMarksData();
    }
  }, [expandedButton, marksData, marksLoading]);

  // Fetch marks data specifically (similar to marks page)
  const fetchMarksData = async (forceRefresh = false) => {
    try {
      setMarksLoading(true);
      console.log('[MarksButton] 📚 Fetching marks data...');

      const access_token = getStorageItem('access_token');
      if (!access_token) {
        console.error('[MarksButton] No access token found for marks fetch');
        setMarksLoading(false);
        return;
      }

      // Use request deduplication for marks fetch
      const requestKey = `fetch_marks_${access_token.substring(0, 10)}`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await fetch('/api/data/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh, ['marks']))
        });
        const result = await response.json();
        return { response, result };
      });

      const { response, result } = apiResult;

      // Handle session expiry
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[MarksButton] Session expired during marks fetch');
        setMarksLoading(false);
        return;
      }

      if (!result.success) {
        console.error('[MarksButton] Marks fetch failed:', result.error);
        setMarksLoading(false);
        return;
      }

      // Process marks data (same logic as marks page)
      let marksDataObj: MarksData | null = null;

      if (result.data && typeof result.data === 'object' && 'marks' in result.data) {
        const marksDataRaw = (result.data as { marks?: unknown }).marks;

        if (marksDataRaw && typeof marksDataRaw === 'object') {
          let dataToProcess = transformMarksIfNeeded(marksDataRaw) as typeof marksDataRaw;

          // Check if data is wrapped in an extra 'data' property (legacy format)
          if ('data' in dataToProcess && typeof (dataToProcess as { data: unknown }).data === 'object') {
            console.log('[MarksButton] 🔄 Unwrapping nested marks data structure');
            dataToProcess = (dataToProcess as { data: unknown }).data as typeof marksDataRaw;
          }

          // Check if it's the expected MarksData format
          if ('all_courses' in dataToProcess || 'summary' in dataToProcess) {
            marksDataObj = dataToProcess as MarksData;
            console.log('[MarksButton] ✅ Marks data loaded:', marksDataObj.all_courses?.length || 0, 'courses');
          }
        }
      }

      if (marksDataObj) {
        setMarksData(marksDataObj);
        console.log('[MarksButton] ✅ Marks data set successfully');
      } else {
        console.warn('[MarksButton] ⚠️ No marks data found in response');
      }

    } catch (error) {
      console.error('[MarksButton] Error fetching marks data:', error);
    } finally {
      setMarksLoading(false);
    }
  };

  const getTotalMarksForSubjects = () => {
    if (!marksData?.all_courses) return [];

    return marksData.all_courses.map(course => {
      const totalObtained = course.assessments.reduce((sum, assessment) => {
        const marks = parseFloat(assessment.marks_obtained) || 0;
        return sum + marks;
      }, 0);

      const totalPossible = course.assessments.reduce((sum, assessment) => {
        const marks = parseFloat(assessment.total_marks) || 0;
        return sum + marks;
      }, 0);

      return {
        courseCode: course.course_code,
        subject: course.course_title,
        obtainedMarks: Math.round(totalObtained),
        totalMarks: Math.round(totalPossible)
      };
    });
  };

  return (
    <div
      onClick={(e) => {
        if (expandedButton !== 'marks') {
          e.preventDefault();
          onExpand('marks');
        }
      }}
      className={`relative bg-gradient-to-br from-purple-600/20 to-pink-600/20 backdrop-blur-md border border-white/10 rounded-2xl hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group cursor-pointer ${
        expandedButton === 'marks'
          ? 'col-span-2 row-span-2 h-[29rem] order-1 p-6'
          : expandedButton
            ? 'opacity-0 scale-50 h-0 overflow-hidden'
            : 'h-56 opacity-100 scale-100 order-1 p-8'
      }`}
    >
      {/* Four-way arrow icon */}
      {expandedButton === 'marks' && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand(null);
            }}
            className="absolute top-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <Link
            href="/marks"
            className="absolute bottom-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10 flex items-center gap-1 text-sm font-sora font-medium"
          >
            View Full
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </>
      )}

      {!expandedButton && (
        <div
          className="absolute top-4 right-4 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      )}

      {expandedButton === 'marks' ? (
        <div className="w-full h-full flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-2 border-b border-white/10">
            <div className="text-white font-sora text-sm font-semibold">Marks Summary</div>
          </div>

          <div className="flex-1">
            {marksLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-white font-sora text-lg">Loading marks data...</div>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 p-2">
                {(() => {
                  const subjects = getTotalMarksForSubjects();

                  if (subjects.length === 0) {
                    return (
                      <div className="col-span-3 text-white/70 text-center p-4">
                        <p className="text-sm mb-2">No marks data available</p>
                        <p className="text-xs text-gray-400">
                          Try expanding the marks button again to fetch data
                        </p>
                      </div>
                    );
                  }

                  return subjects.map((subjectData, index) => (
                    <div key={index} className="bg-white/5 rounded-lg p-3 border border-white/10">
                      <div className="flex flex-col gap-1">
                        <div className="text-white font-sora text-sm font-semibold">
                          {subjectData.subject}
                        </div>
                        <div className="text-gray-400 font-sora text-xs">
                          {subjectData.courseCode}
                        </div>
                        <div className="text-green-400 font-sora text-lg font-bold">
                          {subjectData.obtainedMarks}/{subjectData.totalMarks} marks
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
            Marks
          </div>
          <div className="text-white/70 text-sm font-sora text-center">
            View your academic performance
          </div>
        </>
      )}
    </div>
  );
}
