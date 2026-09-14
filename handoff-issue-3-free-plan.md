# Handoff: finish #3 (Netlify dashboard tasks)

Repo: `/Users/akashaf/workspace/virtual-queue-system` (GitHub `akashaf/virtual-queue-system`, branch `main`, pushed at `12605e3`).

## Focus for the next session

1. **Close out what's still open on #3.** Everything left needs the user's Netlify account.
2. Then move on to the ticket frontier (§4).

The Free-plan decision is **done and recorded**:
- ADR `docs/adr/0003-netlify-free-plan-until-first-paying-shop.md`
- specs updated in `12605e3`
- #1 and #3 issue bodies updated

Don't redo it.

## Read these first (don't duplicate them)

- Spec issue: https://github.com/akashaf/virtual-queue-system/issues/1, with child tickets #2–#15 (native blocked-by links)
- #3 (acceptance criteria are ticked where done) and its platform-check findings: https://github.com/akashaf/virtual-queue-system/issues/3#issuecomment-5659898761
- Glossary and ADRs: `CONTEXT.md`, `docs/adr/` (0003 is the Netlify Free plan)
- Specs: `docs/specs/third-party.md` covers:
  - Netlify on the Free plan: region, site name, Deploy Previews, Node version
  - Supabase: project, auth-settings traps, how to push auth settings safely, local-only tests

  Also `docs/specs/backend.md` and `docs/specs/frontend.md`.
- Tracker conventions: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`
- Commits: `7f87e08` and `fdf52c3` (#2, closed); `8ac29b0` and `19dc2f5` (#3 check added, then removed); `12605e3` (specs and ADR for the Free plan)

## 1. Still open on #3 (label `ready-for-human`)

- [ ] **Netlify CLI access (blocks everything below).**
  - It's installed at `~/.bun/bin/netlify` (v27.5.2). That directory **isn't on PATH**, and the CLI is **not logged in**.
  - The user must run `! ~/.bun/bin/netlify login` and `! ~/.bun/bin/netlify link` (the login needs a browser).
- [ ] **Functions region.** Check whether the Free plan allows Asia Pacific (Singapore).
  - Set it if it does.
  - Record the result in `docs/specs/third-party.md` §2, which currently says "Not yet confirmed". If it's stuck in US East, also update the diagram note in `backend.md` §2.
- [ ] **Confirm the site name is final** with the user: `virtual-queue-system.netlify.app` (the specs already record it).
- [ ] **Production environment variables** (names in `.env.example` and `backend.md` §10), scoped per `third-party.md` §2.
  - The Supabase URL and keys come from the linked project `queue-service`.
  - **Don't print secret values in the transcript.** List names only, e.g. `netlify env:list --json` filtered to keys.
  - No deployed code needs them yet; #4 will.
- [ ] **Disable Deploy Previews and Branch deploys.**
- [ ] **Pin the Node version** (Netlify runs 22.14.0, local development uses 26; see `third-party.md` §2). This is optional within #3, and can be done in code with `engines` or as the Netlify env var `NODE_VERSION`.
- [ ] **VAPID keys:** the user should run `bunx web-push generate-vapid-keys` themselves and store the keys in Netlify, so the private key never enters an agent transcript.
- [ ] **Close #3** once the above is done or explicitly waived.

## 2. Supabase cloud: state not captured in the specs

- Linked project ref: `beolqxlclwhnvmoglgmo`. The link state is in the gitignored `supabase/.temp/`. Cloud auth already has `jwt_expiry` 600, sign-ups disabled, and `site_url` set; nothing else was changed.
- Reading the CLI token from the macOS Keychain to call the Management API directly was **blocked by the sandbox**. Don't retry it. Use the CLI's scoped `config diff`/`config push` method described in `third-party.md` §3.
- The cloud **database is empty** (per the user). `bunx supabase db push` needs the database password, which the user must supply; the first migration arrives with #4.
- **Flagged, still unanswered:** the cloud shows `auth.sms.twilio.enabled = true`. Ask the user whether that's intended.

## 3. Local environment changes outside the repo

- Colima and the Docker CLI were installed via Homebrew (the user chose this). The VM is 4 CPU / 6 GB / 40 GB, and local Supabase runs on it.
  - Start: `colima start && bun run db:start`
  - Stop: `bun run db:stop && colima stop`
- `~/.docker/config.json` had a stale `"credsStore": "desktop"` left from Docker Desktop, which broke image pulls. That key was removed; the backup is `~/.docker/config.json.bak-desktop`.
- **Decision: keep local Supabase** even though the cloud project is linked. Tests run locally only (now in the specs).

## Technical gotchas learned (not in the specs)

- `"use server"` files may only export async functions; exporting a `const` breaks every action in the file.
- A Server Action form clicked before hydration submits as a normal POST, and `page.reload()` in Playwright then re-submits it. Poll with `page.goto()` instead.
- `bun run typecheck` runs `next typegen` first, because global types like `LayoutProps` are generated. After deleting routes, stale `.next/types` can break `tsc`; `rm -rf .next` fixes it.
- `next dev` can load a server module separately for a page and an action, so module-level in-memory state isn't shared. Use `globalThis` if it must be.
- Vitest projects: `unit` (`{app,lib}/**/*.test.ts`) and `db` (`tests/db/**`, needs local Supabase running). Plain `bun run test` runs both.
- `git diff` can hang waiting on a pager in this environment; use `git --no-pager diff`.

## 4. After #3: the ticket frontier

#4 (Operator creates a Shop, Owner logs in) and #9 (Sentry) are unblocked and labelled `ready-for-agent`. #4 will need the first migration and the real `proxy.ts` (Supabase session refresh), and its schema must then be pushed to the cloud (database password needed).

## Suggested skills

- `mattpocock-skills:implement` (with `mattpocock-skills:tdd`): for #4 or #9 once #3 is closed.
- `mattpocock-skills:code-review`: after any code or spec change, before committing.
- `mattpocock-skills:domain-modeling`: if the region check forces a further decision (e.g. accepting US East), to amend ADR 0003 or add a new ADR.
