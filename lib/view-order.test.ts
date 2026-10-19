import { describe, expect, test } from "vitest";
import { createViewOrder } from "./view-order";

describe("createViewOrder", () => {
  test("accepts views that land in the order they were sent", () => {
    const order = createViewOrder();
    const first = order.next();
    const second = order.next();

    expect(order.accept(first)).toBe(true);
    expect(order.accept(second)).toBe(true);
  });

  test("drops a view sent before one already shown", () => {
    const order = createViewOrder();
    const older = order.next();
    const newer = order.next();

    expect(order.accept(newer)).toBe(true);
    expect(order.accept(older)).toBe(false);
  });

  test("a view the screen makes itself outranks every refetch already in flight", () => {
    // A press on the board, or an action's result on the customer page.
    const order = createViewOrder();
    const inFlight = order.next();

    order.claim();

    expect(order.accept(inFlight)).toBe(false);
    // A refetch sent after it is still newer.
    expect(order.accept(order.next())).toBe(true);
  });
});
