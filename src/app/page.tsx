'use client';
import Image from "next/image";
import ShinyText from '../components/ShinyText';
import LiquidEther from '../components/LiquidEther';
import NavigationButton from '../components/NavigationButton';

export default function Home() {
  return (
    <div className="relative  bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
      {/* LiquidEther Background - Behind everything */}
      <div className="absolute inset-0 z-0">
        <LiquidEther
          colors={[ '#FFFFFF', '#FFFFFF', '#000000' ]}
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
      </div>

      {/* Content - Above LiquidEther */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-6">
        <div className="text-white text-4xl font-sora font-bold">Informed Decisions are Right decisions</div>
        <div className="text-gray-200 text-xl font-sora font-light">Make the best decisions with the right context</div>
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

      {/* Arcs - Above LiquidEther but below content */}
      <div className="absolute top-60 left-1/2 -translate-x-1/2 translate-y-1/2 z-20
        w-[100vw] h-[120vh] rounded-[50%] border-[100px]
        border-green-400
        rotate-180 shadow-2xl shadow-green-400/30 overflow-hidden"
      />
      <div className="absolute top-40 left-1/2 -translate-x-1/2 translate-y-1/2 z-20
        w-[100vw] h-[120vh] rounded-[50%] border-[100px]
        border-green-400
        rotate-180 shadow-2xl shadow-green-400/30 overflow-hidden"
      />
       {/* Outer glow */}
       <div className="absolute bottom-0 left-1/2 h-[600px] w-[600px] -translate-x-1/2 translate-y-1/2 rounded-full bg-green-500/20 blur-[100px] z-20" />
      {/*<div className="relative z-10 w-[20vw] h-[20vh] backdrop-blur- bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora">HEY</div>*/}
    </div>
  );
}
