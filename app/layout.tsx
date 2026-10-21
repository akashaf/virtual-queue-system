import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { NONCE_HEADER } from "@/lib/csp";
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

export const metadata: Metadata = {
  title: "Barbershop Virtual Queue",
  description: "Join your barbershop's queue from your phone.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading the request makes every page render per request, which a nonce
  // needs: a page built ahead of time would carry a stale one (third-party.md §9).
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    // next-themes sets the `dark` class before hydration, which React would otherwise flag.
    <html
      lang="en"
      className={`${clarityCity.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
