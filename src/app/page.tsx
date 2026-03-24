"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <div className="min-h-screen bg-sdash-bg flex flex-col items-center justify-center px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-transparent rounded-[8px] flex items-center justify-center overflow-hidden">
            <Image
              src="/sdashTransparentLogo.png"
              alt="SDash logo"
              className="w-30 h-20 object-contain"
              width={70}
              height={70}
              priority
            />
          </div>
          <span className="font-sora font-bold text-[32px] text-sdash-text-primary tracking-tight">SDash</span>
        </div>

        <h1 className="font-sora font-semibold text-4xl text-sdash-text-primary tracking-[-0.02em] mb-4 leading-tight">
          Your academics,
          <br />
          finally clear.
        </h1>

        <p className="font-sora text-base text-sdash-text-secondary mb-10">
          Attendance, timetable, marks — all in one place.
        </p>

        <Link
          href="/auth"
          className="inline-flex bg-sdash-accent text-sdash-text-primary font-sora font-medium text-xl rounded-full px-8 py-3 touch-target hover:bg-indigo-400 transition-colors duration-150 active:scale-[0.98] transition-transform"
        >
          Get started
        </Link>
      </motion.div>
    </div>
  );
}
