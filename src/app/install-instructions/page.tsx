"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

type Step = { title: string; summary: string; detail: string };

const sectionSteps: Record<string, Step[]> = {
    safari: [
        {
            title: "Open the Share menu",
            summary: "Tap the Share icon (box with an arrow) at the bottom center.",
            detail:
                "If the Share icon is hidden, scroll the page slightly or tap near the top so the chrome reappears. On iPhone, it is centered; on iPad it might be on the top-right.",
        },
        {
            title: "Choose \"Add to Home Screen\"",
            summary: "Swipe through the action row and select “Add to Home Screen”.",
            detail:
                "If you don’t see it immediately, scroll the second row of icons all the way to the right. The button uses a plus icon with a home screen symbol.",
        },
        {
            title: "Confirm the icon",
            summary: "Rename if desired and tap \"Add\" to finish.",
            detail:
                "You can change the label to “SDash” then tap “Add” in the top-right. The icon will appear on your home screen instantly.",
        },
    ],
    chrome: [
        {
            title: "Open the Chrome menu",
            summary: "Tap the three-dot menu at the bottom-right (iOS) or top-right (Android).",
            detail:
                "On Android, the dots are stacked vertically; on iOS they appear horizontally. If the menu is hidden when scrolling, tap the address bar to reveal it.",
        },
        {
            title: "Select \"Add to Home screen\"",
            summary: "Look for “Add to Home screen” in the menu.",
            detail:
                "If the option isn’t visible, tap \"Share\" inside the menu and then scroll to the bottom of the share sheet to find “Add to Home screen”.",
        },
        {
            title: "Confirm and install",
            summary: "Tap \"Add\" to place SDash on your home screen.",
            detail:
                "You may be asked to confirm a name like “SDash”. Tap “Add” and the icon will drop onto your home screen or launcher instantly.",
        },
    ],
    android: [
        {
            title: "Open the Chrome menu",
            summary: "Tap the vertical three-dot menu in the top-right corner.",
            detail:
                "If your URL bar is hidden, scroll up slightly to reveal the menu dots. They stay near the right edge of the toolbar.",
        },
        {
            title: "Tap “Install app” or “Add to Home screen”",
            summary: "Choose the install action from the menu.",
            detail:
                "Chrome may show an “Install app” banner above the menu; tap it. Alternatively, pick “Add to Home screen” and continue.",
        },
        {
            title: "Accept the install",
            summary: "Confirm the prompt to install SDash.",
            detail:
                "Tap “Install” or “Add” when Chrome shows the dialog. The shortcut will appear on your home screen and behave like a native app.",
        },
    ],
};

function StepCard({ step }: { step: Step }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="rounded-2xl border border-white/10 font-sora bg-white/5 p-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-white font-sora text-sm font-semibold">{step.title}</p>
                    <p className="text-xs font-sora text-white/70">{step.summary}</p>
                </div>
                <button onClick={() => setOpen((prev) => !prev)} className="text-white/60 font-sora">
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>
            {open && (
                <p className="mt-3 font-sora text-[0.75rem] leading-5 text-white/70">{step.detail}</p>
            )}
        </div>
    );
}

function Section({
    id,
    title,
    description,
    steps,
}: {
    id: string;
    title: string;
    description: string;
    steps: Step[];
}) {
    return (
        <section id={id} className="space-y-3">
            <div>
                <p className="text-xs font-sora font-semibold uppercase tracking-[0.3em] text-white/60">
                    {title}
                </p>
                <p className="text-lg font-sora font-semibold text-white">{description}</p>
            </div>
            <div className="space-y-3">
                {steps.map((step) => (
                    <StepCard key={step.title} step={step} />
                ))}
            </div>
        </section>
    );
}

export default function InstallInstructionsPage() {
    return (
        <div className="min-h-screen font-sora bg-black px-4 py-8 text-white lg:px-12">
            <div className="mx-auto max-w-5xl space-y-8">
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
                        Install Guide
                    </p>
                    <h1 className="text-3xl font-bold font-sora">Install SDash</h1>
                    <p className="text-sm text-white/70">
                        Choose the instructions for your browser to add SDash to your home screen
                        without waiting for any native prompts.
                    </p>
                </div>

                <nav className="flex flex-wrap gap-2">
                    {["safari", "chrome", "android"].map((platform) => (
                        <a
                            key={platform}
                            href={`#${platform}`}
                            className="rounded-full border border-white/20 px-4 py-1 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:bg-white/10"
                        >
                            {platform === "android" ? "Android Chrome" : platform.charAt(0).toUpperCase() + platform.slice(1)}
                        </a>
                    ))}
                </nav>

                <div className="space-y-10">
                    <Section
                        id="safari"
                        title="iOS Safari"
                        description="Safari makes installing SDash super easy with the Share sheet."
                        steps={sectionSteps.safari}
                    />
                    <Section
                        id="chrome"
                        title="Chrome (Desktop & iOS)"
                        description="Chrome will either trigger the install prompt or let you add it manually."
                        steps={sectionSteps.chrome}
                    />
                    <Section
                        id="android"
                        title="Android Chrome"
                        description="Android Chrome can install SDash with one tap from the menu."
                        steps={sectionSteps.android}
                    />
                </div>
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-white">
                    <p className="text-sm">
                        Once installed, SDash launches like a native app—no address bar, faster load, offline-ready.
                    </p>
                    <Link
                        href="/dashboard"
                        className="mt-4 inline-flex rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black"
                    >
                        Back to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
