import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export const EmptyState = ({ icon: Icon, title, description, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
    <Icon size={64} className="text-sdash-text-muted mb-6" />
    <h2 className="heading-2 text-sdash-text-primary mb-2">{title}</h2>
    <p className="text-sm text-sdash-text-secondary max-w-[280px] mb-6">{description}</p>
    {action && (
      <button
        onClick={action.onClick}
        className="bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full px-6 py-3 touch-target active:scale-[0.98] transition-transform duration-100"
      >
        {action.label}
      </button>
    )}
  </div>
);

export default EmptyState;