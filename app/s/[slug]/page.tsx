import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { fetchCustomerView } from "@/lib/customer/queue";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/device-cookie";
import { dictionaries, LANG_COOKIE, resolveLang } from "@/lib/i18n";
import { isInAppBrowser } from "@/lib/in-app-browser";
import { CustomerQueue } from "./customer-queue";
import { LanguageToggle } from "./language-toggle";

export async function generateMetadata({
  params,
}: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Join the queue",
    // So Add to Home Screen opens this page as an app (./app.webmanifest).
    manifest: `/s/${slug}/app.webmanifest`,
  };
}

/**
 * The QR code's target, and the whole Customer experience.
 *
 * A Shop that does not exist and a Deactivated Shop look identical here on
 * purpose: a printed QR code outlives the Shop it was printed for, and a
 * Customer holding an old one needs the same answer either way.
 */
export default async function CustomerPage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const lang = resolveLang(
    cookieStore.get(LANG_COOKIE)?.value,
    headerList.get("accept-language"),
  );
  const dict = dictionaries[lang];
  const userAgent = headerList.get("user-agent");

  const cookieValue = cookieStore.get(DEVICE_COOKIE)?.value;
  const view = await fetchCustomerView(
    slug,
    isDeviceId(cookieValue) ? cookieValue : null,
  );

  return (
    // The root layout is English; this subtree may not be.
    <main
      lang={lang}
      className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-6"
    >
      <LanguageToggle slug={slug} lang={lang} label={dict.langToggleLabel} />

      {/* Above any state (frontend.md §3.1): these webviews get no Web Push,
          and some of them drop the page as soon as the Customer switches away. */}
      {isInAppBrowser(userAgent) ? (
        <Alert>
          <AlertTitle className="line-clamp-none">{dict.inAppBrowserWarning}</AlertTitle>
        </Alert>
      ) : null}

      {view?.shop.isActive ? (
        <CustomerQueue
          slug={slug}
          initialView={view}
          dict={dict}
          userAgent={userAgent}
        />
      ) : (
        <p role="status" className="my-auto text-center text-lg text-muted-foreground">
          {dict.shopUnavailable}
        </p>
      )}
    </main>
  );
}
