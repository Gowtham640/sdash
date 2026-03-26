"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  FormEvent,
} from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import GlassCard from "@/components/sdash/GlassCard";
import { storePortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem, isPrivateBrowsing } from "@/lib/browserStorage";
import { trackPostRequest } from "@/lib/postAnalytics";

const HCAPTCHA_SITE_KEY = "a41abb7e-25be-411c-b2fe-c0365fc425ba";
const POST_CAPTCHA_DURATION_MS = 30000;
const LOGIN_TO_CAPTCHA_DELAY_MS = 5000;

type AuthStage = "login" | "captcha" | "postCaptcha";

/** Minimal typing for window.hcaptcha (explicit render + cleanup). */
type HCaptchaAPI = {
  render: (container: HTMLElement, options: Record<string, unknown>) => number;
  remove: (id: number) => void;
  reset: (id?: number) => void;
};

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [stage, setStage] = useState<AuthStage>("login");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [isCaptchaScriptReady, setIsCaptchaScriptReady] = useState(false);
  const [postCaptchaProgress, setPostCaptchaProgress] = useState(0);

  const router = useRouter();
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);
  const captchaTokenRef = useRef<string | null>(null);
  const captchaWidgetIdRef = useRef<number | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCaptchaDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCaptchaProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authenticationStartedRef = useRef(false);
  const captchaSolvedAtRef = useRef<number | null>(null);
  const postCaptchaProgressStartRef = useRef<number | null>(null);
  const loginToCaptchaDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoginTimeout = useCallback(() => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
  }, []);

  const startLoginTimeout = useCallback(() => {
    clearLoginTimeout();
    loginTimeoutRef.current = setTimeout(() => {
      setError("Sorry our servers are full, please try again");
      setStage("login");
      setIsLoading(false);
    }, 60000);
  }, [clearLoginTimeout]);

  const clearProgressAnimation = useCallback(() => {
    if (postCaptchaProgressIntervalRef.current) {
      clearInterval(postCaptchaProgressIntervalRef.current);
      postCaptchaProgressIntervalRef.current = null;
    }
    postCaptchaProgressStartRef.current = null;
  }, []);

  const startProgressAnimation = useCallback(() => {
    clearProgressAnimation();
    postCaptchaProgressStartRef.current = Date.now();
    setPostCaptchaProgress(0);
    postCaptchaProgressIntervalRef.current = setInterval(() => {
      const startTime = postCaptchaProgressStartRef.current ?? Date.now();
      const elapsed = Date.now() - startTime;
      let progress = 0;

      if (elapsed <= 3000) {
        progress = (elapsed / 3000) * 60;
      } else if (elapsed < POST_CAPTCHA_DURATION_MS) {
        const slowPhaseDuration = POST_CAPTCHA_DURATION_MS - 3000;
        const extraElapsed = elapsed - 3000;
        progress = 60 + (extraElapsed / slowPhaseDuration) * 40;
      } else {
        progress = 100;
      }

      const clamped = Math.min(100, Math.max(0, progress));
      setPostCaptchaProgress(clamped);

      if (elapsed >= POST_CAPTCHA_DURATION_MS) {
        clearProgressAnimation();
      }
    }, 100);
  }, [clearProgressAnimation]);

  const clearLoginToCaptchaDelay = useCallback(() => {
    if (loginToCaptchaDelayRef.current) {
      clearTimeout(loginToCaptchaDelayRef.current);
      loginToCaptchaDelayRef.current = null;
    }
  }, []);

  const clearVerificationTimers = useCallback(() => {
    if (postCaptchaDelayRef.current) {
      clearTimeout(postCaptchaDelayRef.current);
      postCaptchaDelayRef.current = null;
    }
    clearProgressAnimation();
  }, [clearProgressAnimation]);

  const hasRenderedCaptcha = useCallback(() => {
    if (typeof document === "undefined") {
      return false;
    }
    return Boolean(document.querySelector(".h-captcha iframe"));
  }, []);

  const clearCaptchaState = useCallback(() => {
    clearVerificationTimers();
    authenticationStartedRef.current = false;
    captchaTokenRef.current = null;
    captchaSolvedAtRef.current = null;
    setCaptchaError(null);
    setPostCaptchaProgress(0);
    if (captchaWidgetIdRef.current !== null) {
      try {
        (window as any).hcaptcha.reset(captchaWidgetIdRef.current);
      } catch {
        // ignore reset failure
      } finally {
        captchaWidgetIdRef.current = null;
      }
    }
    if (
      typeof window !== "undefined" &&
      (window as any).hcaptcha?.reset &&
      hasRenderedCaptcha()
    ) {
      try {
        (window as any).hcaptcha.reset();
      } catch {
        // ignore reset failure
      }
    }
  }, [clearVerificationTimers, hasRenderedCaptcha]);

  useEffect(() => {
    return () => {
      clearLoginTimeout();
      clearVerificationTimers();
      clearLoginToCaptchaDelay();
    };
  }, [clearLoginTimeout, clearVerificationTimers, clearLoginToCaptchaDelay]);

  useEffect(() => {
    if (isPrivateBrowsing()) {
      setError(
        "Private Browsing mode detected. Some features may not work properly. " +
          "Please use normal browsing mode for best experience."
      );
    }
  }, []);

  useEffect(() => {
    if (stage !== "postCaptcha") {
      clearProgressAnimation();
      setPostCaptchaProgress(0);
    }
  }, [stage, clearProgressAnimation]);

  /**
   * Next.js <Script onLoad> can miss when the tag is cached, or fire before window.hcaptcha is ready.
   * Poll until the explicit-render API exists so the widget can mount reliably.
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const tryMarkReady = () => {
      const H = (window as unknown as { hcaptcha?: HCaptchaAPI }).hcaptcha;
      if (H?.render) {
        setIsCaptchaScriptReady(true);
        return true;
      }
      return false;
    };

    if (tryMarkReady()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (tryMarkReady()) {
        window.clearInterval(intervalId);
      }
    }, 100);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      if (!tryMarkReady()) {
        console.warn("[Auth Page] hCaptcha API not available after wait (blocked network or script error).");
      }
    }, 25000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleDisclaimerComplete = useCallback(() => {
    setShowDisclaimer(false);
  }, []);

  type AuthCheckResponse = {
    auth_exists: boolean;
    public_exists: boolean;
    has_token?: boolean;
    user_id?: string | null;
    error?: string;
  };

  type CaptchaCheckResult = AuthCheckResponse & {
    loginPromise?: Promise<boolean>;
  };

  const checkUserExistence = useCallback(async (): Promise<AuthCheckResponse> => {
    const credentials = credentialsRef.current;
    if (!credentials) {
      throw new Error("Credentials missing.");
    }

    const checkResponse = await trackPostRequest("/api/auth/check-user", {
      action: "auth_check_user",
      dataType: "user",
      payload: { email: credentials.email },
      omitPayloadKeys: ["password"],
    });

    if (!checkResponse.ok) {
      throw new Error("Failed to verify user existence.");
    }

    return (await checkResponse.json()) as AuthCheckResponse;
  }, []);

  const resumeSessionIfPossible = useCallback(async () => {
    try {
      const existingAccessToken = getStorageItem("access_token");
      if (existingAccessToken) {
        console.log("[Auth Page] Session already present in storage; redirecting.");
        router.replace("/dashboard");
        return;
      }

      const existingRefreshToken = getStorageItem("refresh_token");
      if (!existingRefreshToken) {
        return;
      }

      const refreshResponse = await fetch("/api/auth/refresh", { method: "POST" });
      if (!refreshResponse.ok) {
        return;
      }

      const payload = await refreshResponse.json();
      if (payload?.access_token) {
        setStorageItem("access_token", payload.access_token);
      }
      if (payload?.refresh_token) {
        setStorageItem("refresh_token", payload.refresh_token);
      }

      if (payload?.access_token) {
        console.log("[Auth Page] Session resumed via refresh; redirecting.");
        router.replace("/dashboard");
      }
    } catch (error) {
      console.warn("[Auth Page] Session resume failed (non-blocking):", error);
    }
  }, [router]);

  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) {
      return;
    }
    resumeAttemptedRef.current = true;
    void resumeSessionIfPossible();
  }, [resumeSessionIfPossible]);

  const fetchUserDataSafely = useCallback(async () => {
    try {
      const userResponse = await fetch("/user");
      if (!userResponse.ok) {
        console.warn(
          `[Auth Page] User info fetch failed: ${userResponse.status} ${userResponse.statusText}`
        );
        return null;
      }
      return await userResponse.json();
    } catch (fetchError) {
      console.warn("[Auth Page] User info fetch error:", fetchError);
      return null;
    }
  }, []);

  const performLogin = useCallback(
    async ({ skipFetchUserData = false }: { skipFetchUserData?: boolean } = {}) => {
      const credentials = credentialsRef.current;
      if (!credentials) {
        throw new Error("Credentials missing.");
      }

      const loginPayload: Record<string, unknown> = {
        email: credentials.email,
        password: credentials.password,
      };
      if (captchaTokenRef.current) {
        loginPayload.captcha = captchaTokenRef.current;
      }

    const loginResponse = await trackPostRequest("/api/auth/login", {
        action: "login",
        dataType: "login",
        payload: loginPayload,
        omitPayloadKeys: ["password", "captcha"],
      });
      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
      const loginError =
        typeof loginData.error === "string"
          ? loginData.error
          : typeof loginData.error === "object" && loginData.error !== null
            ? loginData.error.message ?? JSON.stringify(loginData.error)
            : undefined;

      throw new Error(loginError || "Sign-in failed. Please try again.");
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

      if (!skipFetchUserData) {
        const userData = await fetchUserDataSafely();
        if (!userData) {
          console.warn("[Auth Page] User info not available after login.");
        } else {
          const userStored = setStorageItem("user", JSON.stringify(userData));
          if (!userStored) {
            console.warn("[Auth Page] Failed to store user data after login.");
          }
        }
      }

      return true;
    },
    [fetchUserDataSafely]
  );

  const redirectExistingUser = useCallback(async () => {
    await performLogin({ skipFetchUserData: true });
    clearLoginTimeout();
    setIsLoading(false);
    router.push("/dashboard");
  }, [performLogin, router, clearLoginTimeout]);

  const ensureUserBeforeCaptcha = useCallback(async (): Promise<CaptchaCheckResult> => {
    const checkData = await checkUserExistence();
    if (!checkData.auth_exists) {
      const loginPromise = performLogin();
      return {
        ...checkData,
        loginPromise,
      };
    }

    if (checkData.public_exists) {
      await redirectExistingUser();
      return checkData;
    }

    const userData = await fetchUserDataSafely();
    if (userData) {
      setStorageItem("user", JSON.stringify(userData));
    } else {
      console.warn("[Auth Page] User info missing; continuing without it.");
    }
    return checkData;
  }, [checkUserExistence, performLogin, redirectExistingUser, fetchUserDataSafely]);



  const resetCaptchaWorkflow = useCallback(() => {
    clearCaptchaState();
    setStage("login");
    setIsLoading(false);
    clearLoginToCaptchaDelay();
  }, [clearCaptchaState, clearLoginToCaptchaDelay]);

  const handleBackgroundLoginFailure = useCallback(
    (error: unknown) => {
      console.error("[Auth Page] Background login failed:", error);
      resetCaptchaWorkflow();
      setError(
        error instanceof Error
          ? error.message
          : "Sign-in failed while verifying credentials. Please try again."
      );
      clearLoginTimeout();
    },
    [clearLoginTimeout, resetCaptchaWorkflow]
  );

  const startAuthentication = useCallback(async () => {
    if (authenticationStartedRef.current) {
      return;
    }

    if (!captchaTokenRef.current) {
      setCaptchaError("CAPTCHA session expired. Please complete it again.");
      resetCaptchaWorkflow();
      return;
    }

    authenticationStartedRef.current = true;
    startLoginTimeout();
    try {
      const checkData = await ensureUserBeforeCaptcha();
      if (checkData.loginPromise) {
        await checkData.loginPromise;
      }
      clearLoginTimeout();
      clearVerificationTimers();
      setIsLoading(false);
      router.push("/dashboard");
    } catch (err) {
      handleBackgroundLoginFailure(err);
    }
  }, [
    ensureUserBeforeCaptcha,
    handleBackgroundLoginFailure,
    resetCaptchaWorkflow,
    router,
    clearLoginTimeout,
    clearVerificationTimers,
    startLoginTimeout,
  ]);
  const beginPostCaptchaFlow = useCallback(() => {
    clearVerificationTimers();
    setStage("postCaptcha");
    startProgressAnimation();
    setIsLoading(true);
    authenticationStartedRef.current = false;
    if (postCaptchaDelayRef.current) {
      clearTimeout(postCaptchaDelayRef.current);
      postCaptchaDelayRef.current = null;
    }
    postCaptchaDelayRef.current = setTimeout(() => {
      postCaptchaDelayRef.current = null;
      startAuthentication();
    }, POST_CAPTCHA_DURATION_MS);
  }, [
    clearVerificationTimers,
    startProgressAnimation,
    startAuthentication,
  ]);
  const handleCaptchaSuccess = useCallback(
    (token: string) => {
      captchaTokenRef.current = token;
      captchaSolvedAtRef.current = Date.now();
      setCaptchaError(null);
      beginPostCaptchaFlow();
    },
    [beginPostCaptchaFlow]
  );

  const handleCaptchaExpired = useCallback(() => {
    resetCaptchaWorkflow();
    setCaptchaError("CAPTCHA expired. Please complete it again.");
  }, [resetCaptchaWorkflow]);

  const handleCaptchaError = useCallback(() => {
    setCaptchaError("There was an issue verifying the CAPTCHA. Please try again.");
  }, []);

  // hCaptcha callbacks must stay stable for the render effect deps; the API reads latest handlers via refs.
  const handleCaptchaSuccessRef = useRef(handleCaptchaSuccess);
  const handleCaptchaExpiredRef = useRef(handleCaptchaExpired);
  const handleCaptchaErrorRef = useRef(handleCaptchaError);
  handleCaptchaSuccessRef.current = handleCaptchaSuccess;
  handleCaptchaExpiredRef.current = handleCaptchaExpired;
  handleCaptchaErrorRef.current = handleCaptchaError;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const getHcaptcha = () => (window as unknown as { hcaptcha?: HCaptchaAPI }).hcaptcha;

    // Tear down widget whenever we leave the captcha step (login, post-captcha, disclaimer, etc.)
    if (stage !== "captcha") {
      const hcaptcha = getHcaptcha();
      const wid = captchaWidgetIdRef.current;
      if (wid !== null && hcaptcha?.remove) {
        try {
          hcaptcha.remove(wid);
        } catch {
          /* ignore */
        }
        captchaWidgetIdRef.current = null;
      }
      return;
    }

    if (!isCaptchaScriptReady) {
      return;
    }

    let cancelled = false;
    let mountedId: number | null = null;
    let retryTimeoutId: number | null = null;

    const runRender = (attempt = 0) => {
      if (cancelled) {
        return;
      }

      const hcaptcha = getHcaptcha();
      const container = captchaContainerRef.current;

      if (!container) {
        if (attempt < 30) {
          retryTimeoutId = window.setTimeout(() => runRender(attempt + 1), 50);
        } else {
          console.warn("[Auth Page] CAPTCHA container ref missing after retries.");
        }
        return;
      }

      if (!hcaptcha?.render) {
        if (attempt < 80) {
          retryTimeoutId = window.setTimeout(() => runRender(attempt + 1), 100);
        } else {
          console.error("[Auth Page] hcaptcha.render never became available.");
          setCaptchaError("Unable to load CAPTCHA. Check your network or disable blockers, then refresh.");
        }
        return;
      }

      try {
        setCaptchaError(null);
        mountedId = hcaptcha.render(container, {
          sitekey: HCAPTCHA_SITE_KEY,
          callback: (token: string) => handleCaptchaSuccessRef.current(token),
          "expired-callback": () => handleCaptchaExpiredRef.current(),
          "error-callback": () => handleCaptchaErrorRef.current(),
        });
        captchaWidgetIdRef.current = mountedId;
      } catch (err) {
        console.error("[Auth Page] hcaptcha.render failed:", err);
        setCaptchaError("Unable to show CAPTCHA. Please refresh the page and try again.");
      }
    };

    // Iframes inside transformed ancestors (e.g. Framer Motion) often fail to paint; defer two frames
    // after layout so the widget mounts after paint. Avoid wrapping the iframe in motion/backdrop-blur.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          runRender(0);
        }
      });
    });

    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
      const hcaptcha = getHcaptcha();
      if (mountedId !== null && hcaptcha?.remove) {
        try {
          hcaptcha.remove(mountedId);
        } catch {
          /* ignore */
        }
      }
      if (captchaWidgetIdRef.current === mountedId) {
        captchaWidgetIdRef.current = null;
      }
    };
  }, [stage, isCaptchaScriptReady]);


  const handleSignIn = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      const cleanedEmail = email.trim();
      if (!cleanedEmail || !password) {
        setError("Both email and password are required.");
        return;
      }

      const normalizedEmail = cleanedEmail.includes("@")
        ? cleanedEmail
        : `${cleanedEmail}@srmist.edu.in`;
      credentialsRef.current = { email: normalizedEmail, password };
      setEmail(normalizedEmail);
      setShowDisclaimer(false);
      setCaptchaError(null);
      setStage("login");

      clearLoginToCaptchaDelay();
      setIsLoading(true);

      try {
        const checkData = await checkUserExistence();

        if (checkData.auth_exists && checkData.public_exists) {
          console.log("[Auth Page] Existing user path (no captcha).", {
            has_token: Boolean(checkData.has_token),
          });
          await redirectExistingUser();
          return;
        }

        if (checkData.auth_exists && !checkData.public_exists) {
          console.log("[Auth Page] Partial user path (no captcha).");
          clearLoginTimeout();
          await performLogin();
          setIsLoading(false);
          router.push("/dashboard");
          return;
        }

        console.log("[Auth Page] Onboarding user path (captcha required).");
        // Keep the "Signing in..." UI active for a short delay before showing CAPTCHA.
        loginToCaptchaDelayRef.current = setTimeout(() => {
          loginToCaptchaDelayRef.current = null;
          setStage("captcha");
          setIsLoading(false);
        }, LOGIN_TO_CAPTCHA_DELAY_MS);
      } catch (err) {
        // If pre-check fails, do not block sign-in. Fallback to direct login.
        try {
          clearLoginTimeout();
          await performLogin();
          setIsLoading(false);
          router.push("/dashboard");
          return;
        } catch (fallbackErr) {
          clearLoginToCaptchaDelay();
          setIsLoading(false);
          setStage("login");
          setError(
            fallbackErr instanceof Error
              ? fallbackErr.message
              : err instanceof Error
                ? err.message
                : "Unable to continue sign-in. Please try again."
          );
        }
      }
    },
    [email, password, clearLoginTimeout, clearLoginToCaptchaDelay, checkUserExistence, performLogin, redirectExistingUser, router]
  );

  const transition = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.2, ease: "easeOut" },
  };

  const emailPreview =
    email.includes("@") ? email : email ? `${email}@srmist.edu.in` : "";

  return (
    <div className="min-h-screen bg-sdash-bg flex items-center justify-center px-4 py-8">
      <Script
        id="hc-captcha-script"
        src="https://js.hcaptcha.com/1/api.js?render=explicit"
        strategy="afterInteractive"
        async
        defer
        onLoad={() => setIsCaptchaScriptReady(true)}
        onError={() => {
          console.error("[Auth Page] hCaptcha script failed to load.");
          setCaptchaError(
            "Unable to load CAPTCHA. Please refresh the page and try again."
          );
        }}
      />
      <div className="w-full max-w-sm">
        <AnimatePresence mode="wait">
          {showDisclaimer ? (
            <motion.div key="disclaimer" {...transition}>
              <GlassCard className="p-6">
                <Shield size={32} className="text-sdash-text-secondary mb-4" />
                <h1 className="heading-1 text-sdash-text-primary mb-3">Before you sign in</h1>
                <p className="text-sm text-sdash-text-secondary mb-4 leading-relaxed">
                  Visit your Academia portal and comply with the updated password policy before logging
                  in. Complete the necessary steps, then proceed here.
                </p>
                <p className="text-sm text-sdash-text-secondary mb-6 leading-relaxed">
                  SDash accesses your SRM portal data to display your academics. Your credentials are
                  used only for authentication.
                </p>
                <button
                  type="button"
                  onClick={handleDisclaimerComplete}
                  className="w-full bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target hover:bg-indigo-400 transition-colors duration-150 active:scale-[0.98]"
                >
                  I understand
                </button>
              </GlassCard>
            </motion.div>
          ) : stage === "login" ? (
            <motion.div key="login" {...transition}>
              <GlassCard className="p-6">
                <h1 className="heading-1 text-sdash-text-primary mb-6">Sign in</h1>
                <form onSubmit={handleSignIn} className="w-full flex flex-col gap-4">
                  <div>
                    <label className="block text-xs text-sdash-text-secondary mb-1.5 font-sora">Email</label>
                    <input
                      type="text"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                      required
                      placeholder="ra2211003010XXX"
                        className={`w-full bg-sdash-surface-2 border ${
                        error ? "border-sdash-danger" : "border-white/[0.07]"
                        } rounded-[14px] px-4 py-3 text-base text-sdash-text-primary font-sora placeholder:text-sdash-text-muted focus:border-sdash-accent focus:outline-none transition-colors`}
                    />
                    {emailPreview ? (
                      <p className="text-[11px] text-sdash-text-muted mt-1">{emailPreview}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-xs text-sdash-text-secondary mb-1.5 font-sora">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                        required
                        placeholder="Password"
                        className={`w-full bg-sdash-surface-2 border ${
                          error ? "border-sdash-danger" : "border-white/[0.07]"
                        } rounded-[14px] px-4 py-3 pr-12 text-base text-sdash-text-primary font-sora placeholder:text-sdash-text-muted focus:border-sdash-accent focus:outline-none transition-colors`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 touch-target text-sdash-text-secondary"
                        disabled={isLoading}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  {error ? (
                    <p className="text-xs text-sdash-danger font-sora">{error}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target hover:bg-indigo-400 transition-colors duration-150 active:scale-[0.98] disabled:opacity-50"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Signing in...
                      </span>
                    ) : (
                      "Next"
                    )}
                  </button>
                </form>
              </GlassCard>
            </motion.div>
          ) : stage === "captcha" ? (
            /*
              Do NOT wrap the hCaptcha iframe in motion.div: CSS transform on ancestors breaks iframe painting.
              Keep the widget out of backdrop-blur (GlassCard) for reliable embedding.
            */
            <div key="captcha" className="w-full space-y-4 transform-none">
              <GlassCard className="p-6">
                <h1 className="heading-1 text-sdash-text-primary mb-2 text-center">CAPTCHA</h1>
                <p className="text-xs text-sdash-text-secondary text-center">
                  Complete the challenge below to continue signing in.
                </p>
              </GlassCard>
              <div className="rounded-[20px] border border-white/[0.1] bg-sdash-surface-2 p-4 flex justify-center overflow-visible">
                <div
                  ref={captchaContainerRef}
                  className="h-captcha w-full max-w-[400px] min-h-[150px] pointer-events-auto relative z-10"
                  style={{ touchAction: "manipulation" }}
                />
              </div>
              {captchaError ? (
                <p className="text-sdash-danger text-xs text-center">{captchaError}</p>
              ) : null}
            </div>
          ) : stage === "postCaptcha" ? (
            <motion.div key="postCaptcha" {...transition}>
              <GlassCard className="p-6 text-center">
                <h1 className="heading-1 text-sdash-text-primary mb-6">Verifying</h1>
                <div className="w-full h-1 bg-sdash-surface-2 rounded-full mb-3 overflow-hidden">
                  <motion.div
                    className="h-full bg-sdash-accent rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${Math.min(100, postCaptchaProgress)}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="text-xs text-sdash-text-secondary font-sora">
                  Completing verification <span className="stat-number">{Math.round(postCaptchaProgress)}%</span>
                </p>
              </GlassCard>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
