"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light or dark from the device setting. There is deliberately no toggle.
 *
 * `nonce` is this request's Content-Security-Policy nonce, for the inline script
 * that sets the class before the page paints.
 */
export function ThemeProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
