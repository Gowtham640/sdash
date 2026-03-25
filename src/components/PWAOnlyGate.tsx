"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Rocket, Share2, SquarePlus } from "lucide-react";

type PWAOnlyGateProps = {
  children: React.ReactNode;
};

type DisplayMode = "unknown" | "standalone" | "browser";

const PWA_SKIP_KEY = "sdash_pwa_gate_skipped";

function getDisplayMode(): DisplayMode {
  if (typeof window === "undefined") {
    return "unknown";
  }

  const standaloneMatch = window.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const twaReferrer = document.referrer.startsWith("android-app://");

  if (standaloneMatch || navigatorStandalone || twaReferrer) {
    return "standalone";
  }

  return "browser";
}

export default function PWAOnlyGate({ children }: PWAOnlyGateProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>("unknown");
  const [skipGate, setSkipGate] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(PWA_SKIP_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const updateDisplayMode = () => {
      setDisplayMode(getDisplayMode());
    };

    updateDisplayMode();
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    mediaQuery.addEventListener("change", updateDisplayMode);
    window.addEventListener("pageshow", updateDisplayMode);

    return () => {
      mediaQuery.removeEventListener("change", updateDisplayMode);
      window.removeEventListener("pageshow", updateDisplayMode);
    };
  }, []);

  const isAllowed = useMemo(() => displayMode === "standalone" || skipGate, [displayMode, skipGate]);

  const handleSkip = useCallback(() => {
    try {
      window.localStorage.setItem(PWA_SKIP_KEY, "1");
    } catch {
      // ignore storage failures
    }
    setSkipGate(true);
  }, []);

  useEffect(() => {
    // Only lock scrolling when we're actively showing the gate screen.
    if (displayMode !== "browser" || skipGate) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousBodyTouchAction = body.style.touchAction;

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.touchAction = "none";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [displayMode, skipGate]);

  if (displayMode === "unknown") {
    return <div className="min-h-screen bg-sdash-bg" />;
  }

  if (isAllowed) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 h-dvh overflow-hidden overscroll-none bg-sdash-bg px-8 py-10 touch-none">
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        <div className="absolute right-6 top-10">
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-full border border-white/20 bg-black/30 px-4 py-2 text-xs font-sora font-semibold uppercase tracking-[0.22em] text-white/80 backdrop-blur hover:bg-white/10 hover:text-white"
          >
            Skip
          </button>
        </div>
        <div className="mb-16 flex items-center gap-3">
          <Image src="/sdashTransparentLogo.png" alt="SDash logo" width={36} height={36} className="h-9 w-9 object-contain" priority />
          <span className="font-sora text-3xl font-bold tracking-tight text-sdash-text-primary">SDash</span>
        </div>

        <div className="mb-12">
          <p className="mb-4 font-geist-mono text-[11px] uppercase tracking-[0.28em] text-sdash-text-muted">
            Browser view is limited
          </p>
          <h1 className="font-sora text-5xl font-semibold leading-[1.1] tracking-[-0.03em] text-sdash-text-primary">
            Take SDash to your home screen
          </h1>
        </div>

        <div className="mt-auto space-y-6 border-t border-white/15 pt-5">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/20">
              <Share2 size={18} className="text-sdash-text-primary" />
            </div>
            <p className="font-geist-mono text-sm uppercase tracking-[0.10em] text-sdash-text-primary">
              1. Tap the Share icon below
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/20">
              <SquarePlus size={18} className="text-sdash-text-primary" />
            </div>
            <p className="font-geist-mono text-sm uppercase tracking-[0.10em] text-sdash-text-primary">
              2. Select Add to Home Screen
            </p>
          </div>

          <div className="flex items-center gap-4 pb-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/20">
              <Rocket size={18} className="text-sdash-accent" />
            </div>
            <p className="font-geist-mono text-sm uppercase tracking-[0.10em] text-sdash-accent">
              3. Launch SDash from your home
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
