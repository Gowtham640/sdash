import { ReactNode } from "react";

interface StatChipProps {
  children: ReactNode;
  className?: string;
}

export const StatChip = ({ children, className = "" }: StatChipProps) => (
  <div className={`bg-sdash-surface-1 border border-white/[0.07] rounded-full px-4 py-2 flex items-center gap-2 shrink-0 ${className}`}>
    {children}
  </div>
);

export default StatChip;