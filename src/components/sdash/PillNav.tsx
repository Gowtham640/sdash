"use client";

import { usePathname, useRouter } from "next/navigation";
import { Home, Clock, BarChart3, Award, CalendarDays, Calculator } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useEffect, useRef, useCallback, useSyncExternalStore, type CSSProperties } from "react";
import { LiquidGlass, type LiquidGlassRef } from "@specy/liquid-glass-react";

const tabs = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/timetable", icon: Clock, label: "Timetable" },
  { path: "/attendance", icon: BarChart3, label: "Attendance" },
  { path: "/marks", icon: Award, label: "Marks" },
  { path: "/calender", icon: CalendarDays, label: "Calendar" },
  { path: "/sgpa-calculator", icon: Calculator, label: "GPA" },
];

export const PillNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const activeIndex = tabs.findIndex((t) => pathname === t.path || pathname?.startsWith(`${t.path}/`));

  // LiquidGlass uses WebGL — mount only on client without effect-driven setState
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Re-capture background when route changes (paint cache uses page behind the bar)
  useEffect(() => {
    if (!mounted) return;
    const id = requestAnimationFrame(() => {
      void glassRef.current?.forceUpdate();
    });
    return () => cancelAnimationFrame(id);
  }, [pathname, mounted]);

  // Library defaults use pixel-scale (depth ~24, radius ~16); README "0–1" is misleading — tiny values make the glass invisible
  const glassStyle = useMemo(
    () => ({
      depth: 60,
      segments: 128,
      radius: 6,
      tint: null as number | null,
      reflectivity: 0.7,
      thickness: 70,
      dispersion: 8.1,
      roughness: 0,
      transmission: 0.2,
      ior: 1.5,
    }),
    []
  );

  const glassRef = useRef<LiquidGlassRef>(null);

  // Center with margin auto — transform breaks position tracking in @specy/liquid-glass-react
  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      bottom: 24,
      left: 0,
      right: 0,
      marginLeft: "auto",
      marginRight: "auto",
      zIndex: 100,
      maxWidth: "calc(100vw - 1rem)",
      width: "fit-content",
      pointerEvents: "auto",
    }),
    []
  );

  const onGlassReady = useCallback(() => {
    requestAnimationFrame(() => {
      glassRef.current?.forcePositionUpdate();
      glassRef.current?.forceSizeUpdate();
      void glassRef.current?.forceUpdate();
    });
  }, []);

  const tabButtons = (
    <>
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        const Icon = tab.icon;
        return (
          <button
            key={tab.path}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            onClick={() => router.push(tab.path)}
            className="relative touch-target flex flex-col items-center px-2 sm:px-3 py-1.5 active:scale-[1] transition-transform duration-100 shrink-0"
          >
            {isActive && (
              <motion.div
                layoutId="pill-indicator"
                className="absolute inset-0 bg-sdash-accent/15 rounded-[10px]"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <Icon
              size={isActive ? 22 : 20}
              className={`relative z-10 transition-colors duration-150 ${
                isActive ? "text-sdash-accent" : "text-sdash-text"
              }`}
            />
          </button>
        );
      })}
    </>
  );

  // SSR + first paint: static bar (matches layout, no WebGL)
  if (!mounted) {
    return (
      <nav
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-[12px] px-2 py-2 flex items-center gap-0.5 sm:gap-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-w-[calc(100vw-1rem)] overflow-x-auto hide-scrollbar"
        style={{ paddingBottom: `calc(8px + env(safe-area-inset-bottom))` }}
        role="tablist"
      >
        {tabButtons}
      </nav>
    );
  }

  return (
    <LiquidGlass
      ref={glassRef}
      glassStyle={glassStyle}
      wrapperStyle={wrapperStyle}
      onReady={onGlassReady}
      style={`
        padding: 8px 8px calc(8px + env(safe-area-inset-bottom)) 8px;
        max-width: calc(100vw - 1rem);
        overflow-x: auto;
      `}
    >
      <nav className="flex items-center gap-0.5 sm:gap-1 hide-scrollbar" role="tablist">
        {tabButtons}
      </nav>
    </LiquidGlass>
  );
};

export default PillNav;
