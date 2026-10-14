import { redirect } from "next/navigation";

/**
 * Customers only ever arrive through a Shop's QR code, so the bare domain is the
 * Owner's way in. `/login` sends an Owner who is already signed in on to the
 * dashboard, so that rule lives in one place. Temporary, so that `/` can serve a
 * page again without browsers having cached the redirect.
 */
export default function Home() {
  redirect("/login");
}
