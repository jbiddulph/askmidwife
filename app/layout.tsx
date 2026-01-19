import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ask Midwife",
  description: "Private, trusted support for pregnancy and maternal health.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${fraunces.variable} antialiased`}>
        <div className="min-h-screen bg-zinc-50">
          <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/90 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
              <Link
                className="font-[var(--font-display)] text-lg font-semibold text-zinc-900"
                href="/"
              >
                Ask Midwife
              </Link>
              <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-600">
                <Link
                  className="rounded-full border border-transparent px-3 py-2 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  href="/"
                >
                  Home
                </Link>
                <Link
                  className="rounded-full border border-transparent px-3 py-2 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  href="/profile"
                >
                  Profile
                </Link>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
