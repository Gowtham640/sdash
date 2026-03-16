'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import NavigationButton from "@/components/NavigationButton";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { getStorageItem } from "@/lib/browserStorage";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { getClientCache, removeClientCache, setClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { registerAttendanceFetch } from "@/lib/attendancePrefetchScheduler";
import Particles from '@/components/Particles';
import { trackPostRequest } from "@/lib/postAnalytics";

interface Assessment {
  max: number;
  name: string;
  score: number | null;
}

interface MarksEntry {
  total: number | null;
  courseCode: string;
  assessments: Assessment[];
  courseTitle: string;
}

interface MarksPayload {
  url: string;
  entries: MarksEntry[];
  fetched_at: string;
}

const MARKS_CACHE_KEY = 'marks';

const extractMarksPayload = (value: unknown): MarksPayload | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { entries?: unknown; url?: string; fetched_at?: string };
  if (!Array.isArray(candidate.entries)) {
    return null;
  }

  return {
    url: typeof candidate.url === 'string' ? candidate.url : '',
    fetched_at: typeof candidate.fetched_at === 'string' ? candidate.fetched_at : '',
    entries: candidate.entries as MarksEntry[],
  };
};

const getInitialMarksPayload = (): MarksPayload | null => {
  const cached = getClientCache<MarksPayload>(MARKS_CACHE_KEY);
  if (!cached) {
    return null;
  }
  return extractMarksPayload(cached);
};

export default function MarksPage() {
  const initialMarksPayload = useMemo(() => getInitialMarksPayload(), []);
  const [marksPayload, setMarksPayload] = useState<MarksPayload | null>(initialMarksPayload);
  const [loading, setLoading] = useState(!initialMarksPayload);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentFact, setCurrentFact] = useState(getRandomFact());

  const entries = marksPayload?.entries ?? [];
  const formattedFetchTime = useMemo(() => {
    if (!marksPayload?.fetched_at) {
      return 'Timestamp unavailable';
    }
    const parsed = new Date(marksPayload.fetched_at);
    if (Number.isNaN(parsed.getTime())) {
      return 'Timestamp unavailable';
    }
    return parsed.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }, [marksPayload?.fetched_at]);

  const formatAssessmentPercentage = (assessment: Assessment) => {
    const safeMax = assessment.max > 0 ? assessment.max : 1;
    const safeScore = assessment.score ?? 0;
    const percentage = (safeScore / safeMax) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  };

  const formatTotalValue = (value: number) => {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (Math.abs(value - Math.round(value)) < 0.05) {
      return `${Math.round(value)}`;
    }
    return value.toFixed(1);
  };

  const renderAssessmentGraph = (assessments: Assessment[], graphId: string) => {
    if (!assessments.length) {
      return (
        <div className="text-[0.65rem] text-white/60 uppercase tracking-wide text-center">
          Awaiting assessment data to plot the performance.
        </div>
      );
    }

    const baseWidth = Math.max(assessments.length * 55, 220);
    const chartWidth = Math.min(baseWidth, 320);
    const chartHeight = 165;
    const margin = 26;

    const innerWidth = chartWidth - margin * 2;
    const innerHeight = chartHeight - margin * 2;

    const percentages = assessments.map(formatAssessmentPercentage);
    const maxPercent = Math.max(100, ...percentages);

    const computeX = (index: number) => {
      if (assessments.length === 1) {
        return margin + innerWidth / 2;
      }
      return margin + (innerWidth * index) / (assessments.length - 1);
    };

    const points = percentages.map((value, index) => {
      const x = computeX(index);
      const y = chartHeight - margin - (value / maxPercent) * innerHeight;
      return { x, y, value, label: assessments[index].name };
    });

    const baseY = chartHeight - margin;
    const startX = margin;
    const endX = chartWidth - margin;

    const linePath = [`M${startX},${baseY}`, ...points.map((point) => `L${point.x},${point.y}`)].join(' ');
    const areaPath = [
      `M${startX},${baseY}`,
      ...points.map((point) => `L${point.x},${point.y}`),
      `L${endX},${baseY}`,
      'Z',
    ].join(' ');

    const gradientId = `assessment-gradient-${graphId}`;

    return (
      <div className="w-full overflow-hidden rounded-2xl bg-black/30 backdrop-blur-sm border border-white/10">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full" role="img" aria-label="Assessment performance chart">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#61f0a3" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#61f0a3" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1={startX}
            y1={margin}
            x2={startX}
            y2={baseY}
            stroke="#ffffff50"
            strokeWidth={1}
          />
          <line
            x1={startX}
            y1={baseY}
            x2={endX}
            y2={baseY}
            stroke="#ffffff50"
            strokeWidth={1}
          />
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            stroke="#61f0a3"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => (
            <g key={`${graphId}-point-${index}`}>
              <circle cx={point.x} cy={point.y} r={4} fill="#61f0a3" />
              <text
                x={point.x}
                y={point.y - 10}
                fill="#ffffffd1"
                fontSize="10"
                textAnchor="middle"
                fontWeight="600"
              >
                {Math.round(point.value)}%
              </text>
            </g>
          ))}
          {points.map((point, index) => (
          <text
            key={`${graphId}-label-${index}`}
            x={point.x}
            y={baseY + 16}
            fill="#ffffffb0"
            fontSize="9"
            textAnchor="middle"
          >
            {point.label}
          </text>
          ))}
          <text
            x={startX - 8}
            y={baseY}
            fill="#ffffff70"
            fontSize="10"
            textAnchor="end"
          >
            0%
          </text>
          <text
            x={startX - 8}
            y={margin}
            fill="#ffffff70"
            fontSize="10"
            textAnchor="end"
          >
            {Math.round(maxPercent)}%
          </text>
        </svg>
      </div>
    );
  };

  const renderParticleLayer = () => (
    <div className="fixed inset-0 z-1 pointer-events-none">
      <Particles
        particleColors={["#ffffff"]}
        particleCount={100}
        particleSpread={20}
        speed={0.1}
        particleBaseSize={200}
        moveParticlesOnHover
        alphaParticles={false}
        disableRotation={false}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
      />
    </div>
  );

  useErrorTracking(error, '/marks');

  useEffect(() => {
    fetchMarksData();
  }, []);

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

  const refreshMarksData = () => {
    fetchMarksData(true);
  };

  const fetchMarksData = async (forceRefresh = false) => {
    try {
      const shouldShowLoading = forceRefresh || !marksPayload;
      setLoading(shouldShowLoading);
      setError(null);

      const access_token = getStorageItem('access_token');
      if (!access_token) {
        setError('Please sign in to view marks');
        return;
      }

      if (forceRefresh) {
        removeClientCache(MARKS_CACHE_KEY);
      }

      let cachedPayload: MarksPayload | null = null;
      let needsBackgroundRefresh = forceRefresh;

      if (!forceRefresh) {
        cachedPayload = getClientCache<MarksPayload>(MARKS_CACHE_KEY);

        if (!cachedPayload) {
          try {
            const cacheResponse = await trackPostRequest('/api/data/cache', {
              action: 'cache_fetch',
              dataType: 'marks',
              primary: false,
              payload: { access_token, data_type: 'marks' },
              omitPayloadKeys: ['access_token'],
            });
            const cacheResult = await cacheResponse.json();
            if (cacheResult.success && cacheResult.data) {
              const extracted = extractMarksPayload(cacheResult.data);
              if (extracted) {
                cachedPayload = extracted;
                setMarksPayload(extracted);
                if (cacheResult.isExpired) {
                  needsBackgroundRefresh = true;
                }
              }
            }
          } catch (cacheError) {
            console.error('[Marks] ❌ Error fetching cache:', cacheError);
          }
        } else {
          setMarksPayload(cachedPayload);
        }
      }

      if (!cachedPayload || forceRefresh || needsBackgroundRefresh) {
        const requestKey = `fetch_marks_${access_token.substring(0, 10)}`;
        const apiResult = await deduplicateRequest(requestKey, async () => {
          const response = await trackPostRequest('/api/data/all', {
            action: 'data_unified_fetch',
            dataType: 'marks',
            payload: getRequestBodyWithPassword(access_token, forceRefresh),
            omitPayloadKeys: ['password', 'access_token'],
          });
          const result = await response.json();
          return { response, result };
        });

        const { response, result } = apiResult;
        if (!response.ok || result.error === 'session_expired') {
          setError('Your session has expired. Please re-enter your password.');
          setShowPasswordModal(true);
          return;
        }

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch marks data');
        }

        const payloadCandidate = extractMarksPayload(result.data?.marks ?? result.data);
        if (!payloadCandidate) {
          throw new Error('Marks data missing from response');
        }

        setMarksPayload(payloadCandidate);
        setClientCache(MARKS_CACHE_KEY, payloadCandidate);
        registerAttendanceFetch();
      }
    } catch (err) {
      console.error('[Marks] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch marks data');
    } finally {
      setLoading(false);
    }
  };

  const renderLoading = () => (
    <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-6 sm:gap-8 md:gap-9 lg:gap-9">
      <div className="text-white font-sora text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold">Marks</div>
      <div className="text-white font-sora text-base sm:text-lg md:text-xl lg:text-xl">Loading marks data...</div>
      <div className="max-w-2xl px-6 text-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4">
          Meanwhile, here are some interesting facts:
        </div>
        <div className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora italic">
          {currentFact}
        </div>
      </div>
    </div>
  );

  const renderEmpty = () => (
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
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

      <div className="flex flex-col items-center justify-center gap-4 h-full text-center px-4">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora">
          No marks data available
        </div>
        <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora">
          Tap the refresh button above to try again.
        </div>
      </div>
    </div>
  );

  if (loading && !marksPayload) {
    return renderLoading();
  }

  if (!marksPayload) {
    return renderEmpty();
  }

  return (
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
      {renderParticleLayer()}
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



      <div className="grid gap-4 sm:gap-5 md:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw]">
        {entries.length === 0 ? (
          <div className="text-white/70 text-center p-8 border border-white/10 rounded-2xl">
            No records available in the provided data. Tap refresh to try again.
          </div>
        ) : (
          entries.map((entry, index) => {
            const courseTitle = entry.courseTitle?.trim() || entry.courseCode?.trim() || `Course ${index + 1}`;
            const key = `${courseTitle}-${entry.courseCode ?? index}`;
            const normalizedAssessments = Array.isArray(entry.assessments) ? entry.assessments : [];
            const computedAssessmentTotal = normalizedAssessments.reduce(
              (sum, assessment) => sum + (assessment.score ?? 0),
              0
            );
            const totalValue =
              entry.total !== null && entry.total !== undefined ? entry.total : computedAssessmentTotal;
            const totalMarksLabel = formatTotalValue(totalValue);
            const graphId = `${key}-graph`.replace(/[^a-zA-Z0-9-_]/g, '-');

            return (
              <div
                key={key}
                className="bg-white/5 border border-white/10 rounded-3xl p-3 sm:p-4 text-white font-sora flex flex-col gap-3"
              >
                <div className="flex flex-col items-center gap-1 text-center">
                  <div className="text-lg sm:text-xl md:text-2xl font-bold">{courseTitle}</div>
                  {entry.courseCode && (
                    <div className="text-white/60 text-xs sm:text-sm uppercase tracking-[0.4em]">
                      Course Code: {entry.courseCode}
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <div className="text-white/60 text-xs uppercase tracking-[0.3em] mb-1">Total marks</div>
                  <div className="text-green-400 text-3xl sm:text-[2.5rem] font-semibold">{totalMarksLabel}</div>
                </div>

                <div className="flex justify-center">{renderAssessmentGraph(normalizedAssessments, graphId)}</div>

                <div className="grid gap-0 sm:gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 justify-items-center">
                  {normalizedAssessments.length === 0 ? (
                    <div className="col-span-full text-white/40 text-sm text-center">
                      No assessments recorded yet.
                    </div>
                  ) : (
                    normalizedAssessments.map((assessment, assessmentIndex) => (
                      <div
                        key={`${key}-assessment-${assessmentIndex}`}
                        className="aspect-square max-w-[110px] sm:max-w-[120px] bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl  flex flex-col items-center justify-center text-center p-4 gap-1"
                      >
                        <div className="text-[0.65rem] uppercase tracking-[0.4em] text-white/60">{assessment.name}</div>
                        <div className="text-2xl font-semibold text-white/90">
                          {assessment.score !== null && assessment.score !== undefined ? assessment.score : 'Not marked'}
                        </div>
                        <div className="text-xs text-white/50">Max {assessment.max}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

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
