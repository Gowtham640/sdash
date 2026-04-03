import { useState, ReactNode, Children, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";

interface SwipeableCardsProps {
  children: ReactNode;
  className?: string;
}

export const SwipeableCards = ({ children, className = "" }: SwipeableCardsProps) => {
  const items = Children.toArray(children);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const paginate = useCallback((newDirection: number) => {
    if (items.length <= 1) return;
    const next = (index + newDirection + items.length) % items.length;
    setDirection(newDirection);
    setIndex(next);
  }, [index, items.length]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 50;
    if (info.offset.x < -threshold) paginate(1);
    else if (info.offset.x > threshold) paginate(-1);
  };

  // Short tween + small slide offset: keeps fade in/out but feels immediate
  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 72 : -72, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -72 : 72, opacity: 0 }),
  };

  const snapTransition = {
    opacity: { duration: 0.09, ease: "easeOut" as const },
    x: { type: "tween" as const, duration: 0.11, ease: [0.4, 0, 0.2, 1] as const },
  };

  return (
    <div className={`relative ${className}`}>
      <div className="overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={index}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={snapTransition}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            onDragEnd={handleDragEnd}
            className="w-full"
          >
            {items[index]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dot indicators */}
      <div className="flex items-center justify-center mt-2">
        <div className="flex items-center gap-2">
          {items.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                i === index ? "bg-sdash-accent w-4" : "bg-sdash-text-muted/40"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Index/total text removed (UX request) */}
    </div>
  );
};

export default SwipeableCards;