'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { DEFAULT_RANDOM_FACT, getRandomFact } from "@/lib/randomFacts";
import { getStorageItem } from "@/lib/browserStorage";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { getClientCache, removeClientCache, setClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { registerAttendanceFetch } from "@/lib/attendancePrefetchScheduler";
import TopAppBar from '@/components/sdash/TopAppBar';
import PillNav from '@/components/sdash/PillNav';
import GlassCard from '@/components/sdash/GlassCard';
import StatChip from '@/components/sdash/StatChip';
import SwipeableCards from '@/components/sdash/SwipeableCards';
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
  /** Credits when provided by API (e.g. marks scraper middle column). */
  credit?: string;
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
  const [currentFact, setCurrentFact] = useState(DEFAULT_RANDOM_FACT);
  const [marksViewMode, setMarksViewMode] = useState<'cards' | 'list'>('cards');
  const fetchMarksDataRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);

  const entries = useMemo(() => marksPayload?.entries ?? [], [marksPayload?.entries]);

  const marksSummary = useMemo(() => {
    if (!entries.length) {
      return { avgPct: 0, totalObt: 0, totalMax: 0 };
    }
    let sumPct = 0;
    let totalObt = 0;
    let totalMax = 0;
    entries.forEach((entry) => {
      const a = Array.isArray(entry.assessments) ? entry.assessments : [];
      const obtained = a.reduce((s, x) => s + (x.score ?? 0), 0);
      const max =
        a.reduce((s, x) => s + x.max, 0) ||
        (entry.total != null ? entry.total : obtained) ||
        1;
      const ob = entry.total != null ? entry.total : obtained;
      totalObt += ob;
      totalMax += max;
      sumPct += max > 0 ? (ob / max) * 100 : 0;
    });
    return {
      avgPct: Math.round(sumPct / entries.length),
      totalObt,
      totalMax,
    };
  }, [entries]);

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

  /** Prefer explicit credit; tolerate alternate JSON keys from caches. */
  const getCreditLabel = (entry: MarksEntry): string | null => {
    const raw = entry.credit?.trim();
    if (raw) {
      return raw;
    }
    const loose = entry as MarksEntry & Record<string, unknown>;
    const alt = loose.credits ?? loose.Credit;
    if (alt == null || alt === '') {
      return null;
    }
    return String(alt).trim() || null;
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

  const marksRows = useMemo(() => {
    return entries.map((entry, index) => {
      const courseTitle = entry.courseTitle?.trim() || entry.courseCode?.trim() || `Course ${index + 1}`;
      const key = `marks-row-${index}-${entry.courseCode ?? "na"}-${courseTitle}`;
      const normalizedAssessments = Array.isArray(entry.assessments) ? entry.assessments : [];
      const computedAssessmentTotal = normalizedAssessments.reduce(
        (sum, assessment) => sum + (assessment.score ?? 0),
        0
      );
      const totalValue =
        entry.total !== null && entry.total !== undefined ? entry.total : computedAssessmentTotal;
      const maxTotal =
        normalizedAssessments.reduce((s, a) => s + a.max, 0) ||
        (totalValue > 0 ? totalValue : 1);
      const pct = maxTotal > 0 ? Math.round((totalValue / maxTotal) * 100) : 0;
      const graphId = `${key}-graph`.replace(/[^a-zA-Z0-9-_]/g, '-');
      const creditLabel = getCreditLabel(entry);

      return {
        key,
        entry,
        courseTitle,
        normalizedAssessments,
        totalValue,
        maxTotal,
        pct,
        graphId,
        creditLabel,
      };
    });
  }, [entries]);

  const renderAssessmentRows = (assessments: Assessment[]) => {
    if (!assessments.length) {
      return (
        <div className="text-xs text-sdash-text-muted font-sora">No exam components yet.</div>
      );
    }

    const rows: Array<{ items: Assessment[]; start: number }> = [];
    for (let i = 0; i < assessments.length; i += 3) {
      rows.push({ items: assessments.slice(i, i + 3), start: i });
    }

    return (
      <div className="flex flex-col gap-2">
        {rows.map(({ items, start }, rowIndex) => (
          <div key={`assessment-row-${start}-${rowIndex}`} className="grid grid-cols-3 gap-2">
            {items.map((assessment, colIndex) => (
              <div
                key={`assessment-${start + colIndex}-${assessment.max}-${assessment.score ?? "na"}`}
                className="bg-sdash-surface-1 border border-white/[0.07] rounded-[8px] px-3 py-2 min-w-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-sdash-text-muted font-sora truncate">
                    {assessment.name}
                  </p>
                  <p className="stat-number text-[12px] text-sdash-text-primary whitespace-nowrap">
                    {assessment.score ?? "—"}/{assessment.max}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderAssessmentGraph = (assessments: Assessment[], graphId: string) => {
    if (!assessments.length) {
      return (
        <div className="text-[0.65rem] text-white/60 uppercase tracking-wide text-center">
          Awaiting assessment data to plot the performance.
        </div>
      );
    }

    const baseWidth = Math.max(assessments.length * 60, 160);
    const chartWidth = Math.min(baseWidth, 260);
    const chartHeight = 130;
    const margin = 40;

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
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full max-w-[560px] mx-auto"
        >
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
            strokeWidth={1}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => (
            <g key={`${graphId}-point-${index}`}>
              <circle cx={point.x} cy={point.y} r={2} fill="#61f0a3" />
              <text
                x={point.x}
                y={point.y - 10}
                fill="#ffffffd1"
                fontSize="5"
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
            fontSize="5"
            textAnchor="middle"
          >
            {point.label}
          </text>
          ))}
          <text
            x={startX - 8}
            y={baseY}
            fill="#ffffff70"
            fontSize="5"
            textAnchor="end"
          >
            0%
          </text>
          <text
            x={startX - 8}
            y={margin}
            fill="#ffffff70"
            fontSize="5"
            textAnchor="end"
          >
            {Math.round(maxPercent)}%
          </text>
        </svg>
      </div>
    );
  };

  useErrorTracking(error, '/marks');

  useEffect(() => {
    fetchMarksDataRef.current = fetchMarksData;
  });

  useEffect(() => {
    void fetchMarksDataRef.current?.();
  }, []);

  useEffect(() => {
    if (!loading) return;
    setCurrentFact(getRandomFact());
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
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
      <TopAppBar title="Marks" showBack onRefresh={refreshMarksData} isRefreshing={loading} />
      <main className="flex flex-col justify-center flex-1 gap-6 px-4 py-8">
        <div className="text-sdash-text-primary font-sora text-lg font-bold text-center">Loading marks data...</div>
        <div className="max-w-2xl mx-auto w-full text-center">
          <div className="text-sdash-text-primary text-base font-sora font-bold mb-4">
            Meanwhile, here are some interesting facts:
          </div>
          <div className="text-sdash-text-secondary text-sm font-sora italic">
            {currentFact}
          </div>
        </div>
      </main>
      <PillNav />
    </div>
  );

  const renderEmpty = () => (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
      <TopAppBar title="Marks" showBack onRefresh={refreshMarksData} isRefreshing={loading} />
      <main className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8 text-center">
        <div className="text-sdash-text-primary text-base sm:text-lg font-sora">
          No marks data available
        </div>
        <div className="text-sdash-text-secondary text-sm font-sora">
          Use the refresh button in the header to try again.
        </div>
      </main>
      <PillNav />
    </div>
  );

  if (loading && !marksPayload) {
    return renderLoading();
  }

  if (!marksPayload) {
    return renderEmpty();
  }

  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-y-auto">
      <TopAppBar title="Marks" showBack onRefresh={refreshMarksData} isRefreshing={loading} />

      <main className="px-4 pt-3 w-full max-w-lg mx-auto">
        <div className="flex items-center justify-between gap-3 -mx-4 px-4">
          <div className="flex gap-3 overflow-x-auto hide-scrollbar">
            <StatChip>
              <span className="stat-number text-[13px] text-sdash-text-primary">{entries.length}</span>
              <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">subjects</span>
            </StatChip>
            <StatChip>
              <span className="stat-number text-[13px] text-sdash-text-primary">{formatTotalValue(marksSummary.totalObt)}</span>
              <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">
                /{formatTotalValue(marksSummary.totalMax)} total
              </span>
            </StatChip>
          </div>
          <div className="inline-flex items-center rounded-[8px] border border-white/[0.12] bg-sdash-surface-1 p-1">
            <button
              type="button"
              onClick={() => setMarksViewMode('cards')}
              className={`rounded-[5px] px-3 py-1.5 text-sm font-sora transition-colors ${
                marksViewMode === 'cards'
                  ? 'bg-sdash-accent text-sdash-text-primary'
                  : 'text-sdash-text-secondary'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setMarksViewMode('list')}
              className={`rounded-[5px] px-3 py-1.5 text-sm font-sora transition-colors ${
                marksViewMode === 'list'
                  ? 'bg-sdash-accent text-sdash-text-primary'
                  : 'text-sdash-text-secondary'
              }`}
            >
              List
            </button>
          </div>
        </div>

        {marksViewMode === 'list' && entries.length > 0 && (
          <div className="mt-3 flex w-full gap-2">
            <Link
              href="/attendance?openTool=predict"
              className="flex-1 rounded-full border border-white/[0.12] bg-sdash-surface-1 py-2.5 text-center text-sm font-sora text-sdash-text-primary touch-target"
            >
              Predict attendance
            </Link>
            <Link
              href="/attendance?openTool=odml"
              className="flex-1 rounded-full border border-white/[0.12] bg-sdash-surface-1 py-2.5 text-center text-sm font-sora text-sdash-text-primary touch-target"
            >
              Calculate ODML
            </Link>
          </div>
        )}

        {entries.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <p className="text-sm text-sdash-text-secondary font-sora">
              No records in the current data. Pull to refresh in the header.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-3">
            {marksViewMode === 'cards' ? (
              <>
                <SwipeableCards>
                  {marksRows.map(({ key, entry, courseTitle, normalizedAssessments, totalValue, maxTotal, graphId }) => (
                    <GlassCard key={key} className="p-3 flex flex-col gap-3">
                      <p className="font-sora font-semibold text-base text-sdash-text-primary">{courseTitle}</p>
                      {entry.courseCode ? (
                        <p className="text-xs text-sdash-text-secondary uppercase tracking-wider">{entry.courseCode}</p>
                      ) : null}

                      <div className="flex items-baseline gap-1 mt-2">
                        <span className="display-stat text-sdash-text-primary">{formatTotalValue(totalValue)}</span>
                        <span className="font-geist-mono text-2xl text-sdash-text-secondary">/{formatTotalValue(maxTotal)}</span>
                      </div>

                      <div className="mt-2">{renderAssessmentRows(normalizedAssessments)}</div>
                      <div className="pt-2">{renderAssessmentGraph(normalizedAssessments, graphId)}</div>
                    </GlassCard>
                  ))}
                </SwipeableCards>
                <div className="mt-3 flex w-full gap-2">
                  <Link
                    href="/attendance?openTool=predict"
                    className="flex-1 rounded-full border border-white/[0.12] bg-sdash-surface-1 py-2.5 text-center text-sm font-sora text-sdash-text-primary touch-target"
                  >
                    Predict attendance
                  </Link>
                  <Link
                    href="/attendance?openTool=odml"
                    className="flex-1 rounded-full border border-white/[0.12] bg-sdash-surface-1 py-2.5 text-center text-sm font-sora text-sdash-text-primary touch-target"
                  >
                    Calculate ODML
                  </Link>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {marksRows.map(({ key, entry, courseTitle, normalizedAssessments, totalValue, maxTotal, pct, creditLabel }) => (
                  <GlassCard key={key} className="p-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-sora font-semibold text-base text-sdash-text-primary leading-snug">
                          {courseTitle}
                        </p>
                        <p className="font-geist-mono text-2xl text-sdash-text-primary shrink-0">
                          {formatTotalValue(totalValue)}/{formatTotalValue(maxTotal)}
                        </p>
                      </div>
                      {(entry.courseCode || creditLabel) ? (
                        <p className="text-xs text-sdash-text-secondary uppercase tracking-wider">
                          {entry.courseCode ? <span>{entry.courseCode}</span> : null}
                          {entry.courseCode && creditLabel ? (
                            <span className="mx-1.5 text-sdash-text-muted normal-case">·</span>
                          ) : null}
                          {creditLabel ? (
                            <span className="normal-case">{creditLabel} credits</span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="h-px w-full bg-white/[0.12]" />
                    <div>{renderAssessmentRows(normalizedAssessments)}</div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <PillNav />

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-sdash-surface-1 border border-white/[0.08] rounded-[20px] p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-sora font-semibold text-sdash-text-primary mb-4">Session expired</h2>
            <p className="text-sdash-text-secondary text-sm mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <Link
              href="/auth"
              onClick={handleReAuthenticate}
              className="block w-full text-center bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
