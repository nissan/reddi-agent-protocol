import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import DevnetModeBanner from "@/components/DevnetModeBanner";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600", "700", "900"],
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
