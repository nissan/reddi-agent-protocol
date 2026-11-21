type Status = "not-started" | "in-progress" | "complete";

interface Props {
  number: number;
  title: string;
  status?: Status;
  description?: string;
}

export default function StepIndicator({
  number,
  title,
  status = "not-started",
  description,
}: Props) {
  const statusColors = {
    "not-started": "border-white/20 text-muted-foreground bg-transparent",
    "in-progress": "border-brand-violet text-brand-violet bg-brand-violet/10",
    "complete": "border-brand-green text-brand-green bg-brand-green/10",
  };

  const statusIcon = {
    "not-started": number.toString(),
    "in-progress": "◐",
    "complete": "✓",
  };

  return (
    <div className="flex items-start gap-4">
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center
                    text-sm font-bold ${statusColors[status]}`}
      >
        {statusIcon[status]}
      </div>
      <div className="pt-1">
        <div className={`font-semibold ${status === "complete" ? "text-brand-green" : "text-foreground"}`}>
          {title}
        </div>
        {description && (
          <div className="text-sm text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
    </div>
  );
}
