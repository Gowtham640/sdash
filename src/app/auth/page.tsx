import Image from "next/image";
import LiquidEther from "@/components/LiquidEther";
import Link from "next/link";

export default function Home() {
  return (
    <div className="relative  bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
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
      <div className="relative p-7 z-10 w-[20vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
        <div className="text-white text-4xl font-sora font-bold">Sign In</div>
        <form className="w-full flex flex-col gap-4">
            <input type="email" placeholder="Email" className="active:outline-none focus:outline-none w-full h-[4vh] bg-gray-950/0 rounded-2xl p-5 border border-gray-700 justify-center items-center flex font-sans text-sm font-semibold " />
            <input type="password" placeholder="Password" className="active:outline-none focus:outline-none w-full h-[4vh] bg-gray-950/0 rounded-2xl p-5 border border-gray-700 justify-center items-center flex font-sans text-sm font-semibold " />
            
        </form>
        <Link href="/dashboard" className="w-full h-[4vh] bg-white rounded-2xl p-5 border border-gray-700 justify-center items-center flex font-sans text-sm text-gray-800 font-semibold ">Sign In</Link>
      </div>
      {/* Arcs - Above LiquidEther but below content */}
      
      <div className="absolute top-40 left-1/2 -translate-x-1/2 translate-y-1/2 z-20
        w-[100vw] h-[120vh] rounded-[50%] border-[200px]
        border-green-400
        rotate-180 shadow-2xl shadow-green-400/30 overflow-hidden"
      />
       {/* Outer glow */}
       <div className="absolute bottom-0 left-1/2 h-[600px] w-[600px] -translate-x-1/2 translate-y-1/2 rounded-full bg-green-500/20 blur-[100px] z-20" />
    </div>
  );
}
