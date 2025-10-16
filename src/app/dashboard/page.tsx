import Image from "next/image";
import LiquidEther from "@/components/LiquidEther";

export default function Home() {
  return (
    <div className="relative  bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="relative p-7 z-10 w-[20vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center"></div>
        <div className="text-white text-4xl font-sora font-bold">HEY! Welcome to your Dashboard</div>
    </div>
  );
}
