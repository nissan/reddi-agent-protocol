"use client";

interface Props {
  score: number | null; // null = unrated
  count?: number;
  showCount?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function ReputationStars({
  score,
  count,
  showCount = false,
  size = "md",
}: Props) {
  const sizeClass = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  }[size];

  if (score === null || score === undefined) {
    return (
      <span className={`${sizeClass} text-muted-foreground italic`}>
        Unrated
      </span>
    );
  }

  const full = Math.floor(score);
  const partial = score - full;
  const empty = 5 - Math.ceil(score);

  return (
    <span className={`inline-flex items-center gap-1 ${sizeClass}`}>
      {Array.from({ length: full }).map((_, i) => (
        <span key={`f${i}`} style={{ color: "var(--color-brand-green)" }}>★</span>
      ))}
      {partial >= 0.25 && partial < 0.75 && (
        <span style={{ color: "var(--color-brand-green)" }} className="opacity-60">★</span>
      )}
      {partial >= 0.75 && (
        <span style={{ color: "var(--color-brand-green)" }}>★</span>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <span key={`e${i}`} className="text-muted-foreground/40">★</span>
      ))}
      <span className="ml-1 text-muted-foreground text-xs">
        {score.toFixed(1)}
        {showCount && count !== undefined && ` (${count})`}
      </span>
    </span>
  );
}
