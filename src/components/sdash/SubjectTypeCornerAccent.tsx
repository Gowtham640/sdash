import type { SubjectTypeAccent } from "@/lib/subjectTypeAccent";
import { SUBJECT_CARD_RADIUS_PX } from "@/lib/subjectCardRadius";

/**
 * Top-right accent: theory = blue, lab = orange.
 * Straight segments use gradients into neutral border; curved corner uses a solid rounded border
 * so the stroke follows the arc (no gap at the literal corner).
 */
const REGION = "pointer-events-none absolute top-0 right-0 z-[1] h-14 w-14";

const GRADIENTS: Record<SubjectTypeAccent, { top: string; right: string }> = {
  theory: {
    top: "bg-gradient-to-r from-white/[0.07] via-blue-500/85 to-blue-500",
    right: "bg-gradient-to-b from-blue-500 via-blue-500/85 to-white/[0.07]",
  },
  lab: {
    top: "bg-gradient-to-r from-white/[0.07] via-orange-500/85 to-orange-500",
    right: "bg-gradient-to-b from-orange-500 via-orange-500/85 to-white/[0.07]",
  },
};

const CORNER_SOLID: Record<SubjectTypeAccent, string> = {
  theory: "border-blue-500",
  lab: "border-orange-500",
};

export function SubjectTypeCornerAccent({ variant }: { variant: SubjectTypeAccent }) {
  const g = GRADIENTS[variant];
  const r = SUBJECT_CARD_RADIUS_PX;
  return (
    <span className={REGION} aria-hidden>
      {/* Top straight segment — stops where the fillet begins (same inset as corner box width) */}
      <span
        className={`absolute top-0 left-0 h-[2px] ${g.top}`}
        style={{ right: `${r}px` }}
      />
      {/* Curved corner: border follows rounded-tr so the arc is continuous (no break) */}
      <span
        className={`box-border absolute top-0 right-0 z-[2] border-t-2 border-r-2 ${CORNER_SOLID[variant]} border-l-0 border-b-0 border-solid`}
        style={{
          width: `${r}px`,
          height: `${r}px`,
          borderTopRightRadius: `${r}px`,
        }}
      />
      {/* Vertical straight segment — only below the arc */}
      <span
        className={`absolute right-0 w-[2px] bottom-0 ${g.right}`}
        style={{ top: `${r}px` }}
      />
    </span>
  );
}
