import { ReactNode } from "react";
import { getSubjectTypeAccent } from "@/lib/subjectTypeAccent";
import { SubjectTypeCornerAccent } from "@/components/sdash/SubjectTypeCornerAccent";

interface GlassCardProps {
  children: ReactNode;
  elevated?: boolean;
  className?: string;
  onClick?: () => void;
  /** Raw category / slot type (e.g. Theory, Lab) — shows top-right corner accent when recognized */
  subjectCategory?: string | null;
}

export const GlassCard = ({
  children,
  elevated,
  className = "",
  onClick,
  subjectCategory,
}: GlassCardProps) => {
  const accent = subjectCategory != null ? getSubjectTypeAccent(subjectCategory) : null;

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden ${elevated ? "glass-card-elevated" : "glass-card"} ${
        accent ? "!rounded-[12px]" : ""
      } ${className}`}
    >
      {accent === "theory" && <SubjectTypeCornerAccent variant="theory" />}
      {accent === "lab" && <SubjectTypeCornerAccent variant="lab" />}
      {children}
    </div>
  );
};

export default GlassCard;