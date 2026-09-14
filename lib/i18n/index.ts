import { en, type Dictionary } from "./en";
import { ms } from "./ms";

export type { Dictionary };

export const LANG_COOKIE = "vq_lang";

/** The Customer picks a language for good; a year outlives any one visit. */
export const LANG_COOKIE_MAX_AGE = 31_536_000;

export const dictionaries = { en, ms } satisfies Record<string, Dictionary>;

export type Lang = keyof typeof dictionaries;

export function isLang(value: string | undefined): value is Lang {
  return value !== undefined && Object.hasOwn(dictionaries, value);
}

/** Picks the customer-page language: the `vq_lang` cookie first, then Accept-Language, then English. */
export function resolveLang(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Lang {
  if (isLang(cookieValue)) return cookieValue;

  const byPreference = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return {
        primary: tag.split("-")[0].toLowerCase(),
        q: q ? Number(q.trim().slice(2)) : 1,
      };
    })
    .filter((entry) => !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { primary } of byPreference) {
    if (isLang(primary)) return primary;
  }
  return "en";
}

/**
 * Fills `{name}` placeholders in a translation. Deliberately the whole of our
 * i18n machinery: the Customer page has one plural to make and no dates to
 * format, so a library would be more to keep in step than the dictionaries are.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}
