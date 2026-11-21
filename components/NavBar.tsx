"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletSignIn } from "@/components/auth/WalletSignIn";
import ThemeToggle from "@/components/ThemeToggle";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function abbrev(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// Five primary destinations, named for what people come to do. Everything else
// sits under More so the bar reads like the marketing site's header.
const primaryLinks: { href: string; label: string }[] = [
  { href: "/sandbox", label: "Sandbox" },
  { href: "/agents", label: "Providers" },
  { href: "/register", label: "Run a provider" },
  { href: "/jobs", label: "My jobs" },
  { href: "/setup", label: "Docs" },
];

const secondaryLinks: { href: string; label: string }[] = [
  { href: "/start", label: "Start here" },
  { href: "/planner", label: "Planner" },
  { href: "/runs", label: "History" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/onboarding", label: "Provider onboarding" },
  { href: "/dashboard", label: "Dashboards" },
  { href: "/specialist", label: "Specialist" },
  { href: "/attestation", label: "Attestation" },
  { href: "/consumer", label: "Buyer dashboard" },
  { href: "/audit", label: "Audit trail" },
  { href: "/faq", label: "FAQ" },
  { href: "/playbook", label: "Playbook" },
  { href: "/adl", label: "ADL" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/orchestrator", label: "Settings" },
  { href: "/testers", label: "Testers" },
  { href: "/manager", label: "Manager" },
  { href: "/manager/discovery", label: "Discovery review" },
  { href: "/dogfood", label: "Dogfood" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return (
    <span aria-hidden="true" className="inline-flex w-[22px] flex-col gap-[3px]">
      <i className="block h-1 rounded-[1px] bg-ink" />
      <i className="block h-1 w-[70%] rounded-[1px] bg-brand-violet" />
      <i className="block h-1 w-[45%] rounded-[1px] bg-brand-green" />
    </span>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const { publicKey, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopMoreRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (desktopMoreRef.current?.open) {
      desktopMoreRef.current.open = false;
    }
  }, [pathname]);

  const walletControl = publicKey ? (
    <button
      onClick={() => disconnect()}
      title={publicKey.toBase58()}
      className="h-9 rounded border-2 border-ink px-4 text-sm font-bold text-ink hover:bg-ink hover:text-paper"
    >
      {abbrev(publicKey.toBase58())}
    </button>
  ) : (
    <WalletMultiButton
      style={{
        background: "var(--color-ink)",
        color: "var(--color-paper)",
        height: "38px",
        fontSize: "14px",
        fontWeight: 700,
        borderRadius: "4px",
        padding: "0 16px",
      }}
    />
  );

  return (
    <nav aria-label="Main" className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[72px]">
          <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
            <BrandMark />
            <span className="text-base sm:text-lg font-extrabold tracking-[-0.03em]">
              Reddi Agent Protocol
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden lg:flex items-center gap-6 text-[15px] font-semibold">
            {primaryLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className={`nav-link ${isActive(pathname, href) ? "active-nav" : "text-ink"}`}
              >
                {label}
              </Link>
            ))}

            <details ref={desktopMoreRef} className="relative group">
              <summary className="list-none cursor-pointer select-none text-ink hover:underline underline-offset-[5px]">
                More
              </summary>
              <div className="absolute right-0 mt-3 w-60 rounded-md border border-line bg-paper-raised p-2 shadow-card z-50">
                {secondaryLinks.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => {
                      if (desktopMoreRef.current) desktopMoreRef.current.open = false;
                    }}
                    aria-current={isActive(pathname, href) ? "page" : undefined}
                    className={`block rounded px-3 py-2 text-sm font-medium ${
                      isActive(pathname, href) ? "bg-well text-ink" : "text-ink hover:bg-well"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </details>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="lg:hidden h-10 px-4 rounded border-2 border-ink text-sm font-bold text-ink"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
            >
              {mobileOpen ? "Close" : "Menu"}
            </button>

            <ThemeToggle />
            <div className="hidden sm:flex items-center gap-2">
              <WalletSignIn />
              {walletControl}
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div id="mobile-menu" className="lg:hidden pb-4">
            <div className="rounded-md border border-line bg-paper-raised p-3 space-y-1">
              <div className="sm:hidden pb-2 flex flex-wrap items-center gap-2">
                {walletControl}
                <WalletSignIn />
              </div>
              {[...primaryLinks, ...secondaryLinks].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                  className={`block rounded px-3 py-2.5 text-[15px] font-semibold ${
                    isActive(pathname, href) ? "bg-well text-ink" : "text-ink hover:bg-well"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
