import { describe, expect, test } from "vitest";
import type { CustomerView } from "@/lib/customer/view";
import {
  acknowledgeCalled,
  initialPageAlerts,
  isHeadsUpReached,
  nextPageAlerts,
  NO_PAGE_ALERTS,
  type PageAlerts,
} from "./alerts";

type Ticket = NonNullable<CustomerView["ticket"]>;

/** A view with a threshold of 2, holding the given Ticket (or none). */
function view(ticket: Partial<Ticket> | null): CustomerView {
  return {
    shop: {
      id: "s-1",
      name: "Kedai Ali",
      isActive: true,
      joiningState: "open",
      waitingCount: 5,
      headsUpThreshold: 2,
    },
    ticket: ticket && {
      id: "t-1",
      number: 17,
      status: "waiting",
      position: 5,
      lastCallChoice: null,
      carriedOver: false,
      removedReason: null,
      canRejoin: false,
      ...ticket,
    },
  };
}

/** Feeds a page one refetch after another, as the customer page does. */
function watch(...views: CustomerView[]): PageAlerts {
  let alerts = NO_PAGE_ALERTS;
  for (let i = 1; i < views.length; i++) {
    alerts = nextPageAlerts(alerts, views[i - 1], views[i]);
  }
  return alerts;
}

describe("isHeadsUpReached", () => {
  test("is true for a Waiting Ticket at or inside the threshold", () => {
    expect(isHeadsUpReached(view({ position: 3 }))).toBe(false);
    expect(isHeadsUpReached(view({ position: 2 }))).toBe(true);
    expect(isHeadsUpReached(view({ position: 0 }))).toBe(true);
  });

  test("is false for a Ticket that is not Waiting, and for no Ticket", () => {
    // Every other status has position 0, which would otherwise read as "next".
    expect(isHeadsUpReached(view({ status: "called", position: 0 }))).toBe(false);
    expect(isHeadsUpReached(view({ status: "served", position: 0 }))).toBe(false);
    expect(isHeadsUpReached(view(null))).toBe(false);
  });
});

describe("nextPageAlerts: Heads-up", () => {
  test("fires when the Ticket crosses into the threshold while the page watches", () => {
    const alerts = watch(view({ position: 3 }), view({ position: 2 }));

    expect(alerts.headsUpTicketId).toBe("t-1");
  });

  test("stays quiet while the Ticket is still behind the threshold", () => {
    const alerts = watch(view({ position: 5 }), view({ position: 4 }), view({ position: 3 }));

    expect(alerts.headsUpTicketId).toBeNull();
  });

  test("fires once per page, however the position moves afterwards", () => {
    const once = watch(view({ position: 3 }), view({ position: 2 }));

    // Pushed back out (the threshold changed, say) and in again.
    const again = nextPageAlerts(
      nextPageAlerts(once, view({ position: 2 }), view({ position: 3 })),
      view({ position: 3 }),
      view({ position: 1 }),
    );

    expect(again).toBe(once);
  });

  test("does not fire for a Ticket that joins already inside the threshold", () => {
    // The Customer is looking at the page that says how many are ahead; the
    // database stamps that Ticket silently for the same reason.
    const alerts = watch(view(null), view({ position: 1 }));

    expect(alerts.headsUpTicketId).toBeNull();
  });

  test("does not fire for a page that first loads inside the threshold", () => {
    const alerts = watch(view({ position: 1 }), view({ position: 0 }));

    expect(alerts.headsUpTicketId).toBeNull();
  });

  test("does not fire for a Rejoin, which is a new Ticket rather than a move", () => {
    const alerts = watch(
      view({ id: "old", status: "no_show", position: 0 }),
      view({ id: "new", position: 1 }),
    );

    expect(alerts.headsUpTicketId).toBeNull();
  });

  test("gives way to Called when the Ticket skips straight to the chair", () => {
    const alerts = watch(view({ position: 3 }), view({ status: "called", position: 0 }));

    expect(alerts.headsUpTicketId).toBeNull();
    expect(alerts.ringingTicketId).toBe("t-1");
  });
});

describe("nextPageAlerts: Called", () => {
  test("starts ringing when a Waiting Ticket is Called", () => {
    const alerts = watch(view({ position: 0 }), view({ status: "called", position: 0 }));

    expect(alerts.ringingTicketId).toBe("t-1");
  });

  test("keeps ringing across refetches until acknowledged", () => {
    const called = view({ status: "called", position: 0 });
    const alerts = watch(view({ position: 0 }), called, called, called);

    expect(alerts.ringingTicketId).toBe("t-1");
  });

  test("stops for good once acknowledged", () => {
    const called = view({ status: "called", position: 0 });
    const acknowledged = acknowledgeCalled(watch(view({ position: 0 }), called));

    expect(acknowledged.ringingTicketId).toBeNull();
    expect(nextPageAlerts(acknowledged, called, called).ringingTicketId).toBeNull();
  });

  test("stops when the Ticket leaves the chair", () => {
    const alerts = watch(
      view({ position: 0 }),
      view({ status: "called", position: 0 }),
      view({ status: "served", position: 0 }),
    );

    expect(alerts.ringingTicketId).toBeNull();
  });

  test("rings for a page that loads already Called", () => {
    // iPhone Safari discards background tabs, so this is often a Customer coming
    // back to a page that reloaded while they were away.
    expect(initialPageAlerts(view({ status: "called", position: 0 }))).toEqual({
      headsUpTicketId: null,
      ringingTicketId: "t-1",
    });
  });

  test("starts a page that loads in any other state quiet", () => {
    expect(initialPageAlerts(view({ position: 0 }))).toBe(NO_PAGE_ALERTS);
    expect(initialPageAlerts(view({ status: "served", position: 0 }))).toBe(NO_PAGE_ALERTS);
    expect(initialPageAlerts(view(null))).toBe(NO_PAGE_ALERTS);
  });

  test("does not start ringing on a refetch that finds the Ticket still Called", () => {
    // Once acknowledged, the page holds no ringing Ticket; another Called view
    // must not bring the chime back.
    const called = view({ status: "called", position: 0 });

    expect(watch(called, called).ringingTicketId).toBeNull();
  });

  test("does not ring again when a Done is undone", () => {
    // The Customer was told once and is in the chair; the Owner mis-tapped.
    const alerts = watch(
      view({ status: "served", position: 0 }),
      view({ status: "called", position: 0 }),
    );

    expect(alerts.ringingTicketId).toBeNull();
  });
});
