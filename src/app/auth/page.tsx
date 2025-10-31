"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import LiquidEther from "@/components/LiquidEther";
import { Eye, EyeOff } from "lucide-react";
import { storePortalPassword } from "@/lib/passwordStorage";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();

  // Memoize LiquidEther to prevent re-renders on keystroke
  const liquidEtherComponent = useMemo(
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

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      console.log("[Auth Page] Signing in with email:", email);

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      console.log("[Auth Page] Response status:", response.status);

      const data = await response.json();
      console.log("[Auth Page] Response data:", data);

      if (!response.ok) {
        console.error(
          "[Auth Page] Sign-in failed:",
          data.error,
          `(${data.errorCode})`
        );
        setError(data.error || "Sign-in failed. Please try again.");
        setIsLoading(false);
        return;
      }

      // Store session and user info
      console.log("[Auth Page] Sign-in successful, storing session");
      localStorage.setItem(
        "access_token",
        data.data.session.access_token
      );
      localStorage.setItem(
        "refresh_token",
        data.data.session.refresh_token
      );
      localStorage.setItem("user", JSON.stringify(data.data.user));
      
      // Store portal password securely for session renewal
      const passwordStored = storePortalPassword(password);
      if (!passwordStored) {
        console.error('[Auth Page] Failed to store password!');
        setError(
          'Authentication successful, but failed to save credentials. ' +
          'Please check if cookies/storage are enabled in your browser settings.'
        );
        setIsLoading(false);
        return;
      }
      console.log('[Auth Page] Password stored and verified successfully');

      // Clear old cache data on fresh login (Option 1)
      localStorage.removeItem('unified_data_cache');
      localStorage.removeItem('unified_data_cache_timestamp');
      localStorage.removeItem('user_semester'); // Also clear semester cache
      console.log('[Auth Page] ✅ Cleared previous cache data for fresh fetch');

      // Store login timestamp to track when user logged in (Option 4)
      const loginTimestamp = Date.now();
      localStorage.setItem('login_timestamp', loginTimestamp.toString());
      console.log('[Auth Page] ✅ Stored login timestamp:', loginTimestamp);

      setIsSuccess(true);

      // DISABLED: Trigger background data prefetch (don't wait for it)
      // Prefetch disabled to prevent duplicate requests conflicting with dashboard load
      // console.log("[Auth Page] Triggering background data prefetch...");
      // fetch("/api/data/prefetch", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({
      //     access_token: data.data.session.access_token
      //   })
      // })
      //   .then(res => res.json())
      //   .then(result => {
      //     console.log("[Auth Page] Prefetch triggered:", result.message);
      //   })
      //   .catch(err => {
      //     console.log("[Auth Page] Prefetch error (non-critical):", err);
      //   });

      // Redirect to dashboard immediately (dashboard will fetch data normally)
      setTimeout(() => {
        console.log("[Auth Page] Redirecting to dashboard...");
        router.push("/dashboard");
      }, 500);
    } catch (err) {
      console.error("[Auth Page] Network/Parse error:", err);
      setError(
        "Network error. Please check your connection and try again. Check browser console for details."
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">{liquidEtherComponent}</div>

      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[80vw] md:w-[60vw] lg:w-[40vw] xl:w-[20vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-lg sm:text-xl md:text-2xl lg:text-3xl font-sora flex flex-col gap-6 sm:gap-8 md:gap-10 lg:gap-10 justify-center items-center">
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

          {isSuccess && (
            <div className="w-full p-3 rounded-lg bg-green-500/20 border border-green-500/50 text-green-200 text-xs font-semibold">
              ✓ Sign-in successful! Redirecting...
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isSuccess}
            className="w-full h-[6vh] sm:h-[5vh] md:h-[4.5vh] lg:h-[4vh] bg-white rounded-2xl p-3 sm:p-4 md:p-5 lg:p-5 border border-gray-700 justify-center items-center flex font-sans text-sm text-gray-800 font-semibold hover:bg-gray-100 active:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white cursor-pointer"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
                Signing in...
              </div>
            ) : isSuccess ? (
              "Success!"
            ) : (
              "Sign In"
            )}
          </button>
        </form>
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
