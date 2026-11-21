"use client";

import { useEffect, useState } from "react";

// Auto follows the operating system (light by day, dark when the system
// switches). Light and Dark pin the choice; it is kept in localStorage and
// applied before first paint by the inline script in app/layout.tsx.
type ThemeChoice = "auto" | "light" | "dark";

const ORDER: ThemeChoice[] = ["auto", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = { auto: "Auto", light: "Light", dark: "Dark" };
export const THEME_STORAGE_KEY = "rap-theme";

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "auto") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
}

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (choice === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (choice === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("auto");

  useEffect(() => {
    // Sync with the value the inline script applied before hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(readChoice());
  }, []);

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-choice={choice}
      onClick={() => {
        applyChoice(next);
        setChoice(next);
      }}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[choice]}${choice === "auto" ? " (follows your system)" : ""}`}
      className={`inline-flex h-9 items-center gap-1.5 rounded border-2 border-line-strong px-2.5 text-sm font-semibold text-ink hover:border-ink ${className}`}
    >
      <ThemeIcon choice={choice} />
      <span>{LABEL[choice]}</span>
    </button>
  );
}
