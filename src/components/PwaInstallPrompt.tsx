"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type BeforeInstallPromptEvent = Event & {
    readonly platforms: string[];
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const INSTALL_FLAG_KEY = "sdash_pwa_install_status";
const DISMISS_FLAG_KEY = "sdash_pwa_prompt_dismissed";

const getIsMobileDevice = () => {
    if (typeof window === "undefined") return false;
    const widthCheck = window.matchMedia("(max-width: 900px)").matches || window.innerWidth < 900;
    const touchDevice = ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0);
    const mobileUASniff = /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent || "");
    return widthCheck || touchDevice || mobileUASniff;
};

const detectBrowser = () => {
    if (typeof navigator === "undefined") return "other";
    const ua = navigator.userAgent;
    if (/CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua) && !/OPR/i.test(ua)) {
        return "chrome";
    }
    if (/Edg|Edge/i.test(ua)) {
        return "edge";
    }
    if (/Firefox/i.test(ua)) {
        return "firefox";
    }
    if (/Safari/i.test(ua) && !/CriOS/i.test(ua)) {
        return "safari";
    }
    if (/OPR|Opera/i.test(ua)) {
        return "opera";
    }
    return "other";
};

const instructionsCopy: Record<string, string> = {
    chrome: "Tap install and give SDash a home screen shortcut for quick access.",
    edge: "Tap install and keep SDash handy via a home screen shortcut.",
    safari: "Tap the Share button then choose “Add to Home Screen” to install SDash.",
    firefox: "Use the browser menu and choose “Add to Home screen” to install SDash.",
    opera: "Use the browser menu > Add to home screen to install SDash.",
    other: "Install SDash by adding it to your home screen from the browser menu.",
};

const isAppInstalled = () => {
    if (typeof window === "undefined") return false;
    const standaloneMatch = window.matchMedia("(display-mode: standalone)").matches;
    const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    const installedFlag = localStorage.getItem(INSTALL_FLAG_KEY);
    return standaloneMatch || Boolean(navigatorStandalone) || installedFlag === "installed";
};

export default function PwaInstallPrompt() {
    const pathname = usePathname();
    const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [showOnMobile, setShowOnMobile] = useState(getIsMobileDevice());
    const isDashboard = pathname === "/dashboard";

    useEffect(() => {
        const handleResize = () => setShowOnMobile(getIsMobileDevice());
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const handler = (event: Event) => {
            event.preventDefault();
            setPromptEvent(event as BeforeInstallPromptEvent);
        };
        window.addEventListener("beforeinstallprompt", handler);

        const installHandler = () => {
            localStorage.setItem(INSTALL_FLAG_KEY, "installed");
            setIsVisible(false);
        };
        window.addEventListener("appinstalled", installHandler);

        return () => {
            window.removeEventListener("beforeinstallprompt", handler);
            window.removeEventListener("appinstalled", installHandler);
        };
    }, []);

    useEffect(() => {
        if (!isDashboard || !showOnMobile || isAppInstalled()) {
            setIsVisible(false);
            return;
        }
        if (localStorage.getItem(DISMISS_FLAG_KEY)) {
            setIsVisible(false);
            setPromptEvent(null);
            return;
        }
        setIsVisible(true);
    }, [isDashboard, showOnMobile]);

    const browserKey = useMemo(() => detectBrowser(), []);
    const instructions = instructionsCopy[browserKey] || instructionsCopy.other;

    const handleDownload = useCallback(async () => {
        if (promptEvent) {
            try {
                await promptEvent.prompt();
                const choice = await promptEvent.userChoice;
                if (choice.outcome === "accepted") {
                    localStorage.setItem(INSTALL_FLAG_KEY, "installed");
                } else {
                    localStorage.setItem(DISMISS_FLAG_KEY, "dismissed");
                }
            } catch {
                localStorage.setItem(DISMISS_FLAG_KEY, "dismissed");
            } finally {
                setIsVisible(false);
                setPromptEvent(null);
            }
            return;
        }
        window.open(`/install-instructions`, "_blank");
        setIsVisible(false);
    }, [promptEvent, browserKey]);

    const handleDismiss = useCallback(() => {
        localStorage.setItem(DISMISS_FLAG_KEY, "dismissed");
        setIsVisible(false);
    }, []);

    if (!isVisible) {
        return null;
    }

    return (
        <div className="fixed font-sora inset-x-3 bottom-24 z-[110] rounded-2xl border border-white/20 bg-black/80 p-4 shadow-lg backdrop-blur lg:hidden">
            <div className="flex flex-col gap-2 text-sm text-white">
                <p className="text-base font-sora font-semibold">Install SDash</p>
                <p className="text-xs font-sora text-white/80">Keep SDash on your home screen for faster access.</p>
                <p className="text-xs font-sora text-white/70">{instructions}</p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={handleDownload}
                    className="min-w-[130px] font-sora rounded-full bg-emerald-500 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-400"
                >
                    Download
                </button>
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="text-xs font-semibold font-sora uppercase tracking-[0.2em] text-white/60 underline-offset-2 transition hover:text-white"
                >
                    Later
                </button>
            </div>
        </div>
    );
}
