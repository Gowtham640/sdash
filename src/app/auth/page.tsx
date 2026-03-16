"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  lazy,
  Suspense,
  FormEvent,
} from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { storePortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, removeStorageItem, isPrivateBrowsing } from "@/lib/browserStorage";
import { trackPostRequest } from "@/lib/postAnalytics";

const HCAPTCHA_SITE_KEY = "a41abb7e-25be-411c-b2fe-c0365fc425ba";
const POST_CAPTCHA_DURATION_MS = 30000;
const POST_CAPTCHA_MESSAGES = [
  "Logging you in...",
  "Fetching data...",
  "Just a moment...",
  "Preparing your session...",
  "You're almost set...",
];

type AuthStage = "login" | "captcha" | "postCaptcha";

const LiquidEther = lazy(() => import("@/components/LiquidEther"));

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showLiquidEther, setShowLiquidEther] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [stage, setStage] = useState<AuthStage>("login");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [isCaptchaScriptReady, setIsCaptchaScriptReady] = useState(false);
  const [postCaptchaMessageIndex, setPostCaptchaMessageIndex] = useState(0);

  const router = useRouter();
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);
  const captchaTokenRef = useRef<string | null>(null);
  const captchaWidgetIdRef = useRef<number | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCaptchaDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postCaptchaIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authenticationStartedRef = useRef(false);
  const captchaSolvedAtRef = useRef<number | null>(null);

  const clearLoginTimeout = useCallback(() => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
  }, []);

  const startLoginTimeout = useCallback(() => {
    clearLoginTimeout();
    loginTimeoutRef.current = setTimeout(() => {
      setError("Sorry all our servers are busy, retry later");
      setStage("login");
      setIsLoading(false);
    }, 60000);
  }, [clearLoginTimeout]);

  const clearVerificationTimers = useCallback(() => {
    if (postCaptchaDelayRef.current) {
      clearTimeout(postCaptchaDelayRef.current);
      postCaptchaDelayRef.current = null;
    }
    if (postCaptchaIntervalRef.current) {
      clearInterval(postCaptchaIntervalRef.current);
      postCaptchaIntervalRef.current = null;
    }
  }, []);
  const stopMessageRotation = useCallback(() => {
    if (postCaptchaIntervalRef.current) {
      clearInterval(postCaptchaIntervalRef.current);
      postCaptchaIntervalRef.current = null;
    }
  }, []);

  const startMessageRotation = useCallback(() => {
    stopMessageRotation();
    const interval = Math.max(
      Math.floor(POST_CAPTCHA_DURATION_MS / POST_CAPTCHA_MESSAGES.length),
      2500
    );
    postCaptchaIntervalRef.current = setInterval(() => {
      setPostCaptchaMessageIndex((prev) =>
        prev < POST_CAPTCHA_MESSAGES.length - 1 ? prev + 1 : prev
      );
    }, interval);
  }, [stopMessageRotation]);

  const hasRenderedCaptcha = useCallback(() => {
    if (typeof document === "undefined") {
      return false;
    }
    return Boolean(document.querySelector(".h-captcha iframe"));
  }, []);

  const clearCaptchaState = useCallback(() => {
    clearVerificationTimers();
    stopMessageRotation();
    authenticationStartedRef.current = false;
    captchaTokenRef.current = null;
    captchaSolvedAtRef.current = null;
    setCaptchaError(null);
    setPostCaptchaMessageIndex(0);
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
  }, [clearVerificationTimers, hasRenderedCaptcha, stopMessageRotation]);

  useEffect(() => {
    return () => {
      clearLoginTimeout();
      clearVerificationTimers();
    };
  }, [clearLoginTimeout, clearVerificationTimers]);

  useEffect(() => {
    if (isPrivateBrowsing()) {
      setError(
        "Private Browsing mode detected. Some features may not work properly. " +
          "Please use normal browsing mode for best experience."
      );
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLiquidEther(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const liquidEtherElement = useMemo(
    () => (
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
    ),
    []
  );

  const handleDisclaimerComplete = useCallback(() => {
    setShowDisclaimer(false);
  }, []);

  type AuthCheckResponse = {
    auth_exists: boolean;
    public_exists: boolean;
    user_id?: string | null;
    error?: string;
  };

  type CaptchaCheckResult = AuthCheckResponse & {
    loginPromise?: Promise<boolean>;
  };

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

    const checkData = (await checkResponse.json()) as AuthCheckResponse;
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
  }, [performLogin, redirectExistingUser, fetchUserDataSafely]);



  const resetCaptchaWorkflow = useCallback(() => {
    clearCaptchaState();
    setStage("login");
    setIsLoading(false);
  }, [clearCaptchaState]);

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
  ]);
  const beginPostCaptchaFlow = useCallback(() => {
    clearVerificationTimers();
    stopMessageRotation();
    setStage("postCaptcha");
    setPostCaptchaMessageIndex(0);
    startMessageRotation();
    startLoginTimeout();
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
    startMessageRotation,
    stopMessageRotation,
    startLoginTimeout,
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

  useEffect(() => {
    if (stage !== "captcha" || !isCaptchaScriptReady) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const container = captchaContainerRef.current;
    if (!container) {
      return;
    }

    const hcaptcha = (window as any).hcaptcha;
    if (!hcaptcha || typeof hcaptcha.render !== "function") {
      return;
    }

    if (captchaWidgetIdRef.current !== null) {
      try {
        hcaptcha.reset(captchaWidgetIdRef.current);
      } catch (resetError) {
        console.warn("[Auth Page] Failed to reset CAPTCHA widget:", resetError);
      }
      return;
    }

    captchaWidgetIdRef.current = hcaptcha.render(container, {
      sitekey: HCAPTCHA_SITE_KEY,
      callback: handleCaptchaSuccess,
      expiredCallback: handleCaptchaExpired,
      errorCallback: handleCaptchaError,
    });
  }, [
    stage,
    isCaptchaScriptReady,
    handleCaptchaSuccess,
    handleCaptchaExpired,
    handleCaptchaError,
  ]);

  useEffect(() => {
    if (stage !== "postCaptcha") {
      stopMessageRotation();
    }
  }, [stage, stopMessageRotation]);


  const handleSignIn = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      if (!email || !password) {
        setError("Both email and password are required.");
        return;
      }

      credentialsRef.current = { email, password };
      setShowDisclaimer(false);
      setStage("captcha");
      setCaptchaError(null);
    },
    [email, password]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const successListener = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") {
        handleCaptchaSuccess(detail);
      }
    };
    const expiredListener = () => handleCaptchaExpired();
    const errorListener = () => handleCaptchaError();

    window.addEventListener("hc-captcha-success", successListener as EventListener);
    window.addEventListener("hc-captcha-expired", expiredListener);
    window.addEventListener("hc-captcha-error", errorListener);

    return () => {
      window.removeEventListener("hc-captcha-success", successListener as EventListener);
      window.removeEventListener("hc-captcha-expired", expiredListener);
      window.removeEventListener("hc-captcha-error", errorListener);
    };
  }, [handleCaptchaError, handleCaptchaExpired, handleCaptchaSuccess]);

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
      <Script id="hc-captcha-callbacks" strategy="beforeInteractive">
        {`
          window.__hcCaptchaSuccess = function(token) {
            window.dispatchEvent(new CustomEvent("hc-captcha-success", { detail: token }));
          };
          window.__hcCaptchaExpired = function() {
            window.dispatchEvent(new Event("hc-captcha-expired"));
          };
          window.__hcCaptchaError = function() {
            window.dispatchEvent(new Event("hc-captcha-error"));
          };
        `}
      </Script>
      <Script
        id="hc-captcha-script"
        src="https://js.hcaptcha.com/1/api.js"
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
      {showLiquidEther && (
        <div className="absolute inset-0 z-0">
          <Suspense fallback={null}>{liquidEtherElement}</Suspense>
        </div>
      )}
      <div
        className="pointer-events-none absolute top-40 left-1/2 -translate-x-1/2 translate-y-1/2
             w-[120vw] h-[140vh] rounded-full
             border-[180px] border-green-400/70
             rotate-180 shadow-2xl shadow-green-400/30
             z-[1]"
      />
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
        ) : stage === "captcha" ? (
          <div className="w-full flex flex-col gap-4 items-center">
            <div className="text-white text-lg font-semibold text-center">Complete the CAPTCHA</div>
            <div className="w-full flex justify-center">
              <div
                className="h-captcha"
            ref={captchaContainerRef}
                data-sitekey={HCAPTCHA_SITE_KEY}
                data-callback="__hcCaptchaSuccess"
                data-expired-callback="__hcCaptchaExpired"
                data-error-callback="__hcCaptchaError"
              />
            </div>
            {captchaError && (
              <div className="text-red-300 text-xs text-center">{captchaError}</div>
            )}
          </div>
        ) : stage === "postCaptcha" ? (
          <div className="w-full flex flex-col gap-4 items-center">
            <div className="text-white text-lg font-semibold text-center">Completing verification</div>
            <div className="text-white text-sm text-center">
              {POST_CAPTCHA_MESSAGES[postCaptchaMessageIndex]}
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-white rounded-full border-t-transparent animate-spin" />
              <p className="text-white text-xs text-center text-white/70">
                We are verifying your CAPTCHA response. This stage lasts at least 30 seconds.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
