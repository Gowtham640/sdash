/**
 * Maps portal slot / subject category strings to theory vs lab for UI accents.
 */
export type SubjectTypeAccent = "theory" | "lab";

export function getSubjectTypeAccent(raw: string | undefined | null): SubjectTypeAccent | null {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const s = String(raw).toLowerCase();
  if (s.includes("lab") || s.includes("practical")) {
    return "lab";
  }
  if (s.includes("theory")) {
    return "theory";
  }
  return null;
}
