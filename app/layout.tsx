import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import DevnetModeBanner from "@/components/DevnetModeBanner";

// Both fonts are served from files in app/fonts (latin subset, variable weight,
// SIL Open Font License) so a build never depends on downloading them.
const dmSans = localFont({
  src: "./fonts/dm-sans-latin-wght-normal.woff2",
  variable: "--font-dm-sans",
  weight: "100 1000",
  style: "normal",
  display: "swap",
});

const fraunces = localFont({
  src: "./fonts/fraunces-latin-wght-normal.woff2",
  variable: "--font-fraunces",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Reddi Agent Protocol",
    template: "%s | Reddi Agent Protocol",
  },
  applicationName: "Reddi Agent Protocol",
  description: "Payments prove transfer; RAP Assurance proves paid work.",
  metadataBase: new URL("https://agent-protocol.reddi.tech"),
  openGraph: {
    title: "Reddi Agent Protocol",
    description: "Payments prove transfer; RAP Assurance proves paid work.",
    url: "https://agent-protocol.reddi.tech",
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
    <html lang="en" className="dark">
      <body
        className={`${dmSans.variable} ${fraunces.variable} antialiased min-h-screen bg-background font-sans`}
      >
        <WalletProvider>
          <NavBar />
          <DevnetModeBanner />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
