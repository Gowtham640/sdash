import { ReactNode } from "react";
import { ArrowLeft, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";

interface TopAppBarProps {
  title: string;
  showBack?: boolean;
  rightAction?: ReactNode;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export const TopAppBar = ({ title, showBack, rightAction, isRefreshing, onRefresh }: TopAppBarProps) => {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-sdash-bg/80 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
      {showBack && (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="touch-target text-sdash-text-secondary"
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className="heading-1 text-sdash-text-primary flex-1">{title}</h1>
      {onRefresh && (
        <button onClick={onRefresh} aria-label="Refresh" className="touch-target text-sdash-text-secondary">
          <RotateCw size={18} className={isRefreshing ? "animate-spin-slow" : ""} />
        </button>
      )}
      {rightAction}
    </header>
  );
};

export default TopAppBar;