# Barbershop Virtual Queue

Walk-in customers join a barbershop's queue from their phone and are alerted when their turn approaches; Owners run the queue from a dashboard.

- Domain language: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr/](docs/adr/)
- MVP specs: [docs/specs/](docs/specs/)
- Running it, onboarding a Shop and the daily flow: [docs/operator-guide.md](docs/operator-guide.md)

## Development

Requires [bun](https://bun.sh) and a Docker-compatible runtime for local Supabase (e.g. `colima start`).

```bash
bun install
bunx playwright install chromium   # once
colima start                       # or any Docker-compatible runtime
bun run db:start                   # local Postgres, Auth and Realtime
bun run db:env > .env.local        # then add the remaining values from .env.example
bun run dev
```

Stop with `bun run db:stop && colima stop`. If `db:start` fails with
`LegacyStatusDbNotReadyError`, run it again — the container was still booting.

`.env.local` is gitignored and points at the local stack, with its `sb_publishable_…` /
`sb_secret_…` keys and `OPERATOR_API_KEY=local-operator-key`. Regenerate it with the
`bun run db:env` line quoted at the top of the file.

Schema, functions, RLS and triggers are changed only through migrations in `supabase/migrations/` (`bunx supabase migration new <name>`, then `bun run db:reset`). Never edit the database in the Studio. Run `bun run db:types` after every migration and commit the result.

Surprises that are not in the specs are collected in [docs/agents/gotchas.md](docs/agents/gotchas.md).

## Tests

| Command | Seam |
|---|---|
| `bun run test:unit` | Pure modules and Route Handlers (Request in, Response out) |
| `bun run test:db` | Postgres functions against local Supabase (needs `db:start`) |
| `bun run e2e` | Playwright in Chromium against `next dev` |
| `bun run test` | Unit and database suites together |

Tests always run against the local stack, **never the cloud project**, because they create
and delete data and depend on resets.

Also: `bun run typecheck` and `bun run lint`.
