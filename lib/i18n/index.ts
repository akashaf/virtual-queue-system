import { en, type Dictionary } from "./en";
import { ms } from "./ms";

export type { Dictionary };

export const LANG_COOKIE = "vq_lang";

export const dictionaries = { en, ms } satisfies Record<string, Dictionary>;

export type Lang = keyof typeof dictionaries;

function isLang(value: string | undefined): value is Lang {
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
