interface TypeBadgeProps {
  type: "theory" | "lab" | "holiday" | "exam";
  label?: string;
}

const styles = {
  theory: "bg-sdash-accent/10 text-sdash-accent",
  lab: "bg-sdash-warning/10 text-sdash-warning",
  holiday: "bg-sdash-success/10 text-sdash-success",
  exam: "bg-sdash-danger/10 text-sdash-danger",
};

export const TypeBadge = ({ type, label }: TypeBadgeProps) => (
  <span className={`${styles[type]} rounded-full px-3 py-1 text-xs font-sora font-medium`}>
    {label || type.charAt(0).toUpperCase() + type.slice(1)}
  </span>
);

export default TypeBadge;