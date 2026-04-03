'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from 'next/link';
import {
  getSlotOccurrences,
  getDayOrderStats,
  getCurrentDateString,
  normalizeCalendarDayOrder,
  type SlotOccurrence,
  type DayOrderStats,
  type TimetableDayOrder,
} from "@/lib/timetableUtils";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { useErrorTracking } from "@/lib/useErrorTracking";
import type html2canvas from 'html2canvas';
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import TopAppBar from "@/components/sdash/TopAppBar";
import { TimetablePageSkeleton } from "@/components/sdash/PageSkeletons";
import PillNav from "@/components/sdash/PillNav";
import GlassCard from "@/components/sdash/GlassCard";
import StatChip from "@/components/sdash/StatChip";
import { trackPostRequest } from "@/lib/postAnalytics";
import { Check, ChevronDown, Pencil } from "lucide-react";
// import { motion, useAnimation } from "framer-motion"; // Customise timetable hint (disabled)

interface TimeSlotCell {
  course: string;
  courseType?: string;
  online?: boolean;
}

interface TimeSlot {
  time: string;
  do1: string | TimeSlotCell;
  do2: string | TimeSlotCell;
  do3: string | TimeSlotCell;
  do4: string | TimeSlotCell;
  do5: string | TimeSlotCell;
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

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: number;
}

const normalizeCalendarDate = (dateStr: string): string => {
  if (!dateStr) return dateStr;

  const ddMMYYYYRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (ddMMYYYYRegex.test(dateStr)) {
    return dateStr;
  }

  // Handle "DD/Month 'YY" format, e.g. "19/Jul '25"
  const parts = dateStr.split('/');
  if (parts.length === 2) {
    const [day, monthYear] = parts;
    const [monthName, yearStr] = monthYear.split(' ');

    const monthNames: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    const monthNum = monthNames[monthName];
    if (monthNum && yearStr) {
      const shortYear = yearStr.replace("'", "");
      const fullYear = 2000 + parseInt(shortYear, 10);
      const month = monthNum.toString().padStart(2, '0');
      const dayPadded = day.padStart(2, '0');
      return `${dayPadded}/${month}/${fullYear}`;
    }
  }

  return dateStr;
};

const normalizeCalendarEvents = (events: CalendarEvent[]): CalendarEvent[] =>
  events.map((event) => ({
    ...event,
    date: normalizeCalendarDate(event.date),
  }));

const extractCalendarEvents = (input: unknown): CalendarEvent[] | null => {
  // Direct array format
  if (Array.isArray(input)) {
    const firstItem = input[0] as Record<string, unknown> | undefined;

    // New nested format: [{ month, dates: [...] }, ...]
    if (firstItem && typeof firstItem === 'object' && 'month' in firstItem && 'dates' in firstItem) {
      const flattened: CalendarEvent[] = [];
      (input as Array<Record<string, unknown>>).forEach((monthData) => {
        const month = typeof monthData.month === 'string' ? monthData.month : '';
        const dates = Array.isArray(monthData.dates) ? monthData.dates : [];
        dates.forEach((dateData) => {
          const dateRow = dateData as Record<string, unknown>;
          flattened.push({
            date: String(dateRow.date ?? ''),
            day_name: String(dateRow.day ?? ''),
            content: String(dateRow.event ?? ''),
            day_order: String(dateRow.day_order ?? ''),
            month,
            month_name: month.split(' ')[0] || undefined,
            year: undefined,
          });
        });
      });
      return flattened;
    }

    // Legacy flat format
    return input as CalendarEvent[];
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const obj = input as Record<string, unknown>;

  // Wrapped: { data: [...] }
  if (Array.isArray(obj.data)) {
    return extractCalendarEvents(obj.data);
  }

  // Wrapped: { success: true, data: [...] } or { success: { data: [...] } }
  if ('success' in obj) {
    const successValue = obj.success;
    if (successValue && typeof successValue === 'object' && Array.isArray((successValue as Record<string, unknown>).data)) {
      return extractCalendarEvents((successValue as Record<string, unknown>).data);
    }
  }

  // Unified: { calendar: ... }
  if ('calendar' in obj) {
    return extractCalendarEvents(obj.calendar);
  }

  return null;
};

/** Day order labels and row keys for grid + DO tabs */
const TIMETABLE_DAY_LABELS = ["DO 1", "DO 2", "DO 3", "DO 4", "DO 5"] as const;
const TIMETABLE_DAY_KEYS = ["do1", "do2", "do3", "do4", "do5"] as const;

/** Default slot order (matches transform + scraper grid). */
const DEFAULT_TIME_SLOT_ORDER = [
  "08:00-08:50",
  "08:50-09:40",
  "09:45-10:35",
  "10:40-11:30",
  "11:35-12:25",
  "12:30-01:20",
  "01:25-02:15",
  "02:20-03:10",
  "03:10-04:00",
  "04:00-04:50",
] as const;

/** Batch slot letters per day row (scraper-3/scraper/timetable.go). */
const BATCH_1_SLOTS: string[][] = [
  ["A", "A", "F", "F", "G", "P6", "P7", "P8", "P9", "P10"],
  ["P11", "P12", "P13", "P14", "P15", "B", "B", "G", "G", "A"],
  ["C", "C", "A", "D", "B", "P26", "P27", "P28", "P29", "P30"],
  ["P31", "P32", "P33", "P34", "P35", "D", "D", "B", "E", "C"],
  ["E", "E", "C", "F", "D", "P46", "P47", "P48", "P49", "P50"],
];

const BATCH_2_SLOTS: string[][] = [
  ["P1", "P2", "P3", "P4", "P5", "A", "A", "F", "F", "G"],
  ["B", "B", "G", "G", "A", "P16", "P17", "P18", "P19", "P20"],
  ["P21", "P22", "P23", "P24", "P25", "C", "C", "A", "D", "B"],
  ["D", "D", "B", "E", "C", "P36", "P37", "P38", "P39", "P40"],
  ["P41", "P42", "P43", "P44", "P45", "E", "E", "C", "F", "D"],
];

function getSlotLetterForGrid(batch: string, dayNumber: number, slotIndex: number): string {
  const dayIx = dayNumber - 1;
  const grid = batch === "1" ? BATCH_1_SLOTS : BATCH_2_SLOTS;
  if (dayIx < 0 || dayIx >= grid.length) return "X";
  const row = grid[dayIx];
  if (slotIndex < 0 || slotIndex >= row.length) return "X";
  return row[slotIndex];
}

/** Sparse patch document stored in public.timetable_modification. */
interface TimetableAddCellData {
  code: string;
  name: string;
  slot: string;
  online: boolean;
  roomNo: string;
  slotType: string;
  courseType: string;
  isOptional: boolean;
}

type TimetableModCell = { __type: "ADD"; data: TimetableAddCellData } | { __type: "REMOVE" };

interface TimetableModificationDoc {
  batch: string;
  regNumber: string;
  schedule: Array<{ day: number; table: Array<TimetableModCell | null> }>;
}

function mergeCellIntoDoc(
  prev: TimetableModificationDoc,
  day: number,
  slotIndex: number,
  cell: TimetableModCell | null,
  batch: string,
  regNumber: string
): TimetableModificationDoc {
  const schedule = [...(prev.schedule ?? [])];
  let dayEntry = schedule.find((d) => d.day === day);
  const table: Array<TimetableModCell | null> = dayEntry
    ? [...dayEntry.table]
    : Array.from({ length: 10 }, () => null);
  while (table.length < 10) {
    table.push(null);
  }
  if (slotIndex < 0 || slotIndex >= 10) {
    return prev;
  }
  table[slotIndex] = cell;
  const newDay = { day, table };
  const idx = schedule.findIndex((d) => d.day === day);
  if (idx >= 0) {
    schedule[idx] = newDay;
  } else {
    schedule.push(newDay);
  }
  return { batch, regNumber, schedule };
}

function pruneModificationDoc(doc: TimetableModificationDoc): TimetableModificationDoc {
  const schedule = doc.schedule.filter((day) => {
    if (!Array.isArray(day.table)) {
      return false;
    }
    return day.table.some((c) => c !== null && c !== undefined);
  });
  return { ...doc, schedule };
}

/**
 * Client-side preview: applies the same sparse patch semantics as the Go worker (ADD/REMOVE/skip null)
 * onto the cached TimetableData shape so the list + quick stats match before reload.
 */
function applyModificationPreviewToTimetableData(
  base: TimetableData,
  pending: TimetableModificationDoc | null
): TimetableData {
  if (!pending?.schedule?.length) {
    return base;
  }
  const clone = JSON.parse(JSON.stringify(base)) as TimetableData;
  const timeOrder =
    clone.time_slots?.length > 0 ? clone.time_slots : [...DEFAULT_TIME_SLOT_ORDER];

  for (const dayPatch of pending.schedule) {
    const doName = TIMETABLE_DAY_LABELS[dayPatch.day - 1];
    if (!doName || !Array.isArray(dayPatch.table)) {
      continue;
    }
    let doEntry = findDayOrderEntry(clone.timetable, doName);
    if (!doEntry) {
      const created = { do_name: doName, time_slots: {} } as TimetableDayOrder;
      (clone.timetable as Record<string, TimetableDayOrder>)[doName] = created;
      doEntry = created;
    }
    if (!doEntry.time_slots) {
      doEntry.time_slots = {};
    }
    const tsMap = doEntry.time_slots as Record<
      string,
      {
        slot_code: string;
        course_title: string;
        slot_type: string;
        is_alternate: boolean;
        courseType?: string;
        online?: boolean;
      }
    >;

    dayPatch.table.forEach((cell, slotIndex) => {
      if (cell == null) {
        return;
      }
      const timeKey = timeOrder[slotIndex];
      if (!timeKey) {
        return;
      }
      if (cell.__type === "REMOVE") {
        delete tsMap[timeKey];
      } else if (cell.__type === "ADD") {
        const d = cell.data;
        tsMap[timeKey] = {
          slot_code: d.slot,
          course_title: d.name,
          slot_type: d.slotType,
          is_alternate: false,
          courseType: d.courseType,
          online: d.online,
        };
      }
    });
  }
  return clone;
}

/**
 * Normalizes user_cache timetable payload from POST /api/data/cache (matches shapes handled in fetchUnifiedData).
 */
function parseUserCacheTimetablePayload(
  cachedData: unknown,
  transformGoSchedule: (goData: Record<string, unknown>) => TimetableData
): TimetableData | null {
  if (!cachedData || typeof cachedData !== "object") {
    return null;
  }
  const obj = cachedData as Record<string, unknown>;

  if ("data" in obj && obj.data && typeof obj.data === "object" && obj.data !== null) {
    const inner = obj.data as Record<string, unknown>;
    if ("schedule" in inner && Array.isArray(inner.schedule)) {
      return transformGoSchedule(inner);
    }
    if ("timetable" in inner || "time_slots" in inner) {
      return obj.data as TimetableData;
    }
  }

  if ("schedule" in obj && Array.isArray(obj.schedule)) {
    return transformGoSchedule(obj);
  }
  if ("timetable" in obj || "time_slots" in obj) {
    return cachedData as TimetableData;
  }
  return null;
}

const normalizeDayKey = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

const findDayOrderEntry = (
  timetable: TimetableData['timetable'],
  dayName: string
): TimetableDayOrder | null => {
  const normalizedTarget = normalizeDayKey(dayName);
  const directMatch = timetable[dayName];
  if (directMatch) {
    return directMatch;
  }

  const normalizedEntry = Object.entries(timetable).find(([key]) => normalizeDayKey(key) === normalizedTarget);
  return normalizedEntry ? (normalizedEntry[1] as TimetableDayOrder) : null;
};

function convertTimetableDataToTimeSlots(data: TimetableData): TimeSlot[] {
  const timeSlots: TimeSlot[] = [];

  if (!data || !data.timetable || typeof data.timetable !== 'object') {
    console.warn('[Timetable] ⚠️ Invalid timetable data structure:', data);
    return timeSlots;
  }

  const timeSlotKeys = data.time_slots || [
    "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
    "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
  ];

  timeSlotKeys.forEach(timeSlot => {
    const timeSlotEntry: TimeSlot = {
      time: timeSlot,
      do1: "",
      do2: "",
      do3: "",
      do4: "",
      do5: ""
    };

    ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach((doName, index) => {
      const timetableRecord = data.timetable && typeof data.timetable === 'object' ? (data.timetable as TimetableData['timetable']) : {};
      const doData = findDayOrderEntry(timetableRecord, doName);
      if (doData && typeof doData === 'object' && doData !== null) {
        const doDataTyped = doData as { time_slots?: Record<string, { course_title?: string; courseType?: string; online?: boolean }> };
        if (doDataTyped.time_slots && doDataTyped.time_slots[timeSlot]) {
          const slotInfo = doDataTyped.time_slots[timeSlot];
          const courseTitle = slotInfo.course_title || "";
          const courseType = slotInfo.courseType;
          const online = slotInfo.online;

          const doKey = `do${index + 1}` as keyof TimeSlot;
          if (courseType || online !== undefined) {
            (timeSlotEntry as unknown as Record<string, string | TimeSlotCell>)[doKey] = {
              course: courseTitle,
              courseType: courseType,
              online: online
            };
          } else {
            timeSlotEntry[doKey] = courseTitle;
          }
        }
      }
    });

    timeSlots.push(timeSlotEntry);
  });

  return timeSlots;
}

const parseTimetableCandidate = (obj: unknown): TimetableData | null => {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const candidate = obj as Partial<TimetableData>;
  const metadata =
    typeof candidate.metadata === 'object' && candidate.metadata !== null
      ? (candidate.metadata as TimetableData['metadata'])
      : {
        generated_at: '',
        source: '',
        academic_year: '',
        format: ''
      };
  const time_slots = Array.isArray(candidate.time_slots) ? (candidate.time_slots as string[]) : [];
  const slot_mapping =
    typeof candidate.slot_mapping === 'object' && candidate.slot_mapping !== null
      ? (candidate.slot_mapping as TimetableData['slot_mapping'])
      : {};
  const timetable =
    typeof candidate.timetable === 'object' && candidate.timetable !== null
      ? (candidate.timetable as TimetableData['timetable'])
      : {};

  return {
    metadata,
    time_slots,
    slot_mapping,
    timetable
  };
};

const resolveCachedTimetable = (value: unknown): TimetableData | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if ('data' in candidate) {
    const nested = parseTimetableCandidate(candidate.data);
    if (nested) {
      return nested;
    }
  }

  return parseTimetableCandidate(candidate);
};

interface TimetableInitialSnapshot {
  rawTimetableData: TimetableData | null;
  timetableSlots: TimeSlot[];
  slotOccurrences: SlotOccurrence[];
  calendarData: CalendarEvent[];
  dayOrderStats: DayOrderStats | null;
  hasTimetableCache: boolean;
}

/*
 * --- Customise timetable hint (disabled): component + framer-motion import above ---
function CustomiseTimetableHint({ onFadeComplete }: { onFadeComplete: () => void }) {
  const controls = useAnimation();
  useEffect(() => {
    let cancelled = false;
    async function runSequence() {
      await controls.set({ x: 0, opacity: 1 });
      for (let cycle = 0; cycle < 3; cycle++) {
        await controls.start({
          x: -12,
          transition: { duration: 0.45, ease: [0.45, 0, 0.55, 1] },
        });
        if (cancelled) return;
        await controls.start({
          x: 0,
          transition: { duration: 0.45, ease: [0.45, 0, 0.55, 1] },
        });
        if (cancelled) return;
      }
      await controls.start({ opacity: 0, transition: { duration: 0.4 } });
      if (!cancelled) onFadeComplete();
    }
    void runSequence();
    return () => {
      cancelled = true;
      void controls.stop();
    };
  }, [controls, onFadeComplete]);
  return (
    <motion.div
      animate={controls}
      initial={{ x: 0, opacity: 1 }}
      className="pointer-events-none flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] font-sora text-sdash-text-muted"
    >
      <span className="text-sdash-accent" aria-hidden>
        ←
      </span>
      <span>Customise your time table</span>
    </motion.div>
  );
}
*/

const getInitialTimetableSnapshot = (): TimetableInitialSnapshot => {
  const cachedTimetable = resolveCachedTimetable(getClientCache('timetable'));
  const calendarData = getClientCache<CalendarEvent[]>('calendar') ?? [];
  const dayOrderStats = calendarData.length ? getDayOrderStats(calendarData) : null;
  const timetableSlots = cachedTimetable ? convertTimetableDataToTimeSlots(cachedTimetable) : [];
  const slotOccurrences = cachedTimetable ? getSlotOccurrences(cachedTimetable) : [];
  return {
    rawTimetableData: cachedTimetable,
    timetableSlots,
    slotOccurrences,
    calendarData,
    dayOrderStats,
    hasTimetableCache: Boolean(cachedTimetable),
  };
};

export default function TimetablePage() {
  // Important: keep the initial server/client render deterministic to avoid hydration mismatches.
  // We'll fetch/cache in effects after mount.
  const [timetableData, setTimetableData] = useState<TimeSlot[]>([]);
  const [rawTimetableData, setRawTimetableData] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/timetable');
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fetchUnifiedDataRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);
  /** Active day order tab for compass-style slot list */
  const [activeDayOrder, setActiveDayOrder] = useState<string>("DO 1");
  const [hasUserSelectedDayOrder, setHasUserSelectedDayOrder] = useState(false);

  /**
   * Timetable edit session: pendingModificationDoc is local until global Save (then API + backend refresh).
   * While editing, preview = raw + pending. After Save, sessionSavedTimetableOverride keeps merged grid until reload.
   */
  const [timetableEditMode, setTimetableEditMode] = useState(false);
  const [editorContextLoading, setEditorContextLoading] = useState(false);
  const [editorContextLoaded, setEditorContextLoaded] = useState(false);
  const [pendingModificationDoc, setPendingModificationDoc] = useState<TimetableModificationDoc | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    timeKey: string;
    slotIndex: number;
    dayNumber: number;
    subject: string | null;
    badgeType: "theory" | "lab" | null;
  } | null>(null);
  const [editorBatch, setEditorBatch] = useState("2");
  const [editorRegNumber, setEditorRegNumber] = useState("");
  const [courseTitleOptions, setCourseTitleOptions] = useState<string[]>([]);
  const [courseItems, setCourseItems] = useState<Array<{ title: string; code: string }>>([]);
  const [editCourseTitle, setEditCourseTitle] = useState("");
  const [editCourseTitleMode, setEditCourseTitleMode] = useState<"pick" | "new">("pick");
  const [newCourseTitleInput, setNewCourseTitleInput] = useState("");
  const [editKind, setEditKind] = useState<"theory" | "lab">("theory");
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  /** True only while global Save runs (upsert + timetable refresh). */
  const [savingGlobalModification, setSavingGlobalModification] = useState(false);
  /**
   * Merged timetable snapshot after successful global Save — in-memory only; cleared on full page reload.
   * Covers the gap where client cache refresh returns before the worker merges modifications into user_cache.
   */
  const [sessionSavedTimetableOverride, setSessionSavedTimetableOverride] = useState<TimetableData | null>(null);
  const courseMenuRef = useRef<HTMLDivElement | null>(null);
  const kindMenuRef = useRef<HTMLDivElement | null>(null);
  /** Deferred post-save Supabase cache rebuild (clears optimistic override when hydrate succeeds). */
  const postSaveCacheRebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
  // --- Customise timetable hint (disabled): DB status + replay nonce + fade dismiss ---
  const [hasModificationRecordInDb, setHasModificationRecordInDb] = useState<boolean | null>(null);
  const [hintNonce, setHintNonce] = useState(0);
  const [hintDismissed, setHintDismissed] = useState(false);
  const modificationStatusFetchedRef = useRef(false);
  const handleHintFadeComplete = useCallback(() => {
    setHintDismissed(true);
  }, []);
  useEffect(() => {
    setHintDismissed(false);
  }, [hintNonce]);
  useEffect(() => {
    if (loading) {
      modificationStatusFetchedRef.current = false;
    }
  }, [loading]);
  useEffect(() => {
    if (loading || !rawTimetableData) {
      return;
    }
    if (modificationStatusFetchedRef.current) {
      return;
    }
    modificationStatusFetchedRef.current = true;
    const access_token = getStorageItem("access_token");
    if (!access_token) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await trackPostRequest("/api/timetable/modification", {
          action: "timetable_modification_status",
          dataType: "timetable",
          payload: { access_token, action: "status" },
          omitPayloadKeys: ["access_token"],
        });
        const data = (await response.json()) as {
          success?: boolean;
          has_modification_record?: boolean;
        };
        if (cancelled || !data.success) {
          return;
        }
        const has = Boolean(data.has_modification_record);
        setHasModificationRecordInDb(has);
        if (!has) {
          setHintNonce((n) => n + 1);
        }
      } catch (e) {
        console.warn("[Timetable] modification status failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, rawTimetableData]);
  */

  // For the left "day meter" depletion bar.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid calling setState after unmount when a delayed post-save cache rebuild was scheduled.
  useEffect(() => {
    return () => {
      if (postSaveCacheRebuildTimeoutRef.current != null) {
        clearTimeout(postSaveCacheRebuildTimeoutRef.current);
        postSaveCacheRebuildTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    fetchUnifiedDataRef.current = fetchUnifiedData;
  });

  useEffect(() => {
    void fetchUnifiedDataRef.current?.();
  }, []);

  const todayDayOrderNumber = useMemo(() => {
    if (!mounted) return null;
    const todayKey = getCurrentDateString();
    const todayEvent = calendarData.find((e) => e.date === todayKey);
    return normalizeCalendarDayOrder(todayEvent?.day_order);
  }, [calendarData, mounted]);

  const todayDayOrderLabel = todayDayOrderNumber ? `DO ${todayDayOrderNumber}` : null;

  // Default the DO tab to today's day order (from calendar), but don't override once user clicks.
  useEffect(() => {
    if (hasUserSelectedDayOrder) return;
    if (!todayDayOrderLabel) return;
    setActiveDayOrder(todayDayOrderLabel);
  }, [todayDayOrderLabel, hasUserSelectedDayOrder]);

  const refreshTimetableData = async (options?: {
    afterModificationSave?: boolean;
    /** When true, skip full-page loading flags (background rebuild after Save). */
    silent?: boolean;
  }) => {
    const afterModificationSave = options?.afterModificationSave === true;
    const silent = options?.silent === true;

    const hydrateTimetableFromSupabaseUserCache = async (token: string) => {
      const cacheResponse = await trackPostRequest("/api/data/cache", {
        action: "cache_fetch",
        dataType: "timetable",
        primary: false,
        payload: { access_token: token, data_type: "timetable" },
        omitPayloadKeys: ["access_token"],
      });
      const cacheResult = (await cacheResponse.json()) as {
        success?: boolean;
        data?: unknown;
        error?: string;
      };

      if (!cacheResult.success) {
        console.warn("[Timetable] Supabase timetable user_cache read failed:", cacheResult.error);
        return;
      }

      const timetableDataToUse = parseUserCacheTimetablePayload(
        cacheResult.data,
        transformGoBackendTimetableToOldFormat
      );

      if (timetableDataToUse && timetableDataToUse.timetable) {
        setClientCache("timetable", timetableDataToUse);
        setRawTimetableData(timetableDataToUse);
        const convertedData = convertTimetableDataToTimeSlots(timetableDataToUse);
        setTimetableData(convertedData);
        const occurrences = getSlotOccurrences(timetableDataToUse);
        setSlotOccurrences(occurrences);
        try {
          localStorage.setItem("sdash_slotOccurrences", JSON.stringify(occurrences));
        } catch (e) {
          console.warn("[Timetable] Failed to cache slot occurrences:", e);
        }
        setSessionSavedTimetableOverride(null);
        console.log("[Timetable] Rebuilt client timetable cache from Supabase user_cache row");
      } else if (cacheResult.data == null) {
        console.warn("[Timetable] No timetable row in Supabase user_cache");
      } else {
        console.warn("[Timetable] Supabase timetable payload could not be parsed to TimetableData");
      }
    };

    try {
      if (!silent) {
        setLoading(true);
        setError(null);
        setIsRefreshing(true);
      }

      const access_token = getStorageItem("access_token");

      if (!access_token) {
        console.error("[Timetable] No access token found");
        if (!silent) {
          setError("Please sign in to view your timetable");
        }
        return;
      }

      if (afterModificationSave) {
        removeClientCache("timetable");
        console.log(
          silent
            ? "[Timetable] Cleared timetable client cache before silent post-save rebuild"
            : "[Timetable] Cleared timetable client cache before post-save backend refresh"
        );
      } else if (!silent) {
        console.log("[Timetable] 🔄 Force refreshing timetable data...");
      }

      try {
        const response = await trackPostRequest("/api/data/refresh", {
          action: "data_refresh",
          dataType: "timetable",
          payload: {
            ...getRequestBodyWithPassword(access_token, false),
            data_type: "timetable",
          },
          omitPayloadKeys: ["password", "access_token"],
        });

        const result = await response.json();
        console.log("[Timetable] Refresh API response:", result);

        if (!response.ok || !result.success) {
          console.warn(
            "[Timetable] Refresh API did not complete successfully;",
            afterModificationSave ? "still rebuilding from Supabase user_cache:" : "continuing with unified fetch:",
            result.error
          );
        } else {
          console.log("[Timetable] ✅ Refresh completed, updating local state...");
        }
      } catch (refreshErr) {
        console.warn(
          "[Timetable] Refresh request threw;",
          afterModificationSave ? "still rebuilding from Supabase user_cache:" : "attempting unified cache fetch:",
          refreshErr
        );
      }

      if (afterModificationSave) {
        await hydrateTimetableFromSupabaseUserCache(access_token);
        return;
      }

      console.log("[Timetable] Fetching timetable state after refresh step...");
      await fetchUnifiedData(false);
    } catch (err) {
      console.warn("[Timetable] Refresh pipeline error:", err);
      if (afterModificationSave) {
        const token = getStorageItem("access_token");
        if (token) {
          await hydrateTimetableFromSupabaseUserCache(token);
        }
        return;
      }
      await fetchUnifiedData(false);
    } finally {
      if (!silent) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  const fetchCalendarFallback = async (access_token: string): Promise<boolean> => {
    try {
      const calendarResponse = await trackPostRequest('/api/data/all', {
        action: 'data_unified_fetch',
        dataType: 'calendar',
        payload: getRequestBodyWithPassword(access_token, false, ['calendar']),
        omitPayloadKeys: ['password', 'access_token'],
      });

      const calendarResult = await calendarResponse.json();
      if (!calendarResult?.success) {
        return false;
      }

      const parsedCalendar = extractCalendarEvents(calendarResult.data?.calendar ?? calendarResult.data);
      if (!parsedCalendar || parsedCalendar.length === 0) {
        return false;
      }

      const normalizedCalendar = normalizeCalendarEvents(parsedCalendar);
      setCalendarData(normalizedCalendar);
      setClientCache('calendar', normalizedCalendar);
      const stats = getDayOrderStats(normalizedCalendar);
      setDayOrderStats(stats);
      console.log('[Timetable] ✅ Calendar fallback loaded');
      return true;
    } catch (calendarErr) {
      console.error('[Timetable] ❌ Error in calendar fallback fetch:', calendarErr);
      return false;
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      let hasResolvedCalendarInThisRun = false;
      const applyCalendarData = (events: CalendarEvent[], source: string): DayOrderStats => {
        const normalizedCalendar = normalizeCalendarEvents(events);
        setCalendarData(normalizedCalendar);
        setClientCache('calendar', normalizedCalendar);
        const stats = getDayOrderStats(normalizedCalendar);
        setDayOrderStats(stats);
        hasResolvedCalendarInThisRun = true;
        console.log(`[Timetable] ✅ Day order stats calculated from ${source}:`, stats);
        return stats;
      };

      const hasDisplayCache = timetableData.length > 0 || slotOccurrences.length > 0;
      const shouldShowLoading = forceRefresh || !hasDisplayCache;
      setLoading(shouldShowLoading);
      setError(null);
      if (forceRefresh) {
        setIsRefreshing(true);
      }

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Timetable] No access token found');
        setError('Please sign in to view your timetable');
        setLoading(false);
        return;
      }

      // Check client-side cache first (unless force refresh)
      let cachedTimetable: TimetableData | null = null;
      let hasValidCache = false;
      let needsBackgroundRefresh = false;

      if (!forceRefresh) {
        const cachedTimetableRaw = getClientCache('timetable');

        // Handle cached timetable structure: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
        if (cachedTimetableRaw) {
          let timetableDataToUse: TimetableData | null = null;

          if (typeof cachedTimetableRaw === 'object' && cachedTimetableRaw !== null) {
            // Check if cached data has 'data' property (wrapped API response format)
            if ('data' in cachedTimetableRaw && typeof (cachedTimetableRaw as { data?: unknown }).data === 'object' && (cachedTimetableRaw as { data?: unknown }).data !== null) {
              const cachedData = (cachedTimetableRaw as { data?: TimetableData }).data;
              if (cachedData && 'timetable' in cachedData) {
                timetableDataToUse = cachedData;
                console.log('[Timetable] ✅ Using client-side cache for timetable (extracted from data property)');
              }
            }
            // Check if cached data is already in TimetableData format (has timetable property at root)
            else if ('timetable' in cachedTimetableRaw || 'time_slots' in cachedTimetableRaw) {
              timetableDataToUse = cachedTimetableRaw as TimetableData;
              console.log('[Timetable] ✅ Using client-side cache for timetable (direct format)');
            }
          }

          if (timetableDataToUse) {
            cachedTimetable = timetableDataToUse;
            hasValidCache = true;
            setRawTimetableData(timetableDataToUse);
            const convertedData = convertTimetableDataToTimeSlots(timetableDataToUse);
            setTimetableData(convertedData);

            // Calculate quick stats from cached timetable data
            const occurrences = getSlotOccurrences(timetableDataToUse);
            setSlotOccurrences(occurrences);

            // Cache the calculated occurrences in localStorage
            try {
              localStorage.setItem('sdash_slotOccurrences', JSON.stringify(occurrences));
            } catch (e) {
              console.warn('[Timetable] Failed to cache slot occurrences:', e);
            }

            // Try to load cached calendar data first so current DO can render immediately.
            try {
              const cachedCalendar = getClientCache<CalendarEvent[]>('calendar');
              if (cachedCalendar && Array.isArray(cachedCalendar)) {
                applyCalendarData(cachedCalendar, 'calendar cache');
                console.log('[Timetable] ✅ Loaded cached calendar data');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached calendar data:', e);
            }

            // Try to load cached day order stats from localStorage
            try {
              const cachedDayOrderStatsStr = localStorage.getItem('sdash_dayOrderStats');
              if (cachedDayOrderStatsStr) {
                const cachedDayOrderStats = JSON.parse(cachedDayOrderStatsStr);
                setDayOrderStats(cachedDayOrderStats);
                console.log('[Timetable] ✅ Loaded cached day order stats');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached day order stats:', e);
            }

            // Try to load cached slot occurrences from localStorage
            try {
              const cachedSlotOccurrencesStr = localStorage.getItem('sdash_slotOccurrences');
              if (cachedSlotOccurrencesStr) {
                const cachedSlotOccurrences = JSON.parse(cachedSlotOccurrencesStr);
                setSlotOccurrences(cachedSlotOccurrences);
                console.log('[Timetable] ✅ Loaded cached slot occurrences');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached slot occurrences:', e);
            }

            console.log('[Timetable] ✅ Quick stats calculated from cached timetable data');
          } else {
            console.warn('[Timetable] ⚠️ Cached timetable has unexpected structure, will fetch fresh data');
          }
        } else {
          // Client cache expired, fetch Supabase cache (even if expired)
          console.log('[Timetable] 🔍 Client cache expired/missing, fetching Supabase cache (even if expired)...');
          try {
            const result = await trackPostRequest('/api/data/cache', {
              action: 'cache_fetch',
              dataType: 'timetable',
              primary: false,
              payload: { access_token, data_type: 'timetable' },
              omitPayloadKeys: ['access_token'],
            });
            const cacheResult = await result.json();
            if (cacheResult.success && cacheResult.data) {
              console.log(`[Timetable] ✅ Found Supabase cache (expired: ${cacheResult.isExpired})`);
              let timetableDataToUse: TimetableData | null = null;
              const cachedData = cacheResult.data;

              if (typeof cachedData === 'object' && cachedData !== null) {
                if ('data' in cachedData && typeof (cachedData as { data?: unknown }).data === 'object' && (cachedData as { data?: unknown }).data !== null) {
                  const wrappedData = (cachedData as { data?: TimetableData }).data;
                  if (wrappedData && 'timetable' in wrappedData) {
                    timetableDataToUse = wrappedData;
                  }
                } else if ('timetable' in cachedData || 'time_slots' in cachedData) {
                  timetableDataToUse = cachedData as TimetableData;
                }
              }

              if (timetableDataToUse) {
                cachedTimetable = timetableDataToUse;
                hasValidCache = true;
                setRawTimetableData(timetableDataToUse);
                const convertedData = convertTimetableDataToTimeSlots(timetableDataToUse);
                setTimetableData(convertedData);
                if (cacheResult.isExpired) {
                  needsBackgroundRefresh = true;
                  console.log('[Timetable] ⚠️ Cache is expired, will refresh in background');
                }
              }
            }
          } catch (err) {
            console.error('[Timetable] ❌ Error fetching Supabase cache:', err);
          }
        }
      } else {
        // Force refresh: clear client cache
        removeClientCache('timetable');
        console.log('[Timetable] 🗑️ Cleared client cache for force refresh');
      }

      // Only fetch if cache is missing or force refresh or expired
      if (!hasValidCache || forceRefresh || needsBackgroundRefresh) {
        const apiStartTime = Date.now();
        const fetchType = forceRefresh ? '(force refresh)' : needsBackgroundRefresh ? '(background refresh - cache expired)' : '(fetching fresh data)';
        console.log(`[Timetable] 🚀 Fetching from API ${fetchType}`);

        // Use request deduplication - ensures only ONE page calls backend at a time
        const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
        const apiResult = await deduplicateRequest(requestKey, async () => {
          const response = await trackPostRequest('/api/data/all', {
            action: 'data_unified_fetch',
            dataType: 'user',
            payload: getRequestBodyWithPassword(access_token, forceRefresh),
            omitPayloadKeys: ['password', 'access_token'],
          });

          const result = await response.json();
          return { response, result };
        });

        const response = apiResult.response;
        const result = apiResult.result;
        const apiDuration = Date.now() - apiStartTime;

        console.log(`[Timetable] 📡 API response received: ${apiDuration}ms`);
        console.log(`[Timetable]   - Success: ${result.success}`);
        console.log(`[Timetable]   - Status: ${response.status}`);

        // Handle session expiry
        if (!response.ok || (result.error === 'session_expired')) {
          console.error('[Timetable] Session expired or invalid');
          setError('Your session has expired. Please re-enter your password.');
          setShowPasswordModal(true);
          setLoading(false);
          return;
        }

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch data');
        }

        // Process calendar data for day order stats (do this first, before timetable processing)
        // Handle multiple formats: direct array, {success: true, data: [...]}, or {data: [...]}
        if (result.data && typeof result.data === 'object' && 'calendar' in result.data) {
          const calendarDataFromResult = (result.data as { calendar?: unknown }).calendar;
          let calendarArray: CalendarEvent[] | null = null;

          if (Array.isArray(calendarDataFromResult)) {
            // Map JSON format to CalendarEvent interface
            calendarArray = calendarDataFromResult.map((e: any) => ({
              date: e.date,
              day_name: e.day_name,
              content: e.event ?? '',
              day_order: e.day_order,
              month: e.month,
              year: e.year
            }));
            console.log('[Timetable] ✅ Calendar data processed');
            console.log('[Timetable]   - Total events:', calendarArray?.length ?? 0);
          } else if (calendarDataFromResult && typeof calendarDataFromResult === 'object') {
            const calendarObj = calendarDataFromResult as Record<string, unknown>;
            // Handle {success: true, data: [...]} format (old API format)
            if ('success' in calendarObj && calendarObj.success && 'data' in calendarObj && Array.isArray(calendarObj.data)) {
              calendarArray = calendarObj.data as CalendarEvent[];
            }
            // Handle {data: [...]} format
            else if ('data' in calendarObj && Array.isArray(calendarObj.data)) {
              calendarArray = calendarObj.data as CalendarEvent[];
            }
            // Handle nested {success: {data: [...]}} format
            else if ('success' in calendarObj && typeof calendarObj.success === 'object' && calendarObj.success !== null) {
              const successObj = calendarObj.success as { data?: CalendarEvent[] };
              if (Array.isArray(successObj.data)) {
                calendarArray = successObj.data;
              }
            }
          }

          if (calendarArray) {
            const parsedCalendar = extractCalendarEvents(calendarArray);
            if (!parsedCalendar) {
              console.warn('[Timetable] ⚠️ Calendar array parsing failed');
            } else {
              const stats = applyCalendarData(parsedCalendar, 'API response');
              // Cache day order stats in localStorage
              try {
                localStorage.setItem('sdash_dayOrderStats', JSON.stringify(stats));
              } catch (e) {
                console.warn('[Timetable] Failed to cache day order stats:', e);
              }
            }
          } else {
            console.warn('[Timetable] ⚠️ Calendar data format not recognized');
          }
        }

        // Process timetable data from unified endpoint
        // Unified endpoint returns: { success: boolean, data: { timetable: TimetableData, ... }, error?: string }
        let timetableDataObj: TimetableData | null = null;

        console.log('[Timetable] Processing timetable data from API response');
        console.log('[Timetable] result.data type:', typeof result.data);
        console.log('[Timetable] result.data keys:', result.data ? Object.keys(result.data) : 'null/undefined');

        // Extract timetable from unified response: { data: { timetable: TimetableData, ... } }
        if (result.data && typeof result.data === 'object' && 'timetable' in result.data) {
          const timetableData = (result.data as { timetable?: unknown }).timetable;

          if (timetableData && typeof timetableData === 'object' && timetableData !== null) {
            // Check if it's the new Go backend format (has schedule array)
            const dataObj = timetableData as Record<string, unknown>;
            if ('schedule' in dataObj && Array.isArray(dataObj.schedule)) {
              console.log('[Timetable] 🔄 Detected new Go backend format (schedule array) - transforming...');
              // Transform new format to old format
              timetableDataObj = transformGoBackendTimetableToOldFormat(dataObj);
              console.log('[Timetable] ✅ Transformed Go backend timetable format');
            } else {
              // Handle wrapped format: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
              let dataToProcess: unknown = timetableData;

              // Check if data is wrapped in a 'data' property (API response format from cache)
              const dataToProcessObj = dataToProcess as Record<string, unknown>;
              if ('data' in dataToProcessObj && typeof dataToProcessObj.data === 'object' && dataToProcessObj.data !== null) {
                console.log('[Timetable] 🔄 Unwrapping nested data structure (extracting from data property)');
                const wrappedData = dataToProcessObj.data as TimetableData;
                if (wrappedData && 'timetable' in wrappedData) {
                  dataToProcess = wrappedData;
                }
              }
              // Check if it's already in TimetableData format (has timetable property at root)
              else if ('timetable' in dataToProcessObj || 'time_slots' in dataToProcessObj) {
                // Already in correct format
                dataToProcess = dataToProcess;
              }

              // Verify it's the expected TimetableData format
              if (dataToProcess && typeof dataToProcess === 'object' && dataToProcess !== null) {
                const dataObj2 = dataToProcess as Record<string, unknown>;
                if ('timetable' in dataObj2 || 'time_slots' in dataObj2) {
                  timetableDataObj = dataToProcess as TimetableData;
                  console.log('[Timetable] ✅ Timetable data loaded');
                } else {
                  console.warn('[Timetable] ⚠️ Timetable data doesn\'t match expected format');
                  console.warn('[Timetable] Available keys:', Object.keys(dataObj2));
                }
              } else {
                console.warn('[Timetable] ⚠️ Timetable data doesn\'t match expected format');
                console.warn('[Timetable] dataToProcess is not an object');
              }
            }
          }
        } else {
          console.warn('[Timetable] ⚠️ result.data.timetable is not available');
          console.warn('[Timetable] result.data structure:', result.data);
        }

        if (timetableDataObj && timetableDataObj.timetable) {
          console.log('[Timetable] Timetable response data:', timetableDataObj);
          console.log('[Timetable] DO 1 time_slots sample:', timetableDataObj.timetable['DO 1']?.time_slots);

          setRawTimetableData(timetableDataObj);
          const convertedData = convertTimetableDataToTimeSlots(timetableDataObj);
          console.log('[Timetable] Converted time slots:', convertedData);

          // Save to client cache
          setClientCache('timetable', timetableDataObj);

          setTimetableData(convertedData);

          const occurrences = getSlotOccurrences(timetableDataObj);
          console.log('[Timetable] Slot occurrences:', occurrences);

          setSlotOccurrences(occurrences);
          // Cache slot occurrences in localStorage
          try {
            localStorage.setItem('sdash_slotOccurrences', JSON.stringify(occurrences));
          } catch (e) {
            console.warn('[Timetable] Failed to cache slot occurrences:', e);
          }
          console.log('[Timetable] Loaded timetable with', occurrences.length, 'courses');
        } else {
          // Keep page visible even when timetable data is unavailable
          // User can use refresh button to fetch data
          console.warn('[Timetable] Timetable data unavailable - keeping page visible for refresh');
          if (result && result.data) {
            console.warn('[Timetable] Timetable data type:', typeof result.data);
            console.warn('[Timetable] Timetable data value:', result.data);
          }
          setRawTimetableData(null);
          setTimetableData([]);
          // Don't throw error, just log it so page remains visible
        }
      } else {
        // Timetable was cached, but we still need calendar data for stats
        // Try to get calendar from unified cache or fetch it
        const cachedUnified = getClientCache('unified');
        if (cachedUnified && typeof cachedUnified === 'object' && cachedUnified !== null && 'data' in cachedUnified) {
          const unifiedData = (cachedUnified as { data?: { calendar?: unknown } }).data;
          if (unifiedData && typeof unifiedData === 'object' && 'calendar' in unifiedData) {
            const calendarDataFromCache = (unifiedData as { calendar?: unknown }).calendar;
            let calendarArray: CalendarEvent[] | null = null;

            if (Array.isArray(calendarDataFromCache)) {
              calendarArray = calendarDataFromCache;
            } else if (calendarDataFromCache && typeof calendarDataFromCache === 'object') {
              const calendarObj = calendarDataFromCache as Record<string, unknown>;
              // Handle {success: true, data: [...]} format
              if ('success' in calendarObj && calendarObj.success && 'data' in calendarObj && Array.isArray(calendarObj.data)) {
                calendarArray = calendarObj.data as CalendarEvent[];
              }
              // Handle {data: [...]} format
              else if ('data' in calendarObj && Array.isArray(calendarObj.data)) {
                calendarArray = calendarObj.data as CalendarEvent[];
              }
            }

            if (calendarArray) {
              const parsedCalendar = extractCalendarEvents(calendarArray);
              if (!parsedCalendar) {
                console.warn('[Timetable] ⚠️ Calendar parsing failed from unified cache');
              } else {
                applyCalendarData(parsedCalendar, 'unified cache');
              }
            }
          }
        } else {
          // Fetch calendar data separately if not in cache
          console.log('[Timetable] 📅 Fetching calendar data for day order stats...');
          try {
            await fetchCalendarFallback(access_token);
          } catch (calendarErr) {
            console.error('[Timetable] ❌ Error fetching calendar for stats:', calendarErr);
          }
        }
      }

      // Safety net for route-navigation edge cases:
      // if calendar is still empty after main flow, fetch it once directly.
      if (!hasResolvedCalendarInThisRun) {
        await fetchCalendarFallback(access_token);
      }

    } catch (err) {
      console.error('[Timetable] Error fetching data:', err);
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
      setIsRefreshing(false);
    }
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const handleDownloadTimetable = async () => {
    if (typeof window === 'undefined') return;

    const detailsEl = document.querySelector(
      "[data-sdash-timetable-download]"
    ) as HTMLDetailsElement | null;
    const wasDetailsOpen = detailsEl?.open ?? false;

    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      // Grid lives inside <details>; open it so layout paints for capture
      if (detailsEl) {
        detailsEl.open = true;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      // Find the timetable grid element
      const tableElement = document.querySelector('.timetable-grid') as HTMLElement;
      if (!tableElement) {
        console.error('Timetable table not found');
        return;
      }

      // Create canvas from the table
      const canvas = await html2canvas(tableElement, {
        backgroundColor: '#000000',
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
      });

      // Convert to JPG blob
      canvas.toBlob((blob: Blob | null) => {
        if (blob) {
          // Create download link
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'sdash-timetable.jpg';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }, 'image/jpeg', 0.95);
    } catch (error) {
      console.error('Error downloading timetable:', error);
    } finally {
      if (detailsEl && !wasDetailsOpen) {
        detailsEl.open = false;
      }
    }
  };

  // Transform new Go backend format to old format
  const transformGoBackendTimetableToOldFormat = (goData: Record<string, unknown>): TimetableData => {
    const timeSlots = [
      "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
      "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
    ];

    const schedule = goData.schedule as Array<{ day: number; table: Array<unknown> }> | undefined;
    if (!schedule || !Array.isArray(schedule)) {
      console.warn('[Timetable] Invalid schedule format');
      return {
        metadata: {
          generated_at: new Date().toISOString(),
          source: 'go_backend',
          academic_year: '',
          format: 'go_backend'
        },
        time_slots: timeSlots,
        slot_mapping: {},
        timetable: {}
      };
    }

    const timetable: Record<string, TimetableDayOrder> = {};
    const slotMapping: Record<string, string> = {};

    // Map day numbers (1-5) to DO names
    const dayToDO: Record<number, string> = {
      1: 'DO 1',
      2: 'DO 2',
      3: 'DO 3',
      4: 'DO 4',
      5: 'DO 5'
    };

    schedule.forEach((daySchedule) => {
      const doName = dayToDO[daySchedule.day];
      if (!doName) return;

      const timeSlotsMap: Record<string, { slot_code: string; course_title: string; slot_type: string; is_alternate: boolean; courseType?: string; online?: boolean }> = {};

      daySchedule.table.forEach((entry, index) => {
        if (entry && typeof entry === 'object' && entry !== null) {
          const course = entry as { code?: string; name?: string; slot?: string; courseType?: string; slotType?: string; online?: boolean };
          if (course.code && course.name && course.slot) {
            const timeSlot = timeSlots[index] || `Slot ${index + 1}`;
            const slotCode = course.slot;
            const courseTitle = course.name;
            const courseType = course.courseType || 'Theory';
            const slotType = course.slotType || (courseType === 'Practical' ? 'Lab' : 'Theory');

            timeSlotsMap[timeSlot] = {
              slot_code: slotCode,
              course_title: courseTitle,
              slot_type: slotType,
              is_alternate: false,
              courseType: courseType,
              online: course.online || false
            };

            // Build slot mapping
            if (!slotMapping[slotCode]) {
              slotMapping[slotCode] = courseTitle;
            }
          }
        }
      });

      if (Object.keys(timeSlotsMap).length > 0) {
        timetable[doName] = {
          do_name: doName,
          time_slots: timeSlotsMap
        };
      }
    });

    return {
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'go_backend',
        academic_year: '',
        format: 'go_backend'
      },
      time_slots: timeSlots,
      slot_mapping: slotMapping,
      timetable
    };
  };

  interface TimetableDayOrder {
    do_name: string;
    time_slots: {
      [timeSlot: string]: {
        slot_code: string;
        course_title: string;
        slot_type: string;
        is_alternate: boolean;
        courseType?: string;
        online?: boolean;
      };
    };
  }

  const slotTimeToMinutes = useCallback((timeStr: string): number | null => {
    const [h, m] = timeStr.split(":");
    const hours = Number(h);
    const minutes = Number(m);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    // Portal time uses 12-hour-ish slots; the original project converts hours < 8 to PM.
    const normalizedHours = hours < 8 && hours !== 0 ? hours + 12 : hours;
    return normalizedHours * 60 + minutes;
  }, []);

  const parseSlotRangeToMinutes = useCallback((range: string): { start: number; end: number } | null => {
    const [startStr, endStr] = range.split("-");
    if (!startStr || !endStr) return null;
    const start = slotTimeToMinutes(startStr.trim());
    const end = slotTimeToMinutes(endStr.trim());
    if (start == null || end == null) return null;
    return { start, end };
  }, [slotTimeToMinutes]);

  /**
   * Single source for the timetable object the UI should render: live edit merge, post-save session snapshot, or cache.
   */
  const displayRawTimetableData = useMemo((): TimetableData | null => {
    if (!rawTimetableData) {
      return null;
    }
    if (timetableEditMode && pendingModificationDoc) {
      return applyModificationPreviewToTimetableData(rawTimetableData, pendingModificationDoc);
    }
    if (sessionSavedTimetableOverride) {
      return sessionSavedTimetableOverride;
    }
    return rawTimetableData;
  }, [rawTimetableData, timetableEditMode, pendingModificationDoc, sessionSavedTimetableOverride]);

  /** Slot grid rows from displayRawTimetableData (includes session-only merged view after Save). */
  const timetableSlotsForDisplay = useMemo(() => {
    if (!displayRawTimetableData) {
      return timetableData;
    }
    return convertTimetableDataToTimeSlots(displayRawTimetableData);
  }, [displayRawTimetableData, timetableData]);

  const slotsForActiveDo = useMemo(() => {
    if (!timetableSlotsForDisplay.length) {
      return [];
    }
    const dayIndex = TIMETABLE_DAY_LABELS.indexOf(
      activeDayOrder as (typeof TIMETABLE_DAY_LABELS)[number]
    );
    if (dayIndex < 0) {
      return [];
    }
    const dayKey = TIMETABLE_DAY_KEYS[dayIndex];
    return timetableSlotsForDisplay.map((slot) => {
      const cellData = slot[dayKey];
      const isObject = typeof cellData === "object" && cellData !== null;
      const courseName = isObject
        ? (cellData as TimeSlotCell).course
        : (cellData as string) || "";

      let slotType = "";
      let slotCode = "";
      const dayOrderData = displayRawTimetableData?.timetable?.[activeDayOrder];
      const ts = dayOrderData?.time_slots?.[slot.time];
      if (ts) {
        slotType = ts.slot_type || "";
        slotCode = ts.slot_code || "";
      }

      const typeLower = slotType.toLowerCase();
      const badgeType: "theory" | "lab" | null =
        !courseName
          ? null
          : typeLower.includes("lab") || typeLower.includes("practical")
            ? "lab"
            : "theory";

      const minutes = parseSlotRangeToMinutes(slot.time);
      return {
        timeKey: slot.time,
        timeLabel: slot.time.replace(/-/g, " – "),
        subject: courseName.trim() || null,
        code: slotCode,
        type: badgeType,
        slotStartMinutes: minutes?.start ?? null,
        slotEndMinutes: minutes?.end ?? null,
      };
    });
  }, [timetableSlotsForDisplay, displayRawTimetableData, activeDayOrder, parseSlotRangeToMinutes]);

  /**
   * Quick stats: recomputed when the visible grid is a preview (editing) or post-save session merge.
   */
  const slotOccurrencesForUi = useMemo(() => {
    if (!displayRawTimetableData) {
      return slotOccurrences;
    }
    const useComputedOccurrences =
      sessionSavedTimetableOverride != null ||
      (timetableEditMode && pendingModificationDoc != null);
    if (useComputedOccurrences) {
      return getSlotOccurrences(displayRawTimetableData);
    }
    return slotOccurrences;
  }, [
    displayRawTimetableData,
    sessionSavedTimetableOverride,
    timetableEditMode,
    pendingModificationDoc,
    slotOccurrences,
  ]);

  useEffect(() => {
    if (!courseMenuOpen && !kindMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (courseMenuRef.current && !courseMenuRef.current.contains(t)) {
        setCourseMenuOpen(false);
      }
      if (kindMenuRef.current && !kindMenuRef.current.contains(t)) {
        setKindMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [courseMenuOpen, kindMenuOpen]);

  const parseModificationDoc = useCallback((raw: unknown): TimetableModificationDoc | null => {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const o = raw as TimetableModificationDoc;
    if (typeof o.batch !== "string" || typeof o.regNumber !== "string" || !Array.isArray(o.schedule)) {
      return null;
    }
    return o;
  }, []);

  /** Header "Edit": load courses + existing DB patch once, then show pencils on each row. */
  const startTimetableEditMode = useCallback(async () => {
    const access_token = getStorageItem("access_token");
    if (!access_token) {
      setError("Please sign in to edit your timetable");
      return;
    }
    setEditorContextLoading(true);
    setError(null);
    try {
      const response = await trackPostRequest("/api/timetable/modification", {
        action: "timetable_modification_load",
        dataType: "timetable",
        payload: { access_token, action: "load" },
        omitPayloadKeys: ["access_token"],
      });
      const data = (await response.json()) as {
        success?: boolean;
        modified_json?: unknown;
        has_modification_record?: boolean;
        batch?: string;
        regNumber?: string;
        courseTitles?: string[];
        courseItems?: Array<{ title: string; code: string }>;
      };
      if (!response.ok || !data.success) {
        console.error("[Timetable] modification load failed", data);
        setError("Could not load timetable editor");
        return;
      }
      // if (typeof data.has_modification_record === "boolean") {
      //   setHasModificationRecordInDb(data.has_modification_record);
      // }
      setEditorBatch(data.batch ?? "2");
      setEditorRegNumber(data.regNumber ?? "");
      setCourseTitleOptions(data.courseTitles ?? []);
      setCourseItems(data.courseItems ?? []);
      setPendingModificationDoc(
        parseModificationDoc(data.modified_json) ?? {
          batch: data.batch ?? "2",
          regNumber: data.regNumber ?? "",
          schedule: [],
        }
      );
      setEditorContextLoaded(true);
      setTimetableEditMode(true);
    } catch (e) {
      console.error("[Timetable] modification load error", e);
      setError("Could not load timetable editor");
    } finally {
      setEditorContextLoading(false);
    }
  }, [parseModificationDoc]);

  /** Header "Cancel": discard session preview (no API). */
  const cancelTimetableEditMode = useCallback(() => {
    setTimetableEditMode(false);
    setPendingModificationDoc(null);
    setEditorContextLoaded(false);
    setEditModalOpen(false);
    setEditTarget(null);
  }, []);

  /** Header "Save": upsert patch, then timetable refresh so Go backend merges into user_cache. */
  const commitGlobalTimetableSave = useCallback(async () => {
    if (!pendingModificationDoc) {
      return;
    }
    const access_token = getStorageItem("access_token");
    if (!access_token) {
      setError("Please sign in to save");
      return;
    }
    const pruned = pruneModificationDoc(pendingModificationDoc);
    // Immediate session-only merged grid (same semantics as applyModificationPreviewToTimetableData); survives API/cache lag.
    if (rawTimetableData) {
      setSessionSavedTimetableOverride(applyModificationPreviewToTimetableData(rawTimetableData, pruned));
    }
    setTimetableEditMode(false);
    setPendingModificationDoc(null);
    setEditorContextLoaded(false);
    setEditModalOpen(false);
    setEditTarget(null);

    if (postSaveCacheRebuildTimeoutRef.current != null) {
      clearTimeout(postSaveCacheRebuildTimeoutRef.current);
      postSaveCacheRebuildTimeoutRef.current = null;
    }

    setSavingGlobalModification(true);
    setError(null);
    try {
      const response = await trackPostRequest("/api/timetable/modification", {
        action: "timetable_modification_save",
        dataType: "timetable",
        payload: { access_token, action: "save", modified_json: pruned },
        omitPayloadKeys: ["access_token"],
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Save failed");
      }
      // setHasModificationRecordInDb(true); // hint disabled
    } catch (e) {
      console.error("[Timetable] global save", e);
      setError(e instanceof Error ? e.message : "Failed to save timetable");
    } finally {
      setSavingGlobalModification(false);
    }

    // Rebuild client cache + raw state from user_cache after worker merge; keep optimistic UI until then.
    postSaveCacheRebuildTimeoutRef.current = setTimeout(() => {
      postSaveCacheRebuildTimeoutRef.current = null;
      void refreshTimetableData({ afterModificationSave: true, silent: true });
    }, 5000);
  }, [pendingModificationDoc, rawTimetableData, refreshTimetableData]);

  const openEditModal = useCallback(
    (row: (typeof slotsForActiveDo)[number]) => {
      if (!editorContextLoaded || !timetableEditMode) {
        return;
      }
      const timeOrder = rawTimetableData?.time_slots?.length
        ? rawTimetableData.time_slots
        : [...DEFAULT_TIME_SLOT_ORDER];
      const slotIndex = timeOrder.indexOf(row.timeKey);
      if (slotIndex < 0) {
        console.warn("[Timetable] Could not resolve slot index for", row.timeKey);
        return;
      }
      const dayNumber =
        TIMETABLE_DAY_LABELS.indexOf(activeDayOrder as (typeof TIMETABLE_DAY_LABELS)[number]) + 1;
      if (dayNumber < 1) {
        return;
      }
      setEditTarget({
        timeKey: row.timeKey,
        slotIndex,
        dayNumber,
        subject: row.subject,
        badgeType: row.type,
      });
      setEditCourseTitle(row.subject ?? "");
      setEditKind(row.type === "lab" ? "lab" : "theory");
      setEditCourseTitleMode("pick");
      setNewCourseTitleInput("");
      setCourseMenuOpen(false);
      setKindMenuOpen(false);
      setEditModalOpen(true);
    },
    [activeDayOrder, editorContextLoaded, rawTimetableData?.time_slots, timetableEditMode]
  );

  const applyLocalAddFromModal = useCallback(() => {
    if (!editTarget) {
      return;
    }
    const title =
      editCourseTitleMode === "new" ? newCourseTitleInput.trim() : editCourseTitle.trim();
    if (!title) {
      setError("Choose or enter a course title");
      return;
    }
    setError(null);
    const slotLetter = getSlotLetterForGrid(editorBatch, editTarget.dayNumber, editTarget.slotIndex);
    const isLab = editKind === "lab";
    const found = courseItems.find((c) => c.title.toLowerCase() === title.toLowerCase());
    const code = found?.code ?? `CUSTOM${Math.floor(100 + Math.random() * 900)}`;
    const cell: TimetableModCell = {
      __type: "ADD",
      data: {
        code,
        name: title,
        slot: slotLetter,
        online: false,
        roomNo: "N/A",
        slotType: isLab ? "Lab" : "Theory",
        courseType: isLab ? "Practical" : "Theory",
        isOptional: true,
      },
    };
    const base: TimetableModificationDoc =
      pendingModificationDoc ?? {
        batch: editorBatch,
        regNumber: editorRegNumber,
        schedule: [],
      };
    const merged = mergeCellIntoDoc(
      base,
      editTarget.dayNumber,
      editTarget.slotIndex,
      cell,
      editorBatch,
      editorRegNumber
    );
    setPendingModificationDoc(pruneModificationDoc(merged));
    setEditModalOpen(false);
    setEditTarget(null);
  }, [
    courseItems,
    editCourseTitle,
    editCourseTitleMode,
    editKind,
    editTarget,
    editorBatch,
    editorRegNumber,
    newCourseTitleInput,
    pendingModificationDoc,
  ]);

  const applyLocalRemoveSlot = useCallback(() => {
    if (!editTarget) {
      return;
    }
    setError(null);
    const cell: TimetableModCell = { __type: "REMOVE" };
    const base: TimetableModificationDoc =
      pendingModificationDoc ?? {
        batch: editorBatch,
        regNumber: editorRegNumber,
        schedule: [],
      };
    const merged = mergeCellIntoDoc(
      base,
      editTarget.dayNumber,
      editTarget.slotIndex,
      cell,
      editorBatch,
      editorRegNumber
    );
    setPendingModificationDoc(pruneModificationDoc(merged));
    setEditModalOpen(false);
    setEditTarget(null);
  }, [editTarget, editorBatch, editorRegNumber, pendingModificationDoc]);

  const applyLocalClearOverride = useCallback(() => {
    if (!editTarget) {
      return;
    }
    setError(null);
    const base: TimetableModificationDoc =
      pendingModificationDoc ?? {
        batch: editorBatch,
        regNumber: editorRegNumber,
        schedule: [],
      };
    const merged = mergeCellIntoDoc(
      base,
      editTarget.dayNumber,
      editTarget.slotIndex,
      null,
      editorBatch,
      editorRegNumber
    );
    setPendingModificationDoc(pruneModificationDoc(merged));
    setEditModalOpen(false);
    setEditTarget(null);
  }, [editTarget, editorBatch, editorRegNumber, pendingModificationDoc]);

  const patchCellAtEdit = useMemo(() => {
    if (!editTarget || !pendingModificationDoc) {
      return null;
    }
    const d = pendingModificationDoc.schedule.find((x) => x.day === editTarget.dayNumber);
    if (!d?.table || editTarget.slotIndex >= d.table.length) {
      return null;
    }
    return d.table[editTarget.slotIndex] ?? null;
  }, [editTarget, pendingModificationDoc]);

  const nowMinutes = now
    ? now.getHours() * 60 + now.getMinutes()
    : null;
  const shouldDepleteMeter =
    Boolean(mounted && todayDayOrderLabel && activeDayOrder === todayDayOrderLabel && nowMinutes != null);

  const timetableDownloadButton = (
    <button
      type="button"
      onClick={() => void handleDownloadTimetable()}
      className="touch-target text-sdash-text-secondary"
      aria-label="Download timetable as image"
      title="Download timetable as image"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="w-[18px] h-[18px]"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </button>
  );

  if (loading) {
    return <TimetablePageSkeleton />;
  }

  // Show empty state if no timetable data but no error (allows refresh button to work)
  if (!rawTimetableData || !timetableData || timetableData.length === 0) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
        <TopAppBar
          title="Timetable"
          showBack
          onRefresh={() => void refreshTimetableData()}
          isRefreshing={loading || isRefreshing}
          rightAction={timetableDownloadButton}
        />
        <main className="flex flex-col flex-1 items-center justify-center gap-6 px-4 py-8">
          <div className="w-full max-w-xl rounded-[12px] border border-white/[0.08] bg-white/[0.05] p-8 text-center font-sora">
            {/* Empty state: no slot list — only download in header */}
            <div className="text-sdash-text-primary text-base sm:text-lg">
              No timetable data available
            </div>
            <div className="text-sdash-text-secondary text-sm mt-3">
              Use the refresh control in the header to fetch timetable data
            </div>
          </div>
        </main>
        <PillNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-x-hidden">
      <TopAppBar
        title="Timetable"
        showBack
        onRefresh={() => void refreshTimetableData()}
        isRefreshing={loading || isRefreshing}
        rightAction={timetableDownloadButton}
      />

      <main className="w-full max-w-lg mx-auto flex flex-col gap-6 px-4 pt-4 pb-2">
        {/* Post-save: merged grid is session-only; disappears on full page reload */}

        {/* DO 1–5 tabs, then Save/Cancel (edit) or Edit — then slot cards */}
        <div className="flex flex-col gap-3 -mx-4 px-4">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {TIMETABLE_DAY_LABELS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setHasUserSelectedDayOrder(true);
                  setActiveDayOrder(d);
                }}
                className={`shrink-0 rounded-[6px] px-2 py-0 text-md font-sora font-medium transition-colors h-7 min-h-0 leading-none !touch-manipulation ${
                  activeDayOrder === d
                    ? "bg-sdash-accent text-sdash-text-primary"
                    : "bg-sdash-surface-1 border border-white/[0.08] text-sdash-text-secondary"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {timetableEditMode ? (
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => void commitGlobalTimetableSave()}
                disabled={savingGlobalModification || !editorContextLoaded}
                className="touch-target flex min-h-[40px] min-w-0 flex-1 basis-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-sora font-medium text-sdash-accent/90 transition-colors hover:bg-white/[0.07] disabled:opacity-40"
                title="Save edits and refresh timetable from server"
              >
                {savingGlobalModification ? "…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelTimetableEditMode}
                disabled={savingGlobalModification}
                className="touch-target flex min-h-[40px] min-w-0 flex-1 basis-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] font-sora font-medium text-sdash-text-secondary transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                title="Discard local edits"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex w-full justify-end">
              <button
                type="button"
                onClick={() => void startTimetableEditMode()}
                disabled={editorContextLoading || savingGlobalModification}
                className="touch-target inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-[12px] font-sora font-medium text-sdash-text-secondary transition-colors hover:bg-white/[0.09] hover:text-sdash-text-primary disabled:opacity-40"
                title="Edit timetable (session preview until you save)"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2} />
                {editorContextLoading ? "…" : "Edit"}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {slotsForActiveDo.map((row) => {
            let remainingFraction = 1;
            if (
              shouldDepleteMeter &&
              nowMinutes != null &&
              row.slotStartMinutes != null &&
              row.slotEndMinutes != null &&
              row.slotEndMinutes > row.slotStartMinutes
            ) {
              remainingFraction =
                nowMinutes <= row.slotStartMinutes
                  ? 1
                  : nowMinutes >= row.slotEndMinutes
                    ? 0
                    : (row.slotEndMinutes - nowMinutes) /
                      (row.slotEndMinutes - row.slotStartMinutes);
            }

            const remainingPct = Math.max(0, Math.min(1, remainingFraction)) * 100;

            return (
              <GlassCard
                key={row.timeKey}
                subjectCategory={
                  row.type === "lab" ? "Lab" : row.type === "theory" ? "Theory" : undefined
                }
                className={`p-4 ${
                  row.subject ? "flex flex-col gap-2" : "border border-dashed border-white/20 !rounded-[12px]"
                }`}
              >
                {/* Day depletion meter (green): shrinks as time goes on */}
                <div className="absolute left-0 top-0 bottom-0 w-[3px]">
                  <div
                    className="absolute left-0 bottom-0 w-[3px] bg-sdash-success rounded-r-full transition-[height] duration-500 ease-linear"
                    style={{ height: `${remainingPct}%` }}
                  />
                </div>

                {row.subject ? (
                  <>
                    {/* Row 1: time (left) | theory/lab label + pencil-only edit (right) */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-geist-mono text-sm text-sdash-text-secondary">
                        {row.timeLabel}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {row.type ? (
                          <span className="text-[11px] font-sora text-sdash-text-muted capitalize">
                            {row.type}
                          </span>
                        ) : null}
                        {timetableEditMode && editorContextLoaded ? (
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="touch-target p-0.5 text-sdash-text-secondary hover:text-sdash-text-primary"
                            aria-label="Edit this timetable slot"
                            title="Edit slot"
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {/* Row 2: course title */}
                    <p className="font-sora font-semibold text-base text-sdash-text-primary leading-snug">
                      {row.subject}
                    </p>
                    {row.code ? (
                      <p className="text-xs text-sdash-text-muted font-sora uppercase tracking-wider">
                        {row.code}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* Free slot: time left | "No class" + optional pencil on the right */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-geist-mono text-sm text-sdash-text-secondary">
                        {row.timeLabel}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm text-sdash-text-muted font-sora">No class</span>
                        {timetableEditMode && editorContextLoaded ? (
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="touch-target p-0.5 text-sdash-text-secondary hover:text-sdash-text-primary"
                            aria-label="Edit this timetable slot"
                            title="Add or edit slot"
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </GlassCard>
            );
          })}
        </div>

        {/* Quick stats (sdash tokens) */}
        <GlassCard className="p-4 sm:p-5">
          <p className="font-sora font-semibold text-base text-sdash-text-primary text-center mb-4">Quick stats</p>

          {dayOrderStats ? (
            <div className="mb-6">
              <p className="section-label mb-3">Day order distribution</p>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1">
                {[1, 2, 3, 4, 5].map((doNumber) => (
                  <StatChip key={doNumber}>
                    <span className="stat-number text-[13px] text-sdash-text-primary">
                      {dayOrderStats[doNumber] ?? 0}
                    </span>
                    <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">DO {doNumber}</span>
                  </StatChip>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="section-label mb-3">Subject schedule</p>
            <div className="flex flex-col gap-3">
              {slotOccurrencesForUi.map((occurrence, index) => (
                <GlassCard
                  key={index}
                  subjectCategory={occurrence.category}
                  className="p-3 border border-white/[0.06]"
                >
                  <p className="font-sora font-semibold text-sm text-sdash-text-primary">{occurrence.courseTitle}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[11px] text-sdash-text-secondary font-sora">{occurrence.category}</span>
                    <span className="text-[11px] text-sdash-text-muted font-sora">Slots: {occurrence.slot}</span>
                  </div>
                  <p className="text-[11px] text-sdash-text-secondary font-sora mt-2 leading-relaxed">
                    Day orders:{" "}
                    {occurrence.dayOrders
                      .sort()
                      .map((doNum: number) => `DO${doNum}(${occurrence.dayOrderHours[doNum]})`)
                      .join(", ")}
                  </p>
                  <p className="text-[11px] text-sdash-text-muted font-sora mt-1">
                    Total sessions: {occurrence.totalOccurrences}
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </GlassCard>
      </main>

      <PillNav />

      {/* Slot modal: applies changes to pendingModificationDoc only; header Save persists to DB + backend */}
      {editModalOpen && editTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-[12px] border border-white/[0.08] bg-sdash-surface-1 p-5 font-sora shadow-xl"
          >
            <h2 className="text-lg font-semibold text-sdash-text-primary mb-1">Edit slot</h2>
            <p className="text-[12px] text-sdash-text-muted mb-4">
              {activeDayOrder} · {editTarget.timeKey.replace(/-/g, " – ")}
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[11px] text-sdash-text-secondary mb-1.5">Course title</p>
                <div className="relative" ref={courseMenuRef}>
                  <button
                    type="button"
                    onClick={() => setCourseMenuOpen((o) => !o)}
                    className="inline-flex h-9 w-full items-center justify-between rounded-[8px] border border-white/[0.12] bg-sdash-surface-1 px-3 text-left text-[12px] text-sdash-text-secondary"
                    aria-expanded={courseMenuOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="truncate">
                      {editCourseTitleMode === "new" ? "New course…" : editCourseTitle || "Select course"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
                  </button>
                  {courseMenuOpen ? (
                    <div
                      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/40 py-1 backdrop-blur-md shadow-lg"
                      role="listbox"
                    >
                      <button
                        type="button"
                        role="option"
                        onClick={() => {
                          setEditCourseTitleMode("new");
                          setCourseMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06]"
                      >
                        <span className="inline-flex w-3.5 shrink-0 justify-center">
                          {editCourseTitleMode === "new" ? (
                            <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
                          ) : null}
                        </span>
                        New course title…
                      </button>
                      {courseTitleOptions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="option"
                          onClick={() => {
                            setEditCourseTitleMode("pick");
                            setEditCourseTitle(t);
                            setCourseMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06]"
                        >
                          <span className="inline-flex w-3.5 shrink-0 justify-center">
                            {editCourseTitleMode === "pick" && editCourseTitle === t ? (
                              <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
                            ) : null}
                          </span>
                          <span className="truncate">{t}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {editCourseTitleMode === "new" ? (
                  <input
                    type="text"
                    value={newCourseTitleInput}
                    onChange={(e) => setNewCourseTitleInput(e.target.value)}
                    placeholder="Enter new course title"
                    className="mt-2 w-full rounded-[8px] border border-white/[0.12] bg-black/20 px-3 py-2 text-[12px] text-sdash-text-primary placeholder:text-sdash-text-muted"
                  />
                ) : null}
              </div>

              <div>
                <p className="text-[11px] text-sdash-text-secondary mb-1.5">Theory / Lab</p>
                <div className="relative" ref={kindMenuRef}>
                  <button
                    type="button"
                    onClick={() => setKindMenuOpen((o) => !o)}
                    className="inline-flex h-9 w-full items-center justify-between rounded-[8px] border border-white/[0.12] bg-sdash-surface-1 px-3 text-left text-[12px] text-sdash-text-secondary capitalize"
                    aria-expanded={kindMenuOpen}
                    aria-haspopup="listbox"
                  >
                    {editKind}
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
                  </button>
                  {kindMenuOpen ? (
                    <div
                      className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-white/[0.08] bg-black/40 py-1 backdrop-blur-md shadow-lg"
                      role="listbox"
                    >
                      {(["theory", "lab"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="option"
                          onClick={() => {
                            setEditKind(k);
                            setKindMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06] capitalize"
                        >
                          <span className="inline-flex w-3.5 shrink-0 justify-center">
                            {editKind === k ? (
                              <Check className="h-3 w-3 text-sdash-text-muted" strokeWidth={2.5} />
                            ) : null}
                          </span>
                          {k}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => applyLocalAddFromModal()}
                className="w-full rounded-full bg-sdash-accent py-2.5 text-sm font-medium text-sdash-text-primary touch-target"
              >
                Apply
              </button>
              {editTarget.subject ? (
                <button
                  type="button"
                  onClick={() => applyLocalRemoveSlot()}
                  className="w-full rounded-full border border-white/[0.12] py-2.5 text-sm font-medium text-sdash-text-secondary touch-target"
                >
                  Mark slot empty
                </button>
              ) : null}
              {patchCellAtEdit ? (
                <button
                  type="button"
                  onClick={() => applyLocalClearOverride()}
                  className="w-full rounded-full border border-white/[0.12] py-2.5 text-sm font-medium text-sdash-text-secondary touch-target"
                >
                  Clear override (use portal default)
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEditModalOpen(false);
                  setEditTarget(null);
                }}
                className="w-full py-2 text-sm text-sdash-text-muted touch-target"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-sdash-surface-1 border border-white/[0.08] rounded-[12px] p-8 max-w-md w-full mx-4">
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
