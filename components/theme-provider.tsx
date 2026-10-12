"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Light or dark from the device setting. There is deliberately no toggle. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
