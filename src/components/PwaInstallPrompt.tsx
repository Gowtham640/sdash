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

const isMobileViewport = () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches || window.innerWidth < 900;
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
    const [showOnMobile, setShowOnMobile] = useState(isMobileViewport());
    const isDashboard = pathname === "/dashboard";

    useEffect(() => {
        const handleResize = () => setShowOnMobile(isMobileViewport());
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
        setIsVisible(Boolean(promptEvent));
    }, [isDashboard, showOnMobile, promptEvent]);

    const handleDownload = useCallback(async () => {
        if (!promptEvent) return;
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
    }, [promptEvent]);

    const handleDismiss = useCallback(() => {
        localStorage.setItem(DISMISS_FLAG_KEY, "dismissed");
        setIsVisible(false);
    }, []);

    if (!isVisible) {
        return null;
    }

    return (
        <div className="fixed inset-x-3 bottom-24 z-[110] rounded-2xl border border-white/20 bg-black/80 p-4 shadow-lg backdrop-blur lg:hidden">
            <div className="flex flex-col gap-2 text-sm text-white">
                <p className="text-base font-semibold">Download SDash</p>
                <p className="text-xs text-white/80">Install the web app for quicker access on mobile.</p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={handleDownload}
                    className="min-w-[130px] rounded-full bg-emerald-500 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-400"
                >
                    Download
                </button>
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60 underline-offset-2 transition hover:text-white"
                >
                    Later
                </button>
            </div>
        </div>
    );
}
