import Image from "next/image";
import ShinyText from '../components/ShinyText';
import LiquidEther from '../components/LiquidEther';

export default function Home() {
  return (
    <div className="relative font-sans grid grid-rows-[20px_1fr_20px] bg-black items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      {/* LiquidEther Background */}
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
      
      {/* Content */}
      <div className="relative z-10">
        <p className="text-white">HEY</p>
      </div>
      <div className="relative z-10">
        <ShinyText 
          text="HEY how are you" 
          disabled={false} 
          speed={3} 
          className='font-bold font-sans ' 
        />
      </div>
    </div>
  );
}
