"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { storePortalPassword, clearPortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem, isPrivateBrowsing } from "@/lib/browserStorage";

// Lazy load LiquidEther to improve initial page load performance
const LiquidEther = lazy(() => import("@/components/LiquidEther"));

const MEMORY_TESTS = [
    { id: 1, order: ["red", "green", "blue"] },
    { id: 2, order: ["red", "blue", "yellow", "green"] },
];

type AuthStage =
    | "login"
    | "initialDelay"
    | "humanCheckbox"
    | "humanVerifying"
    | "humanSuccess"
    | "memoryList"
    | "memoryAnimating"
    | "colorSelection"
    | "colorVerifying"
    | "colorSuccess";

export default function AuthPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showLiquidEther, setShowLiquidEther] = useState(false);
    const [showDisclaimer, setShowDisclaimer] = useState(true);
    const [hasSession, setHasSession] = useState(false);
    const [stage, setStage] = useState<AuthStage>("login");
    const [listMoved, setListMoved] = useState(false);
    const [selectedSequence, setSelectedSequence] = useState<string[]>([]);
    const [colorError, setColorError] = useState<string | null>(null);
    const [testIndex, setTestIndex] = useState(0);
    const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const router = useRouter();
    const currentTest = MEMORY_TESTS[testIndex];
    const credentialsRef = useRef<{ email: string; password: string } | null>(null);
    const [serverFullNotice, setServerFullNotice] = useState<string | null>(null);
    const clearLoginTimeout = () => {
        if (loginTimeoutRef.current) {
            clearTimeout(loginTimeoutRef.current);
            loginTimeoutRef.current = null;
        }
    };

    const startLoginTimeout = () => {
        clearLoginTimeout();
        loginTimeoutRef.current = setTimeout(() => {
            setError("Sorry all our servers are busy, retry later");
            setStage("login");
            setIsLoading(false);
        }, 40000);
    };

    useEffect(() => {
        return () => {
            clearLoginTimeout();
        };
    }, []);

    // Check for Private Browsing mode on mount
    useEffect(() => {
        if (isPrivateBrowsing()) {
            setError(
                'Private Browsing mode detected. Some features may not work properly. ' +
                'Please use normal browsing mode for best experience.'
            );
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        setHasSession(!!getStorageItem("access_token"));
    }, []);

    // Load LiquidEther after initial render to prioritize content loading
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowLiquidEther(true);
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (stage === "initialDelay") {
            timer = setTimeout(() => {
                setIsLoading(false);
                setStage("humanCheckbox");
            }, 2000);
        } else if (stage === "humanSuccess") {
            timer = setTimeout(() => {
                setStage("memoryList");
            }, 2000);
        } else if (stage === "memoryList") {
            timer = setTimeout(() => {
                setStage("memoryAnimating");
            }, 1000);
        } else if (stage === "memoryAnimating") {
            timer = setTimeout(() => {
                setStage("colorSelection");
            }, 800);
        }

        return () => {
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [stage]);

    useEffect(() => {
        if (stage === "memoryAnimating") {
            setListMoved(true);
        }
    }, [stage]);

    useEffect(() => {
        if (stage === "login") {
            setSelectedSequence([]);
            setColorError(null);
            clearLoginTimeout();
        }
        if (stage === "memoryList") {
            setSelectedSequence([]);
            setColorError(null);
        }
    }, [stage]);

    const liquidEtherElement = useMemo(() => (
        <LiquidEther
            colors={["#FFFFFF", "#FFFFFF", "#000000"]}
            mouseForce={20}
            cursorSize={100}
            isViscous={false}
            viscous={30}
            iterationsViscous={32}
            iterationsPoisson={32}
            resolution={0.5}
            isBounce={false}
            autoDemo={true}
            autoSpeed={0.5}
            autoIntensity={2.2}
            takeoverDuration={0.25}
            autoResumeDelay={3000}
            autoRampDuration={0.6}
        />
    ), []);

    const handleDisclaimerComplete = () => {
        setShowDisclaimer(false);
    };


    const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        if (!email || !password) {
            setError("Both email and password are required.");
            return;
        }

        credentialsRef.current = { email, password };
        setIsLoading(true);
        setShowDisclaimer(false);
        setTestIndex(0);
        setStage("initialDelay");
        startLoginTimeout();

        try {
            await ensureUserBeforeCaptcha();
        } catch (err) {
            console.error("[Auth Page] Pre-login error:", err);
            setError(err instanceof Error ? err.message : "Login check failed.");
            setIsLoading(false);
            setStage("login");
            clearLoginTimeout();
        }
    };

    const fetchUserDataSafely = useCallback(async () => {
        try {
            const userResponse = await fetch("/user");
            if (!userResponse.ok) {
                console.warn(`[Auth Page] User info fetch failed: ${userResponse.status} ${userResponse.statusText}`);
                return null;
            }
            return await userResponse.json();
        } catch (fetchError) {
            console.warn("[Auth Page] User info fetch error:", fetchError);
            return null;
        }
    }, []);

    const performLogin = useCallback(async () => {
        const credentials = credentialsRef.current;
        if (!credentials) {
            throw new Error("Credentials missing.");
        }

        const loginResponse = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
        });
        const loginData = await loginResponse.json();

        if (!loginResponse.ok) {
            throw new Error(loginData.error || "Sign-in failed. Please try again.");
        }

        const tokenStored = setStorageItem("access_token", loginData.data.session.access_token);
        const refreshStored = setStorageItem("refresh_token", loginData.data.session.refresh_token);
        if (!tokenStored || !refreshStored) {
            throw new Error("Failed to store session tokens.");
        }

        const passwordStored = storePortalPassword(credentials.password);
        if (!passwordStored) {
            throw new Error("Failed to preserve credentials.");
        }

        removeStorageItem("user_semester");
        const loginTimestamp = Date.now();
        setStorageItem("login_timestamp", loginTimestamp.toString());

        const userData = await fetchUserDataSafely();
        if (!userData) {
            console.warn("[Auth Page] User info not available after login.");
        } else {
            const userStored = setStorageItem("user", JSON.stringify(userData));
            if (!userStored) {
                console.warn("[Auth Page] Failed to store user data after login.");
            }
        }

        return true;
    }, [fetchUserDataSafely]);

    const ensureUserBeforeCaptcha = useCallback(async () => {
        const credentials = credentialsRef.current;
        if (!credentials) {
            throw new Error("Credentials missing.");
        }

        const checkResponse = await fetch("/api/auth/check-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: credentials.email }),
        });

        if (!checkResponse.ok) {
            throw new Error("Failed to verify user existence.");
        }

        const checkData = await checkResponse.json();
        if (!checkData.auth_exists) {
            await performLogin();
        } else if (!checkData.public_exists) {
            const userData = await fetchUserDataSafely();
            if (userData) {
                setStorageItem("user", JSON.stringify(userData));
            } else {
                console.warn("[Auth Page] User info missing; continuing without it.");
            }
        }
    }, [performLogin, fetchUserDataSafely]);

    useEffect(() => {
        if (stage !== "colorSuccess" || testIndex !== MEMORY_TESTS.length - 1) {
            if (stage !== "colorSuccess") {
                setServerFullNotice(null);
            }
            return;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        setServerFullNotice(null);

        const attemptRecordCheck = async (isRetry: boolean) => {
            if (cancelled) return;
            const credentials = credentialsRef.current;
            if (!credentials) {
                console.warn("[Auth Page] Cannot check records without credentials.");
                return;
            }

            try {
                const response = await fetch("/api/auth/check-user", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: credentials.email }),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.auth_exists || data.public_exists) {
                        router.push("/dashboard");
                        return;
                    }
                } else {
                    console.warn("[Auth Page] Record check returned error:", response.status);
                }
            } catch (err) {
                console.warn("[Auth Page] Record check failed:", err);
            }

            if (!isRetry) {
                retryTimer = setTimeout(() => attemptRecordCheck(true), 6000);
            } else if (!cancelled) {
                setServerFullNotice("Servers are full. Please try again in a moment.");
            }
        };

        attemptRecordCheck(false);

        return () => {
            cancelled = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
            }
        };
    }, [stage, testIndex, router]);

    /*
    const startBackendAuth = useCallback(async () => {
        setBackendStatusActive(true);
        setIsLoading(true);

        try {
            await performLogin();
            clearLoginTimeout();
            router.push("/dashboard");
            const credentials = credentialsRef.current;
            if (!credentials) {
                throw new Error("Credentials missing.");
            }

            const checkResponse = await fetch("/api/auth/check-user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: credentials.email }),
            });

            if (!checkResponse.ok) {
                throw new Error("Failed to verify user existence.");
            }

            const checkData = await checkResponse.json();
            if (!checkData.auth_exists) {
                await performLogin();
            } else if (!checkData.public_exists) {
                const userResponse = await fetch("/user");
                if (!userResponse.ok) {
                    throw new Error("Failed to fetch user information.");
                }
                const userData = await userResponse.json();
                setStorageItem("user", JSON.stringify(userData));
            }

            clearLoginTimeout();
            router.push("/dashboard");
        } catch (err) {
            console.error("[Auth Page] Backend auth error:", err);
            setError(err instanceof Error ? err.message : "Backend authentication failed.");
            setStage("login");
        } finally {
            setIsLoading(false);
            setBackendStatusActive(false);
        }
    }, [performLogin, router]);
    */

    const handleHumanCheckboxChange = () => {
        if (stage !== "humanCheckbox") return;
        setStage("humanVerifying");
        setTimeout(() => {
            setStage("humanSuccess");
        }, 2000);
    };

    const handleColorClick = (color: string) => {
        if (stage !== "colorSelection") return;
        setColorError(null);
        const currentOrder = currentTest?.order || [];
        const expectedColor = currentOrder[selectedSequence.length];
        if (color === expectedColor) {
            const nextSequence = [...selectedSequence, color];
            setSelectedSequence(nextSequence);
            if (nextSequence.length === currentOrder.length) {
                setStage("colorVerifying");
                setTimeout(() => {
                    setStage("colorSuccess");
                }, 2000);
            }
        } else {
            setSelectedSequence([]);
            setColorError("Incorrect order. Please try again.");
        }
    };

    const shouldShowMemoryList = ["memoryList", "memoryAnimating", "colorSelection", "colorVerifying", "colorSuccess"].includes(stage);
    const currentOrder = currentTest?.order ?? [];

    useEffect(() => {
        if (stage === "colorSuccess" && testIndex < MEMORY_TESTS.length - 1) {
            const timer = setTimeout(() => {
                setTestIndex((prev) => prev + 1);
                setStage("memoryList");
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [stage, testIndex]);

    return (
        <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">

            {showLiquidEther && (
                <div className="absolute inset-0 z-0">
                    <Suspense fallback={null}>
                        {liquidEtherElement}
                    </Suspense>
                </div>
            )}
            {/* Green arc border */}
            <div
                className="pointer-events-none absolute top-40 left-1/2 -translate-x-1/2 translate-y-1/2
             w-[120vw] h-[140vh] rounded-full
             border-[180px] border-green-400/70
             rotate-180 shadow-2xl shadow-green-400/30
             z-[1]"
            />

            {/* Green glow sphere */}
            <div
                className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1]"
            >
                <div
                    className="rounded-full"
                    style={{
                        width: "clamp(400px, 60vw, 700px)",
                        height: "clamp(400px, 60vw, 700px)",
                        background: "rgba(34, 197, 94, 0.25)",
                        filter: "blur(120px)",
                    }}
                />
            </div>



            <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[80vw] md:w-[60vw] lg:w-[40vw] xl:w-[30vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-lg sm:text-xl md:text-2xl lg:text-3xl font-sora flex flex-col gap-6 sm:gap-8 md:gap-10 lg:gap-10 justify-center items-center">
                {showDisclaimer ? (
                    <>
                        <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-bold">Important</div>
                        <p className="text-white text-base sm:text-lg md:text-base text-center">
                            Visit your Academia portal and comply with the updated password policy before logging in. Complete the necessary steps, then proceed here.
                        </p>
                        <button
                            type="button"
                            onClick={handleDisclaimerComplete}
                            className="w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-white rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 border border-gray-700 justify-center items-center flex font-sans text-sm text-gray-800 font-semibold hover:bg-gray-100 active:bg-gray-200 transition-all"
                        >
                            Done
                        </button>
                    </>
                ) : stage === "login" ? (
                    <>
                        <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-bold">Sign In</div>
                        <form onSubmit={handleSignIn} className="w-full flex flex-col gap-4">
                            <input
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={isLoading}
                                required
                                className="active:outline-none focus:outline-none w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-gray-950/0 rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 border border-gray-700 justify-center items-center flex font-sans text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <div className="relative w-full">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={isLoading}
                                    required
                                    className="active:outline-none focus:outline-none w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-gray-950/0 rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 pr-10 sm:pr-12 lg:pr-12 border border-gray-700 justify-center items-center flex font-sans text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                                    disabled={isLoading}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {error && (
                                <div className="w-full p-3 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200 text-xs font-semibold">
                                    {error}
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-white rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 border border-gray-700 justify-center items-center flex font-sans text-sm text-gray-800 font-semibold hover:bg-gray-100 transition-all disabled:opacity-50 disabled:hover:bg-white cursor-pointer"
                            >
                                {isLoading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
                                        Signing in...
                                    </div>
                                ) : (
                                    "Next"
                                )}
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="w-full flex flex-col gap-4 items-center">
                        {stage === "initialDelay" && (
                            <p className="text-white text-base font-sora text-center">
                                Preparing the verification sequence... please wait.
                            </p>
                        )}
                        {(stage === "humanCheckbox" || stage === "humanVerifying" || stage === "humanSuccess") && (
                            <div className="w-full flex flex-col gap-3 items-center">
                                <div className="text-white text-lg font-semibold text-center">Verify you are human</div>
                                <label className="flex items-center gap-3 bg-gray-900/70 border border-white/20 rounded-2xl px-4 py-3 w-full justify-between">
                                    <input
                                        type="checkbox"
                                        onChange={handleHumanCheckboxChange}
                                        disabled={stage !== "humanCheckbox"}
                                        className="w-5 h-5 rounded border border-gray-500 accent-white bg-transparent"
                                    />
                                    <span className="text-white text-sm font-sora">I confirm I am not a robot</span>
                                </label>
                                {stage === "humanVerifying" && (
                                    <div className="text-white text-xs text-center">Verifying human check...</div>
                                )}
                                {stage === "humanSuccess" && (
                                    <div className="text-green-400 text-sm font-semibold">Success</div>
                                )}
                            </div>
                        )}
                        {shouldShowMemoryList && (
                            <div
                                className="w-full bg-white/5 border border-white/20 rounded-3xl p-4 text-center relative overflow-hidden"
                                style={{
                                    transform: listMoved ? "translateY(-120px)" : "translateY(0)",
                                }}
                            >
                                <div className="text-white text-sm font-semibold mb-2">Remember this order</div>
                                <div className="flex justify-center gap-3">
                                    {currentOrder.map((color) => (
                                        <span key={color} className="uppercase text-xs tracking-widest" style={{ color }}>
                                            {color}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {stage === "colorSelection" && (
                            <div className="w-full flex flex-col gap-4 items-center">
                                <div className="text-white text-center text-base font-semibold">
                                    Click the colors in the order shown below
                                </div>
                                <div className="grid grid-cols-2 gap-3 w-full">
                                    {["red", "blue", "yellow", "green"].map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => handleColorClick(color)}
                                            className="h-20 rounded-2xl border border-white/30 transition-all"
                                            style={{ backgroundColor: color, opacity: selectedSequence.includes(color) ? 0.6 : 1 }}
                                        />
                                    ))}
                                </div>
                                {colorError && (
                                    <div className="text-red-300 text-xs text-center">{colorError}</div>
                                )}
                                {selectedSequence.length > 0 && (
                                    <div className="text-white text-xs text-center">
                                        Selected: {selectedSequence.join(" → ")}
                                    </div>
                                )}
                            </div>
                        )}
                        {stage === "colorVerifying" && (
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-white text-sm">Validating your response...</div>
                                <div className="w-6 h-6 border-2 border-white rounded-full border-t-transparent animate-spin" />
                            </div>
                        )}
                        {stage === "colorSuccess" && (
                            <div className="text-green-400 text-sm font-semibold">Success</div>
                        )}
                        {serverFullNotice && (
                            <div className="w-full p-3 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-200 text-xs font-semibold text-center">
                                {serverFullNotice}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
