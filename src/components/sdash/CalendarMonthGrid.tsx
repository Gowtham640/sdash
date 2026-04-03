"use client";

import React, { useMemo } from "react";

/** Portal calendar row shape (matches calendar page + attendance cache). */
export interface CalendarMonthGridEvent {
  date: string;
  day_name?: string;
  content?: string;
  day_order?: string;
  month?: string;
  month_name?: string;
  year?: number;
}

/** Shared with modals for sorting event lists. */
export const parseDdMmYyyy = (dateStr: string): Date | null => {
  const parts = dateStr.split("/").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return null;
  }
  const [day, month, year] = parts;
  return new Date(year, month - 1, day);
};

const isHolidayEvent = (event: CalendarMonthGridEvent): boolean =>
  event.day_order === "-" ||
  event.day_order === "DO -" ||
  event.day_order === "Holiday" ||
  Boolean(event.content && event.content.toLowerCase().includes("holiday"));

/** Prefer a row with valid DO 1–5 when multiple rows share the same date (matches calendar page intent). */
function primaryEventForDate(dayEvents: CalendarMonthGridEvent[]): CalendarMonthGridEvent | undefined {
  if (dayEvents.length === 0) {
    return undefined;
  }
  const withValidDo = dayEvents.find((e) => {
    const trimmed = e.day_order?.trim() ?? "";
    const n = Number(trimmed);
    return (
      !isHolidayEvent(e) &&
      trimmed !== "" &&
      !Number.isNaN(n) &&
      n >= 1 &&
      n <= 5
    );
  });
  return withValidDo ?? dayEvents[0];
}

const startOfLocalDay = (d: Date): number => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const dateStrFromLocal = (d: Date): string => {
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const y = d.getFullYear();
  return `${dd}/${mm}/${y}`;
};

export interface CalendarMonthGridProps {
  /** Sorted ascending by date (same as calendar list view). */
  sortedEvents: CalendarMonthGridEvent[];
  viewMonth: Date;
  onViewMonthChange: (next: Date) => void;
  /** DD/MM/YYYY for today highlight */
  todayDateStr: string;
  /** Optional range highlight (inclusive, local midnight comparison). */
  selectedRange?: { from?: Date; to?: Date };
  /** When provided, day cells become buttons (range picker mode). */
  onDayClick?: (day: Date, dateStr: string) => void;
  className?: string;
}

/**
 * Month grid from the Calendar page — shared with attendance prediction / ODML modals.
 */
export function CalendarMonthGrid({
  sortedEvents,
  viewMonth,
  onViewMonthChange,
  todayDateStr,
  selectedRange,
  onDayClick,
  className = "",
}: CalendarMonthGridProps) {
  const rangeBounds = useMemo(() => {
    if (!selectedRange?.from) {
      return null;
    }
    const fromT = startOfLocalDay(selectedRange.from);
    const toD = selectedRange.to ?? selectedRange.from;
    const toT = startOfLocalDay(toD);
    const lo = Math.min(fromT, toT);
    const hi = Math.max(fromT, toT);
    return { lo, hi };
  }, [selectedRange]);

  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < startPad; i++) {
    cells.push(<div key={`pad-${i}`} className="aspect-square" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(y, m, day);
    const dateStr = dateStrFromLocal(cellDate);
    const dayEvents = sortedEvents.filter((e) => e.date === dateStr);
    const isToday = dateStr === todayDateStr;
    const primary = primaryEventForDate(dayEvents);
    const isHolidayLike =
      primary &&
      (primary.day_order === "-" ||
        primary.day_order === "DO -" ||
        primary.day_order === "Holiday" ||
        (primary.content && primary.content.toLowerCase().includes("holiday")));
    const trimmedDo = primary?.day_order?.trim() ?? "";
    const doNum = Number(trimmedDo);
    const hasValidDayOrder =
      primary &&
      trimmedDo !== "" &&
      !isHolidayLike &&
      !Number.isNaN(doNum) &&
      doNum >= 1 &&
      doNum <= 5;

    const t = startOfLocalDay(cellDate);
    const inRange =
      rangeBounds && t >= rangeBounds.lo && t <= rangeBounds.hi;
    const isRangeStart = selectedRange?.from && t === startOfLocalDay(selectedRange.from);
    const isRangeEnd =
      selectedRange?.to && t === startOfLocalDay(selectedRange.to);
      const isSingleSelected =
      selectedRange?.from &&
      selectedRange?.to &&
      startOfLocalDay(selectedRange.from) === startOfLocalDay(selectedRange.to) &&
      t === startOfLocalDay(selectedRange.from);

      const baseCell = `aspect-square rounded-[8px] border text-lg font-sora flex flex-col items-center justify-start p-1 gap-0.5 overflow-hidden border-white/[0.06] text-sdash-text-primary`;
      let stateClass = "";

      // 1. TODAY (lowest priority visually)
      if (isToday) {
        stateClass += " bg-green-600/10 border-green-700 text-black";
      }
      
      // 2. RANGE (middle)
      if (inRange) {
        stateClass += " bg-white/10 border border-green-700 text-white";
      }
      
      // 3. START / END / SINGLE (highest priority)
      if (isRangeStart || isRangeEnd || isSingleSelected) {
        stateClass += " bg-white text-black font-bold";
      }

    const inner = (
      <>
        <span className="font-semibold">{day}</span>
        {dayEvents.length > 0 && hasValidDayOrder ? (
          <span
            className={`text-xs font-sora font-bold -mt-2 ${
              isToday ? "text-sdash-accent" : "text-sdash-accent/50"
            }`}
          >
            DO-{primary.day_order}
          </span>
        ) : dayEvents.length > 0 ? (
          <span className="text-xs font-sora font-bold text-sdash-danger -mt-2">HD</span>
        ) : null}
      </>
    );

    if (onDayClick) {
      cells.push(
        <button
          key={dateStr}
          type="button"
          data-date={dateStr}
          onClick={() => onDayClick(cellDate, dateStr)}
          className={`${baseCell} ${stateClass}`}
        >
          {inner}
        </button>
      );
    } else {
      cells.push(
        <div key={dateStr} data-date={dateStr} className={`${baseCell} ${stateClass}`}>
          {inner}
        </div>
      );
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-[8px] border border-white/[0.08] px-2 py-2 text-md font-sora text-sdash-text-secondary min-h-0 h-auto"
          style={{ lineHeight: 1.1 }}
          onClick={() => onViewMonthChange(new Date(y, m - 1, 1))}
        >
          Prev
        </button>
        <span className="text-2xl font-sora font-semibold text-sdash-text-primary">
          {viewMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          className="rounded-[8px] border border-white/[0.08] px-2 py-2 text-md font-sora text-sdash-text-secondary min-h-0 h-auto"
          style={{ lineHeight: 1.1 }}
          onClick={() => onViewMonthChange(new Date(y, m + 1, 1))}
        >
          Next
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm font-sora text-sdash-text-secondary uppercase tracking-wider">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">{cells}</div>
    </div>
  );
}
