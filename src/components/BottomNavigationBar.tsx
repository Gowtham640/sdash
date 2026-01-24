'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarDays, ListCheck, ClipboardList, MoreHorizontal, Calculator } from 'lucide-react';

const BOTTOM_ITEMS = [
    { label: 'Attendance', href: '/attendance', icon: ListCheck },
    { label: 'Timetable', href: '/timetable', icon: BookOpen },
    { label: 'Marks', href: '/marks', icon: ClipboardList },
    { label: 'Calendar', href: '/calender', icon: CalendarDays }
];

const ALLOWED_PATHS = [
    '/attendance',
    '/marks',
    '/timetable',
    '/calender',
    '/dashboard',
    '/sgpa-calculator',
    '/admin'
];

const shouldShowBottomNav = (pathname: string | null | undefined) => {
    if (!pathname) return false;
    if (pathname === '/') return false;
    if (pathname.startsWith('/auth')) return false;
    return ALLOWED_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
};

const BottomNavigationBar = () => {
    const pathname = usePathname();
    const [moreOpen, setMoreOpen] = useState(false);
    const visible = shouldShowBottomNav(pathname);

    if (!visible) return null;

    return (
        <>
            {/* Dummy spacer (same height as nav) keeps page content visible above fixed bar */}
            <div className="h-[72px] w-full bg-black" aria-hidden="true" />
            <div className="fixed bottom-0 left-0 right-0 z-[90] w-full border-t border-white/20 bg-black font-sora lg:hidden">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-white">
                    <div className="flex w-full items-center justify-between gap-2">
                        {BOTTOM_ITEMS.map(item => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex flex-col items-center gap-0.5 text-center text-[5px] uppercase tracking-[0.25em] text-white/80 transition-colors duration-200 hover:text-white"
                            >
                                <item.icon className="h-5 w-5" />
                                <span className="text-[7px] font-sora font-medium text-white/70">{item.label}</span>
                            </Link>
                        ))}
                        <div className="relative flex flex-col items-center gap-1 text-center text-xs font-semibold text-white/80">
                            {/* More button triggers dropup with additional actions */}
                            <button
                                onClick={() => setMoreOpen(prev => !prev)}
                                className="flex cursor-pointer flex-col items-center gap-0.5 text-[9px] text-white/80 hover:text-white"
                                type="button"
                            >
                                <MoreHorizontal className="h-5 w-5" />
                                <span className="text-[10px] tracking-[0.15em] text-white/70">More</span>
                            </button>
                            {moreOpen && (
                                /* Dropup matches width so it never overflows */
                                <div className="absolute bottom-full mb-2 w-48 max-w-[90vw] right-1 rounded-2xl border border-white/20 bg-black p-3 text-white shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
                                    <Link
                                        href="/sgpa-calculator"
                                        className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold tracking-tight text-white transition-colors duration-150 hover:bg-white/10"
                                        onClick={() => setMoreOpen(false)}
                                    >
                                        <Calculator className="h-4 w-4" />
                                        SGPA Calculator
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export { shouldShowBottomNav };
export default BottomNavigationBar;
