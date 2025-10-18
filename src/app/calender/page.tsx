'use client';
import React, { useState } from "react";
import Image from "next/image";
import LiquidEther from "@/components/LiquidEther";
import { Calendar } from "@/components/ui/calendar"

export default function CalendarPage() {
    const [date, setDate] = useState<Date | undefined>(new Date())
  return (
    <div className="relative bg-black items-center  min-h-screen flex flex-col overflow-hidden pt-10 gap-16">
        <div className="text-white text-4xl font-sora font-bold"> Academic Calendar 25-26 ODD </div>
        <div className="relative p-4 z-10 w-[90vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="relative p-4 z-10 w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-5 justify-center items-center">
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">DO 1</p>
            </div>
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">DO 2</p>
            </div>
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">DO 3</p>
            </div>
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">DO 4</p>
            </div>
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">DO 5</p>
            </div>
            <div className="relative p-4 z-10 w-[56vw] h-auto backdrop-blur bg-green-500/80 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">Holiday</p>
            </div>
            <div className="relative  p-4 z-10 w-[56vw] h-auto backdrop-blur bg-green-500/80 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-row gap-10 justify-between items-center">
                <p className="text-white text-xl font-sora font-bold">Date</p>
                <p className="text-white text-xl font-sora ">Content</p>
                <p className="text-white text-xl font-sora font-bold">Holiday</p>
            </div>
          </div> 
          
        </div>
    </div>
  );
}
