import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// Approved type pairing: Hanken Grotesk (body) + Space Grotesk (display).
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "10xConnect — Safety-first LinkedIn + email outreach",
  description:
    "Run personalized, multi-step LinkedIn and email sequences at scale — with a real safety engine that keeps your accounts healthy.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning on <html> and <body>: browser extensions
    // (Grammarly, Dark Reader, crxemulator, etc.) inject attributes onto these
    // elements before React hydrates, which otherwise trips a hydration
    // attribute mismatch. It suppresses the diff on each element only — real
    // mismatches on descendants still surface.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hanken.variable} ${spaceGrotesk.variable}`}
    >
      <body suppressHydrationWarning className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
