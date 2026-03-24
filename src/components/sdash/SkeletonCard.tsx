interface SkeletonCardProps {
  className?: string;
}

export const SkeletonCard = ({ className = "" }: SkeletonCardProps) => (
  <div className={`glass-card p-6 space-y-4 animate-pulse ${className}`}>
    <div className="h-4 w-2/3 bg-white/[0.04] rounded-md" />
    <div className="h-3 w-1/2 bg-white/[0.04] rounded-md" />
    <div className="h-12 w-1/3 bg-white/[0.04] rounded-md" />
    <div className="h-2 w-full bg-white/[0.04] rounded-md" />
  </div>
);

export default SkeletonCard;