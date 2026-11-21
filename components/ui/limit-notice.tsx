import type { HTMLAttributes, ReactNode } from "react";

/**
 * One look for every "what is true today" message: devnet only, fee planned,
 * readiness gaps, and warnings before an action the person may regret.
 *
 * - `limit`: a standing boundary of the product (devnet only, fee planned).
 * - `warning`: something about to happen that the person should know first.
 *
 * Text is ink on paper in both themes, so it meets 4.5:1; the tone shows in
 * the left rule and the label, never in low-contrast tinted text.
 */
type Tone = "limit" | "warning";

type Props = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  tone?: Tone;
  /** Short label shown first, for example "Devnet only". */
  title?: ReactNode;
  children: ReactNode;
  /** Render as a paragraph when the notice is a single sentence inside running text. */
  as?: "div" | "p";
};

const RULE: Record<Tone, string> = {
  limit: "border-l-ink",
  warning: "border-l-amber-300",
};

const LABEL: Record<Tone, string> = {
  limit: "text-ink",
  warning: "text-amber-300",
};

export function LimitNotice({ tone = "limit", title, children, as = "div", className = "", ...rest }: Props) {
  const Tag = as;
  return (
    <Tag
      data-limit-tone={tone}
      className={`rounded border border-line-strong border-l-4 ${RULE[tone]} bg-paper-raised px-4 py-3 text-sm leading-6 text-ink ${className}`}
      {...rest}
    >
      {title ? (
        <>
          <strong className={`font-bold ${LABEL[tone]}`}>{title}</strong>{" "}
        </>
      ) : null}
      {children}
    </Tag>
  );
}
