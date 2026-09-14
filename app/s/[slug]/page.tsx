import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { fetchCustomerView } from "@/lib/customer/queue";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/device-cookie";
import { dictionaries, LANG_COOKIE, resolveLang } from "@/lib/i18n";
import { CustomerQueue } from "./customer-queue";
import { LanguageToggle } from "./language-toggle";

export const metadata: Metadata = { title: "Join the queue" };

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

  const cookieValue = cookieStore.get(DEVICE_COOKIE)?.value;
  const view = await fetchCustomerView(
    slug,
    isDeviceId(cookieValue) ? cookieValue : null,
  );

  return (
    // The root layout is English; this subtree may not be.
    <main
      lang={lang}
      className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8"
    >
      <LanguageToggle slug={slug} lang={lang} label={dict.langToggleLabel} />

      {view?.shop.isActive ? (
        <CustomerQueue slug={slug} initialView={view} dict={dict} />
      ) : (
        <p role="status" className="my-auto text-center text-lg text-muted-foreground">
          {dict.shopUnavailable}
        </p>
      )}
    </main>
  );
}
