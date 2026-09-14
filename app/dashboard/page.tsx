import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchOwnerQueue } from "@/lib/owner/queue";
import { QueueBoard } from "./queue-board";

export const metadata: Metadata = { title: "Queue" };

/** The Owner's live Queue: who is here, in what order, and who is in a chair. */
export default async function DashboardPage() {
  const queue = await fetchOwnerQueue();
  // The layout turns this Owner away too, but both render at once, so the page
  // has to survive a Shop that was switched off mid-session on its own.
  if (!queue) redirect("/login?error=inactive");

  return <QueueBoard initialQueue={queue} />;
}
