import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Clarity City is not on Google Fonts; it ships as WOFF2 in VMware's @clr/city package (OFL).
const clarityCity = localFont({
  variable: "--font-clarity-city",
  src: [
    { path: "../node_modules/@clr/city/Webfonts/WOFF2/ClarityCity-Regular.woff2", weight: "400" },
    { path: "../node_modules/@clr/city/Webfonts/WOFF2/ClarityCity-Medium.woff2", weight: "500" },
    { path: "../node_modules/@clr/city/Webfonts/WOFF2/ClarityCity-SemiBold.woff2", weight: "600" },
    { path: "../node_modules/@clr/city/Webfonts/WOFF2/ClarityCity-Bold.woff2", weight: "700" },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Barbershop Virtual Queue",
  description: "Join your barbershop's queue from your phone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the `dark` class before hydration, which React would otherwise flag.
    <html
      lang="en"
      className={`${clarityCity.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
