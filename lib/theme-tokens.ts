const PROPERTIES =
  "bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|shadow|decoration|divide|accent|caret|placeholder";
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe";

const FIXED_COLOUR = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*(?:${PROPERTIES})-` +
    String.raw`(?:(?:${PALETTE})-\d{2,3}|white|black|\[(?:#|rgb|hsl|oklch|oklab|color)[^\]]*\])` +
    String.raw`(?:\/\d+)?(?![\w-])`,
  "g",
);

/**
 * Tailwind classes in `source` that hard-code a colour instead of using a theme token
 * (`bg-primary`, `text-status-called`, …). Screens must use tokens only, so a Shop's look
 * can be changed later by overriding tokens.
 */
export function findFixedColours(source: string): string[] {
  return source.match(FIXED_COLOUR) ?? [];
}
