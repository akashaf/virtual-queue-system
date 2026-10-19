/**
 * Which of a screen's overlapping views is the newest, so an older one landing
 * late never replaces it.
 *
 * A screen refetches its view from a ping, a poll, a refocus and after every
 * press, and the answers land in any order. Each view takes a number when it
 * starts: a refetch when it is sent, a view the screen makes itself (a press on
 * the board, an action's result on the customer page) when it is made. A view
 * numbered below one already shown is dropped. Without this, an answer read
 * before Call next but delivered after it put the called Customer back in
 * Waiting until the poll (#32), and silenced a Called chime (#31).
 *
 * The price: a refetch the server answered after a newer view, so with newer
 * news, is dropped too. The ping, poll or refocus that follows brings it back.
 */
export interface ViewOrder {
  /** The number for a view starting now. */
  next(): number;
  /** Whether the view numbered `issued` is the newest yet; if so, it becomes the one shown. */
  accept(issued: number): boolean;
  /** A view the screen made itself is shown: it outranks every refetch already in flight. */
  claim(): void;
}

/** A fresh ordering for one screen's views, nothing yet sent or shown. */
export function createViewOrder(): ViewOrder {
  let lastIssued = 0;
  let lastShown = 0;
  return {
    next: () => ++lastIssued,
    accept(issued) {
      if (issued < lastShown) return false;
      lastShown = issued;
      return true;
    },
    claim() {
      lastShown = ++lastIssued;
    },
  };
}
