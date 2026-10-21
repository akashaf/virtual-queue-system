# A Sign-in ends at the first Close Shop after seven days

An Owner's Sign-in on a device ends at the first Close Shop once it is seven or more days old, rather than at a fixed time. A fixed limit would log Owners out in the middle of a working day, with Customers waiting, and Close Shop is the one moment we know the Owner has stopped working. Close Shop ends every one of that Owner's Sign-ins old enough, not only the device that tapped it, so a lost tablet that never closes a Shop still loses access. The seven days is the `OWNER_SIGN_IN_MAX_DAYS` environment variable.

## Considered Options

- **Supabase's `timebox` / `inactivity_timeout`.** One setting, enforced by the Auth server, but a Pro-plan feature — and `timebox` logs out at a fixed time, which is exactly the mid-day logout this avoids, while an inactivity timeout never fires on a tablet used daily. We keep our own rule after upgrading to Pro too.
- **A hard cap (e.g. 14 days) at any dashboard visit**, for a Shop that never closes. Rejected: it brings back the mid-day logout.

## Consequences

- A Shop whose Owner never taps Close Shop keeps its Sign-ins until something else ends them (Sign out, Sign out other devices, a password reset or a deactivation).
- An access token already issued still works for up to ten minutes after its Sign-in ends, as it does for a password reset today.
