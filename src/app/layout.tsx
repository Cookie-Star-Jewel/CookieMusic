import type { Metadata } from "next";
import { Changa_One, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The clone target loads "Changa One:400,400italic" via WebFont.load().
const changaOne = Changa_One({
  variable: "--font-changa-one",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Karl",
  description: "I'm Karl, a motion designer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${changaOne.variable} h-full antialiased`}
    >
      <head>
        {/*
          Chinese lyric lines need real CJK glyphs and a 900 weight. Loading Noto
          Sans SC through a stylesheet (instead of next/font) keeps the build from
          downloading the whole ~10MB/weight CJK family: Google splits it into
          unicode-range slices and the browser only fetches what the page uses.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout applies to every route */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
