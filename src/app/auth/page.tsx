"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { storePortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, removeStorageItem, isPrivateBrowsing } from "@/lib/browserStorage";

// Lazy load LiquidEther to improve initial page load performance
const LiquidEther = lazy(() => import("@/components/LiquidEther"));

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showLiquidEther, setShowLiquidEther] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [stage, setStage] = useState<
    | "login"
    | "delayBeforeSlider"
    | "loadingCaptcha"
    | "slider"
    | "delayBeforeCheckbox"
    | "checkbox"
    | "delayFinal"
  >("login");
  const [sliderValue, setSliderValue] = useState(0);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const router = useRouter();
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);

  // Check for Private Browsing mode on mount
  useEffect(() => {
    if (isPrivateBrowsing()) {
      setError(
        'Private Browsing mode detected. Some features may not work properly. ' +
        'Please use normal browsing mode for best experience.'
      );
    }
  }, []);

  // Load LiquidEther after initial render to prioritize content loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLiquidEther(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

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

  useEffect(() => {
    if (stage === "slider") {
      setSliderValue(0);
    } else if (stage === "checkbox") {
      setCheckboxChecked(false);
    }
  }, [stage]);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    credentialsRef.current = { email, password };
    setShowDisclaimer(false);
    try {
      const checkResponse = await fetch("/api/auth/check-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const checkData = await checkResponse.json();

      if (checkResponse.ok && checkData.exists) {
        setIsSuccess(true);
        setIsLoading(false);
        router.push("/dashboard");
        return;
      }
    } catch (err) {
      console.error("[Auth Page] Early user check failed:", err);
      setError("Unable to verify account existence. Please try again.");
      setIsLoading(false);
      return;
    }

    setStage("delayBeforeSlider");
    setSliderValue(0);
    setCheckboxChecked(false);
  };

  const performLogin = useCallback(async () => {
    const credentials = credentialsRef.current;
    if (!credentials) {
      setError("Credentials missing.");
      return false;
    }

    try {
      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });
      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
        setError(loginData.error || "Sign-in failed. Please try again.");
        return false;
      }

      const tokenStored = setStorageItem("access_token", loginData.data.session.access_token);
      const refreshStored = setStorageItem("refresh_token", loginData.data.session.refresh_token);
      const userStored = setStorageItem("user", JSON.stringify(loginData.data.user));
      if (!tokenStored || !refreshStored || !userStored) {
        setError("Failed to store session tokens.");
        return false;
      }

      const passwordStored = storePortalPassword(credentials.password);
      if (!passwordStored) {
        setError("Failed to preserve credentials.");
        return false;
      }

      removeStorageItem("user_semester");
      const loginTimestamp = Date.now();
      setStorageItem("login_timestamp", loginTimestamp.toString());
      setIsSuccess(true);
      return true;
    } catch (err) {
      console.error("[Auth Page] Login error:", err);
      setError("Network error during login.");
      return false;
    }
  }, []);

  const handleCaptchaContinue = useCallback(async () => {
    setVerifying(true);
    await delay(4000);

    const credentials = credentialsRef.current;
    if (!credentials) {
      setError("Credentials lost; please try again.");
      setVerifying(false);
      return;
    }

    try {
      const checkResponse = await fetch("/api/auth/check-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email }),
      });
      const checkData = await checkResponse.json();

      if (checkResponse.ok && checkData.exists) {
        await delay(4000);
        router.push("/dashboard");
        return;
      }

      const loginSuccess = await performLogin();
      if (loginSuccess) {
        await delay(4000);
        router.push("/dashboard");
      }
    } finally {
      setVerifying(false);
    }
  }, [performLogin, router]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (stage === "delayBeforeSlider") {
      timeout = setTimeout(() => setStage("loadingCaptcha"), 5000);
    } else if (stage === "loadingCaptcha") {
      timeout = setTimeout(() => setStage("slider"), 2000);
    } else if (stage === "delayBeforeCheckbox") {
      timeout = setTimeout(() => setStage("checkbox"), 4000);
    } else if (stage === "delayFinal") {
      timeout = setTimeout(() => {
        handleCaptchaContinue();
      }, 3000);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [stage, handleCaptchaContinue]);

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
      {showLiquidEther && (
        <div className="absolute inset-0 z-0">
          <Suspense fallback={null}>
            {liquidEtherElement}
          </Suspense>
        </div>
      )}

      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[80vw] md:w-[60vw] lg:w-[40vw] xl:w-[20vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-lg sm:text-xl md:text-2xl lg:text-3xl font-sora flex flex-col gap-6 sm:gap-8 md:gap-10 lg:gap-10 justify-center items-center">
        {showDisclaimer ? (
          <>
            <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-sora font-bold">Important</div>
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
            <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-sora font-bold">Sign In</div>

            <form
              onSubmit={handleSignIn}
              className="w-full flex flex-col gap-4"
            >
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
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
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
                className="w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-white rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 border border-gray-700 justify-center items-center flex font-sans text-sm text-gray-800 font-semibold hover:bg-gray-100 active:bg-gray-200 transition-all disabled:opacity-50 disabled:hover:bg-white cursor-pointer"
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
            {stage === "delayBeforeSlider" && (
              <p className="text-white text-base font-sora text-center">
                Preparing the human verification slider... please wait.
              </p>
            )}
            {stage === "loadingCaptcha" && (
              <p className="text-white text-base font-sora text-center">
                Loading the slider challenge...
              </p>
            )}
            {stage === "slider" && (
              <div className="w-full flex flex-col gap-4">
                <div className="text-white text-lg font-semibold text-center">Drag the slider to the right to prove you are human</div>
                <div className="bg-gray-900 rounded-full h-10 flex items-center px-3 border border-white/20">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderValue}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSliderValue(value);
                      if (value >= 100 && stage === "slider") {
                        setStage("delayBeforeCheckbox");
                      }
                    }}
                    className="w-full bg-transparent accent-white"
                  />
                </div>
                <div className="text-white text-xs text-center">
                  {sliderValue}% complete
                </div>
                <button
                  onClick={() => {
                    setSliderValue((prev) => {
                      const next = Math.min(prev + 20, 100);
                      if (next >= 100 && stage === "slider") {
                        setStage("delayBeforeCheckbox");
                      }
                      return next;
                    });
                  }}
                  className="w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-white rounded-2xl p-3 border border-gray-700 font-sans text-sm text-gray-800 font-semibold hover:bg-gray-100 transition-all"
                >
                  Slide
                </button>
              </div>
            )}
            {stage === "delayBeforeCheckbox" && (
              <p className="text-white text-base font-sora text-center">
                Processing the slider response... please wait.
              </p>
            )}
            {stage === "checkbox" && (
              <div className="w-full flex flex-col gap-4">
                <div className="text-white text-lg font-semibold text-center">Check the box to confirm you are human</div>
                <label className="flex items-center gap-3 bg-gray-900/70 border border-white/20 rounded-2xl px-4 py-3 w-full justify-between">
                  <input
                    type="checkbox"
                    checked={checkboxChecked}
                    onChange={(e) => {
                      setCheckboxChecked(e.target.checked);
                      if (e.target.checked) {
                        setStage("delayFinal");
                      }
                    }}
                    className="w-5 h-5 rounded border border-gray-500 accent-white bg-transparent"
                  />
                  <span className="text-white text-sm font-sora">I’m not a robot</span>
                </label>
                {verifying && (
                  <div className="text-white text-xs text-center">
                    Final verification in progress...
                  </div>
                )}
              </div>
            )}
            {stage === "delayFinal" && (
              <p className="text-white text-base font-sora text-center">
                Finalizing verification... please wait.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Decorative arcs */}
      <div
        className="absolute top-40 left-1/2 -translate-x-1/2 translate-y-1/2 z-20
        w-[100vw] h-[120vh] rounded-[50%] border-[200px]
        border-green-400
        rotate-180 shadow-2xl shadow-green-400/30 overflow-hidden"
      />

      {/* Outer glow */}
      <div className="absolute bottom-0 left-1/2 h-[600px] w-[600px] -translate-x-1/2 translate-y-1/2 rounded-full bg-green-500/20 blur-[100px] z-20" />
    </div>
  );
}
