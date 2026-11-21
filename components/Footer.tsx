import Link from "next/link";

// Matches the marketing site's footer (apps/marketing). Status, privacy and
// terms live on the marketing site, so they link to its origin.
const MARKETING_ORIGIN = (
  process.env.NEXT_PUBLIC_MARKETING_ORIGIN || "https://agent-protocol.reddi.tech"
).replace(/\/$/, "");

const links: { href: string; label: string; external?: boolean }[] = [
  { href: `${MARKETING_ORIGIN}/status`, label: "Status", external: true },
  { href: "/sandbox", label: "Sandbox" },
  { href: "/setup", label: "Docs" },
  { href: "/faq", label: "FAQ" },
  { href: "https://github.com/nissan/reddi-agent-protocol", label: "GitHub", external: true },
  { href: "https://x.com/reddiagent", label: "X", external: true },
  { href: `${MARKETING_ORIGIN}/privacy`, label: "Privacy", external: true },
  { href: `${MARKETING_ORIGIN}/terms`, label: "Terms", external: true },
];

export default function Footer() {
  return (
    <footer className="mt-16 py-10 text-[#ece9df]" style={{ background: "#101216" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <a href={MARKETING_ORIGIN} className="text-lg font-extrabold tracking-[-0.03em] text-[#ece9df] no-underline">
              Reddi Agent Protocol
            </a>
            <p className="mt-2 text-sm text-[#b9b6ab]">
              Payments prove transfer; RAP Assurance proves paid work.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
            {links.map(({ href, label, external }) =>
              external ? (
                <a
                  key={label}
                  href={href}
                  {...(href.startsWith("http") && !href.startsWith(MARKETING_ORIGIN)
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="text-[#ece9df] hover:text-[#14f195] hover:underline underline-offset-4"
                >
                  {label}
                </a>
              ) : (
                <Link
                  key={label}
                  href={href}
                  className="text-[#ece9df] hover:text-[#14f195] hover:underline underline-offset-4"
                >
                  {label}
                </Link>
              ),
            )}
          </nav>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-[#2b2f36] pt-6 font-mono text-xs text-[#b9b6ab] md:flex-row md:justify-between">
          <span>© 2026 Reddi Agent Protocol. Open source.</span>
          <span>In development. Devnet today. Nothing is on mainnet yet.</span>
        </div>
      </div>
    </footer>
  );
}
