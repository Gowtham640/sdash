'use client';

import { useState, useEffect } from 'react';
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
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMarksData();
  }, []);

  const fetchMarksData = async () => {
    try {
      setLoading(true);
      const email = "gr8790@srmist.edu.in"; // You can make this dynamic
      const password = "h!Grizi34"; // You can make this dynamic
      
      // Fetch marks data
      const response = await fetch(`/api/data/marks?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
      const result: MarksApiResponse = await response.json();

      console.log('Marks API Response:', result);
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      console.log('Result success:', result.success);
      console.log('Result data exists:', !!result.data);

      if (result.success && result.data) {
        console.log('Marks data structure:', result.data);
        console.log('All courses length:', result.data.all_courses?.length);
        setMarksData(result.data);
      } else {
        console.error('Marks API Error:', result.error);
        console.error('Full result:', result);
        setError(result.error || 'Failed to fetch marks data');
      }
    } catch (err) {
      setError(`Failed to fetch marks data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error fetching marks data:', err);
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
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-9">
        <div className="text-white font-sora text-6xl font-bold justify-center items-center">Marks</div>
        <div className="text-white font-sora text-xl">Loading marks data...</div>
      </div>
    );
  }

  if (error || !marksData) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-9">
        <div className="text-white font-sora text-6xl font-bold justify-center items-center">Marks</div>
        <div className="text-red-400 font-sora text-xl">Error: {error}</div>
        <button 
          onClick={fetchMarksData}
          className="bg-blue-500 hover:bg-blue-600 text-white font-sora px-6 py-3 rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
      <div className="text-white font-sora text-8xl font-bold">Marks</div>
      
      {/* Individual Course Cards */}
      <div className="flex flex-col gap-6 w-[80vw] items-center">
        {marksData.all_courses.map((course, index) => {
          const lineChartData = createLineChartData(course);
          const courseTitle = getCourseTitle(course);
          
          // Skip courses with no assessments
          if (!course.assessments || course.assessments.length === 0) {
            return null;
          }
          
  return (
            <div key={`${course.course_code}-${index}`} className="w-[60vw] bg-white/10 border border-white/20 rounded-3xl text-white text-lg font-sora overflow-hidden flex flex-col">
              {/* Main Card Content */}
              <div className="flex flex-col justify-start items-start p-6 gap-6 min-h-[400px]">
                {/* Course Details */}
          <div className="flex flex-col justify-start items-start gap-2">
                  <div className="text-2xl font-sora font-bold max-w-[400px] leading-tight">
                    {courseTitle}
                  </div>
                  <div className="text-gray-400 text-sm font-sora mt-1">
                    {course.course_code}
                  </div>
                  <div className="text-gray-500 text-sm font-sora">
                    {course.subject_type}
                  </div>
                </div>

                {/* Line Chart */}
                <div className="flex flex-col items-center justify-center w-full h-80">
                  {lineChartData.length > 0 ? (
                    <div className="relative w-full h-80">
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={lineChartData} margin={{ left: 80, right: 80, top: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="6 6" stroke="#374151" />
                          <XAxis 
                            dataKey="assessment" 
                            stroke="#9CA3AF"
                            fontSize={12}
                            angle={0}
                            textAnchor="front"
                            height={60}
                            domain={['dataMin', 'dataMax']}
                            tick={{ fontSize: 12 }}
                            interval={0}
                            padding={{ left: 80, right: 40 }}
                          />
                          <YAxis 
                            stroke="#9CA3AF"
                            fontSize={12}
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
                            formatter={(value: any, name: string) => [
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
                  {course.assessments.map((assessment, assessmentIndex) => (
                    <div key={assessmentIndex} className="bg-white/10 w-[120px] h-auto p-4 border gap-2 border-white/20 rounded-2xl text-white text-sm font-sora flex flex-col justify-start items-center">
                      <div className="text-green-400 text-sm font-sora font-bold">{assessment.assessment_name}</div>
                      <div className="text-gray-200 text-sm font-sora font-bold">{assessment.marks_obtained}/{assessment.total_marks}</div>
                      <div className="text-gray-400 text-xs font-sora">{assessment.percentage}</div>
            </div>
                  ))}
            </div>
          </div>
        </div>
          );
        })}
      </div>
    </div>
  );
}
