'use client';
import Image from "next/image";
import { useState, useEffect, lazy, Suspense } from "react";
import ShinyText from '../components/ShinyText';
import NavigationButton from '../components/NavigationButton';

// Lazy load LiquidEther to improve initial page load performance
const LiquidEther = lazy(() => import('../components/LiquidEther'));

export default function Home() {
  const [showLiquidEther, setShowLiquidEther] = useState(false);

  // Load LiquidEther after initial render to prioritize content loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLiquidEther(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative  bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
      {/* LiquidEther Background - Behind everything */}
      {showLiquidEther && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <Suspense fallback={null}>
            <LiquidEther
              colors={['#FFFFFF', '#FFFFFF', '#000000']}
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
          </Suspense>
        </div>
      )}

      {/* Content - Above LiquidEther */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-6 pointer-events-auto">
        <div className="text-white text-center text-3xl font-sora font-bold">College made easy</div>
        <div className="text-gray-200 text-sm font-sora font-light">Make the best decisions with the right context</div>
        <NavigationButton
          path="/auth"
          className="w-auto h-[4vh] bg-gray-950 rounded-2xl p-5 border border-gray-700 justify-center items-center flex font-sans text-sm font-semibold hover:p-5.5 hover:text-lg transition-all duration-300"
        >
          <ShinyText
            text="Enter"
            disabled={false}
            speed={3}
            className='custom-class'
          />
        </NavigationButton>
      </div>

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
      {/*<div className="relative z-10 w-[20vw] h-[20vh] backdrop-blur- bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora">HEY</div>*/}
    </div>
  );
}
