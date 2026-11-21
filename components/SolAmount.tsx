interface Props {
  lamports: number;
  className?: string;
  showUnit?: boolean;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

export function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol < 0.0001) return sol.toFixed(8);
  if (sol < 0.01) return sol.toFixed(6);
  if (sol < 1) return sol.toFixed(4);
  return sol.toFixed(3);
}

export default function SolAmount({ lamports, className = "", showUnit = true }: Props) {
  return (
    <span className={className}>
      <span style={{ color: "var(--color-brand-green)" }} className="font-mono font-semibold">
        {formatSol(lamports)}
      </span>
      {showUnit && (
        <span className="ml-1 text-muted-foreground text-xs">SOL</span>
      )}
    </span>
  );
}
