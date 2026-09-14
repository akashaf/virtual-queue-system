import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { chooseLang } from "./actions";

const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "ms", label: "BM" },
];

/**
 * EN | BM, overriding whatever `Accept-Language` said. A form rather than a
 * client component, because the cookie it writes is what the next server render
 * reads — and it works before the page has hydrated.
 */
export function LanguageToggle({
  slug,
  lang,
  label,
}: {
  slug: string;
  lang: Lang;
  label: string;
}) {
  return (
    <form action={chooseLang} className="flex items-center justify-end gap-1">
      <input type="hidden" name="slug" value={slug} />
      <span className="sr-only" id="language-toggle-label">
        {label}
      </span>
      {LANGS.map(({ code, label: text }) => (
        <button
          key={code}
          type="submit"
          name="lang"
          value={code}
          aria-describedby="language-toggle-label"
          aria-current={code === lang ? "true" : undefined}
          lang={code}
          className={cn(
            "min-h-11 min-w-11 rounded-md px-3 text-sm font-medium",
            code === lang
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </form>
  );
}
