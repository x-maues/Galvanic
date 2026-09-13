import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";

export const metadata: Metadata = {
  title: "Galvanic — borrow against real-world assets, without the contagion",
  description:
    "Galvanic lets you borrow against a tokenized bond and volatile crypto in one account, and guarantees a crypto crash can never reach the bond. Not by policy — by construction.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Galvanic",
    description: "Your bond shouldn't be sold because your ETH crashed.",
    siteName: "Galvanic",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Galvanic",
    description: "Your bond shouldn't be sold because your ETH crashed.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
