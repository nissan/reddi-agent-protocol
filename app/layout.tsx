import type { Metadata } from "next";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import DevnetModeBanner from "@/components/DevnetModeBanner";
import Analytics from "@/components/analytics/Analytics";
import VercelAnalytics from "@/components/analytics/VercelAnalytics";
import { ANALYTICS_ENABLED } from "@/lib/analytics/enabled";

// Applies a saved Light or Dark choice before first paint. With no saved
// choice the page follows the system setting (prefers-color-scheme).
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("rap-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export const metadata: Metadata = {
  title: {
    default: "Reddi Agent Protocol",
    template: "%s | Reddi Agent Protocol",
  },
  applicationName: "Reddi Agent Protocol",
  description: "Payments prove transfer; RAP Assurance proves paid work.",
  metadataBase: new URL("https://app.agent-protocol.reddi.tech"),
  openGraph: {
    title: "Reddi Agent Protocol",
    description: "Payments prove transfer; RAP Assurance proves paid work.",
    url: "https://app.agent-protocol.reddi.tech",
    siteName: "Reddi Agent Protocol",
    images: [{ url: "/icon.png", width: 1024, height: 1024, alt: "Reddi Agent Protocol logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reddi Agent Protocol",
    description: "Payments prove transfer; RAP Assurance proves paid work.",
    creator: "@reddiagent",
    site: "@reddiagent",
    images: ["/icon.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className="antialiased min-h-screen bg-background font-sans text-foreground"
      >
        <WalletProvider>
          <NavBar />
          <DevnetModeBanner />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
          <Footer />
        </WalletProvider>
        {ANALYTICS_ENABLED && <Analytics />}
        {/* Only Vercel builds count visits: local dev and CI would load Vercel's debug script from another host. */}
        {process.env.VERCEL === "1" && <VercelAnalytics />}
      </body>
    </html>
  );
}
