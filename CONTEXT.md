# Barbershop Virtual Queue

Walk-in customers join a barbershop's queue from their phone instead of waiting in the shop, and are alerted when their turn approaches. Shop owners run the queue from a dashboard.

## Language

### People and places

**Operator**:
The platform owner who onboards Shops and creates Owner accounts. Not a Shop user.
_Avoid_: Admin, super-admin

**Shop**:
A single barbershop location with exactly one Queue. Onboarded manually by the Operator, never self-registered.
_Avoid_: Store, outlet, branch, tenant

**Owner**:
The person who logs in to run a Shop's Queue. One Owner account belongs to one Shop.
_Avoid_: Admin, merchant, staff, user

**Customer**:
An unauthenticated walk-in person holding a Ticket. Identified only by the display name they enter and the device they joined from.
_Avoid_: User, client, guest

**In-person Customer**:
Not modelled. Someone waiting physically without a Ticket is served outside the system, is never recorded, and never billed.

**Deactivated Shop**:
A Shop the Operator has switched off. Its Queue accepts no Tickets and its Owner cannot log in; its history is kept.

**Barber**:
Not modelled. The Queue is shop-wide; any free chair takes the next Ticket.

### Queue

**Queue**:
The single, shop-wide, first-come ordering of a Shop's active Tickets.
_Avoid_: Line, list, waitlist, booking

**Ticket**:
One Customer's place in a Queue, from joining until it reaches a final status. A device may hold at most one active Ticket per Shop.
_Avoid_: Entry, booking, reservation, appointment, transaction

**Ticket status**:
- **Waiting**: in the Queue, not yet called.
- **Called**: the Owner has summoned the Customer to a chair.
- **Served**: the Owner marked the haircut done. Final once the 2-minute Undo window passes; within it the Owner may revert it to Called.
- **No-show**: called but never arrived. Final.
- **Left**: the Customer cancelled their own Ticket. Final.
- **Removed**: taken out by the Owner or by the system. Final.

**Call next**:
The Owner action that moves the first Waiting Ticket to Called. Separate from marking a Ticket Served, so several Tickets may be Called at once (one per free chair).

**Rejoin**:
A new Ticket created from a No-show Ticket's page, placed at the back of the Queue. Skips the Join Radius check.

### Joining and alerts

**Join Radius**:
The distance from a Shop within which a Customer's device must be to create a Ticket. Checked only at the moment of joining.
_Avoid_: Geofence, location lock

**Heads-up**:
The one-time alert sent the first time a Waiting Ticket has the Shop's Heads-up Threshold (default 3) or fewer Waiting Tickets ahead of it. Distinct from the alert sent on being Called.
_Avoid_: Reminder, warning

**Estimated Wait**:
A rough range shown to a Waiting Customer, derived from recent Called-to-Served durations in the current Queue Day. Hidden until enough Tickets have been Served.

### The queue day

**Queue Day**:
The span between two Close Shop actions. Ticket numbers restart at each new Queue Day. Not tied to calendar dates or opening hours.
_Avoid_: Session, shift, business day

**Last Call**:
The Owner action that stops new Tickets from joining and tells every Waiting Customer the shop is closing soon.

**Close Shop**:
The Owner action that ends the current Queue Day. Unresolved Waiting Tickets become Removed.

**Carried-over Ticket**:
A Waiting Ticket whose Customer chose, after Last Call, to move to the next Queue Day. It goes to the front of that day in original order, may carry over only once, and is Removed after 3 days.
_Avoid_: Booking, reservation, deferred ticket

**Served Ticket**:
A Ticket that reached Served. The only billable event: the Owner is charged RM0.25 each from their first day, invoiced monthly by the Operator. Belongs to the calendar month (Malaysia time) in which it was marked Served. Never deleted.
_Avoid_: Transaction, sale, completed order

**Billing Month**:
A calendar month in Asia/Kuala_Lumpur time, used to total a Shop's Served Tickets for its invoice.
