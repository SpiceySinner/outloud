import type { Metadata } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const title = "OutLoud";
const description = "Learn to actually speak Spanish, not just understand it.";
const url = "https://outloud-beta.iamexman.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title,
  description,
  applicationName: title,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title,
    description,
    url,
    siteName: title,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${newsreader.variable} ${schibsted.variable}`}>{children}</body>
    </html>
  );
}
