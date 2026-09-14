# Barbershop Virtual Queue

Walk-in customers join a barbershop's queue from their phone and are alerted when their turn approaches; Owners run the queue from a dashboard.

- Domain language: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr/](docs/adr/)
- MVP specs: [docs/specs/](docs/specs/)

## Development

Requires [bun](https://bun.sh) and a Docker-compatible runtime for local Supabase (e.g. `colima start`).

```bash
bun install
bunx playwright install chromium   # once
bun run db:start                   # local Postgres, Auth and Realtime
bun run db:env > .env.local        # then add the remaining values from .env.example
bun run dev
```

Schema, functions, RLS and triggers are changed only through migrations in `supabase/migrations/` (`bunx supabase migration new <name>`, then `bun run db:reset`). Never edit the database in the Studio.

## Tests

| Command | Seam |
|---|---|
| `bun run test:unit` | Pure modules and Route Handlers (Request in, Response out) |
| `bun run test:db` | Postgres functions against local Supabase (needs `db:start`) |
| `bun run e2e` | Playwright in Chromium against `next dev` |
| `bun run test` | Unit and database suites together |

Also: `bun run typecheck` and `bun run lint`.
