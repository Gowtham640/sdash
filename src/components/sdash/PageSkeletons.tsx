'use client';

import PillNav from '@/components/sdash/PillNav';
import TopAppBar from '@/components/sdash/TopAppBar';
import { SkeletonLoader } from '@/components/ui/loading';

/**
 * Worst-case loading: no persistent cache — mirrors page layout without blocking the whole viewport with a spinner.
 */

export function MarksPageSkeleton() {
  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-hidden">
      <TopAppBar title="Marks" showBack />
      <main className="px-4 pt-3 w-full max-w-lg mx-auto flex flex-col gap-4 flex-1">
        <div className="flex gap-3 overflow-x-auto">
          <SkeletonLoader className="h-9 w-24 shrink-0 rounded-full" />
          <SkeletonLoader className="h-9 w-28 shrink-0 rounded-full" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={`marks-skel-${i}`}
            className="rounded-[20px] border border-white/[0.08] bg-sdash-surface-1/40 p-4 flex flex-col gap-3"
          >
            <SkeletonLoader className="h-5 w-3/4 rounded-md" />
            <SkeletonLoader className="h-3 w-1/2 rounded-md" />
            <div className="flex flex-col gap-2 pt-2">
              <SkeletonLoader className="h-3 w-full rounded" />
              <SkeletonLoader className="h-3 w-full rounded" />
              <SkeletonLoader className="h-3 w-4/5 rounded" />
            </div>
          </div>
        ))}
      </main>
      <PillNav />
    </div>
  );
}

export function AttendancePageSkeleton() {
  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-hidden">
      <TopAppBar title="Attendance" showBack />
      <main className="px-4 pt-3 w-full max-w-lg mx-auto flex flex-col gap-4 flex-1">
        <div className="flex gap-3 overflow-x-auto">
          <SkeletonLoader className="h-9 w-24 shrink-0 rounded-full" />
          <SkeletonLoader className="h-9 w-28 shrink-0 rounded-full" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={`att-skel-${i}`}
            className="rounded-[20px] border border-white/[0.08] bg-sdash-surface-1/40 p-4 flex flex-col gap-4"
          >
            <div className="flex justify-between items-start gap-3">
              <SkeletonLoader className="h-5 flex-1 rounded-md max-w-[200px]" />
              <SkeletonLoader className="h-12 w-12 shrink-0 rounded-full" />
            </div>
            <SkeletonLoader className="h-2 w-full rounded-full" />
            <div className="grid grid-cols-2 gap-2">
              <SkeletonLoader className="h-8 rounded-lg" />
              <SkeletonLoader className="h-8 rounded-lg" />
            </div>
          </div>
        ))}
      </main>
      <PillNav />
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col gap-6 px-4 pt-6">
      <div className="flex items-center gap-3">
        <SkeletonLoader className="h-9 w-9 rounded-lg" />
        <SkeletonLoader className="h-6 flex-1 rounded-lg max-w-[140px]" />
      </div>
      <SkeletonLoader className="h-8 w-2/3 rounded-lg" />
      <div className="flex gap-3 overflow-x-auto">
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
      </div>
      <SkeletonLoader className="h-40 w-full rounded-[20px]" />
      <SkeletonLoader className="h-48 w-full rounded-[20px]" />
    </div>
  );
}

/** Initial calendar fetch: mirrors list mode chrome (toggle + stacked event rows). */
export function CalendarPageSkeleton() {
  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-hidden">
      <TopAppBar title="Calendar" showBack />
      <main className="flex flex-col gap-5 px-4 pt-3 flex-1 min-h-0 w-full max-w-lg mx-auto pb-3">
        <SkeletonLoader className="h-11 w-full rounded-[12px]" />
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden rounded-[20px] border border-white/[0.08] p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={`cal-skel-${i}`}
              className="rounded-[10px] border border-white/[0.08] bg-sdash-surface-1/40 p-4 flex flex-col gap-2"
            >
              <SkeletonLoader className="h-4 w-28 rounded-md" />
              <SkeletonLoader className="h-3 w-full rounded" />
              <SkeletonLoader className="h-3 w-4/5 rounded" />
            </div>
          ))}
        </div>
      </main>
      <PillNav />
    </div>
  );
}

/** Initial timetable fetch: mirrors DO tabs + slot list block. */
export function TimetablePageSkeleton() {
  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-hidden">
      <TopAppBar title="Timetable" showBack />
      <main className="w-full max-w-lg mx-auto flex flex-col gap-6 px-4 pt-4 pb-2 flex-1">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonLoader key={`tt-do-${i}`} className="h-7 w-14 shrink-0 rounded-[6px]" />
          ))}
        </div>
        <div className="rounded-[20px] border border-white/[0.08] bg-sdash-surface-1/40 p-4 flex flex-col gap-3 flex-1 min-h-0">
          <SkeletonLoader className="h-6 w-40 rounded-md" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`tt-slot-${i}`} className="flex gap-3 items-center">
              <SkeletonLoader className="h-4 w-16 shrink-0 rounded" />
              <SkeletonLoader className="h-10 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      </main>
      <PillNav />
    </div>
  );
}
