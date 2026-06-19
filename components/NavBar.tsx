"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function abbrev(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

const navLinks: { href: string; label: string; badge?: string }[] = [
  { href: "/start", label: "Start" },
  { href: "/economic-demo", label: "Demo" },
  { href: "/agents", label: "Marketplace" },
  { href: "/register", label: "Register" },
  { href: "/setup", label: "Setup" },
  { href: "/#verify-demo", label: "Verify" },
  { href: "/testers", label: "Testers", badge: "Help" },
  { href: "/faq", label: "FAQ", badge: "Help" },
  { href: "/playbook", label: "Playbook", badge: "New" },
  { href: "/planner", label: "Planner" },
  { href: "/runs", label: "History" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/onboarding", label: "Onboarding Lab" },
  { href: "/dashboard", label: "Dashboards" },
  { href: "/manager", label: "Manager", badge: "New" },
  { href: "/manager/discovery", label: "Discovery Review", badge: "New" },
  { href: "/specialist", label: "Specialist" },
  { href: "/attestation", label: "Attestation" },
  { href: "/consumer", label: "Consumer" },
  { href: "/audit", label: "Audit Trail" },
  { href: "/dogfood", label: "Dogfood", badge: "New" },
  { href: "/whitepaper", label: "Whitepaper", badge: "Docs" },
  { href: "/orchestrator", label: "Settings" },
];

const primaryHrefs = ["/start", "/economic-demo", "/agents", "/register", "/setup", "/#verify-demo"];
const primaryLinks = navLinks.filter((l) => primaryHrefs.includes(l.href));
const secondaryLinks = navLinks.filter((l) => !primaryHrefs.includes(l.href));

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
      className="h-9 px-4 rounded-lg text-sm font-medium text-black transition-opacity hover:opacity-80"
      style={{ background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)" }}
    >
      {abbrev(publicKey.toBase58())}
    </button>
  ) : (
    <WalletMultiButton
      style={{
        background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
        height: "36px",
        fontSize: "13px",
        borderRadius: "8px",
        padding: "0 16px",
      }}
    />
  );

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-page/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-base sm:text-lg text-white">
              Reddi Agent Protocol
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-5">
            <a
              href="https://x.com/reddiagent"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-white"
            >
              @reddiagent
            </a>
            {primaryLinks.map(({ href, label, badge }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link text-sm flex items-center gap-1.5 ${
                  pathname === href
                    ? "active-nav text-white font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {label}
                {badge && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent-purple/20 text-accent-purple font-medium leading-none">
                    {badge} Live
                  </span>
                )}
              </Link>
            ))}

            <details ref={desktopMoreRef} className="relative group">
              <summary className="list-none cursor-pointer text-sm text-muted-foreground hover:text-white select-none">
                More
              </summary>
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-white/10 bg-card/95 backdrop-blur p-2 shadow-xl z-50">
                {secondaryLinks.map(({ href, label, badge }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => {
                      if (desktopMoreRef.current) desktopMoreRef.current.open = false;
                    }}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      pathname === href ? "text-white bg-white/10" : "text-muted-foreground hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span>{label}</span>
                    {badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-purple/20 text-accent-purple font-medium leading-none">
                        {badge}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </details>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="md:hidden h-9 px-3 rounded-lg border border-white/15 text-sm text-white"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? "Close" : "Menu"}
            </button>

            <div className="hidden sm:flex items-center">{walletControl}</div>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden pb-4">
            <div className="rounded-lg border border-white/10 bg-card/90 p-3 space-y-2">
              <div className="sm:hidden pb-1">{walletControl}</div>

              <a
                href="https://x.com/reddiagent"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-white hover:bg-white/5"
              >
                <span>@reddiagent (X)</span>
              </a>

              {[...primaryLinks, ...secondaryLinks].map(({ href, label, badge }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                    pathname === href ? "text-white bg-white/10" : "text-muted-foreground hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span>{label}</span>
                  {badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-purple/20 text-accent-purple font-medium leading-none">
                      {badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
