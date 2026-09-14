# Handoff: finish #3, switch specs to the Netlify free plan

Repo: `/Users/akashaf/workspace/virtual-queue-system` (GitHub `akashaf/virtual-queue-system`, branch `main`, clean and pushed at `19dc2f5`).

## Focus for the next session

1. **Update the specs so the MVP runs on the free Netlify plan for now.** The Owner decided this during this session; the specs still say "paid plan".
2. **Close out what's still open on #3**, most of which needs the user's Netlify account.
3. Record any decisions from this session that no artifact captures yet (listed below).

## Read these first (don't duplicate them)

- Spec issue: https://github.com/akashaf/virtual-queue-system/issues/1, with child tickets #2–#15 (native blocked-by links)
- #3 and its findings comment: https://github.com/akashaf/virtual-queue-system/issues/3#issuecomment-5659898761
- Glossary and ADRs: `CONTEXT.md`, `docs/adr/`
- Specs: `docs/specs/backend.md`, `docs/specs/frontend.md`, `docs/specs/third-party.md`
- Tracker conventions: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`
- Commits: `7f87e08`, `fdf52c3` (#2, closed); `8ac29b0`, `19dc2f5` (#3 check added, then removed)

## 1. Spec changes needed for the free Netlify plan

Places that assume a paid plan or a Singapore functions region. Line numbers are as of `19dc2f5`; re-grep for `paid|region|credit|upgrade`.

- `docs/specs/third-party.md:11`: the summary table says **Paid plan (Personal or Pro)** at about US$9–20. Change it to Free at launch, and keep the pause risk as a known trade-off.
- `docs/specs/third-party.md:42`: "Functions region … Switch to Asia Pacific (Singapore) … choose a plan that does." On the free plan the region may not be changeable. The next agent should check (after the user logs in to the Netlify CLI) and document the result: either Singapore works on free, or functions stay in US East and every action pays the extra latency.
- `docs/specs/third-party.md:52` (Deploy Previews): password protection is plan-dependent. On free, the spec should say "disable Deploy Previews".
- `docs/specs/third-party.md:128–133` (upgrade triggers): keep "first paying Shop goes live → Netlify paid plan" and the "credit usage passes ~70%" trigger. Those are the upgrade path from free.
- `docs/specs/backend.md:23`: the architecture diagram says "functions region ap-southeast-1"; update it if the region can't be set.
- **Issue #3 acceptance criterion** "The site is on a paid Netlify plan with the functions region set to Asia Pacific (Singapore)". Edit the issue body with `gh issue edit 3 --body-file …` to reflect the free plan, rather than leaving the criterion unmet.
- Consider an ADR in `docs/adr/`, e.g. `0003-netlify-free-plan-for-mvp.md`. The decision accepts that a site paused when monthly credits run out takes every Shop's queue offline, and possibly US-East latency, in exchange for zero hosting cost until the first paying Shop. It meets the ADR bar: a real trade-off that a future reader would otherwise question.
- `third-party.md` should also note the **Node version mismatch** found in #3: Netlify functions run Node 22.14.0, local development uses Node 26. Recommend pinning `NODE_VERSION` (Netlify env) or `engines` in `package.json`.

## 2. Still open on #3 (label `ready-for-human`)

Done (evidence is in the #3 comment and the commits):
- `netlify.toml` is committed.
- The Supabase production project exists and is configured (see §3).
- Server Actions, `proxy.ts` (Node runtime) and `after()` are verified on https://virtual-queue-system.netlify.app. The throwaway code has been removed.

Open:
- [ ] **Netlify CLI access.** It's installed at `~/.bun/bin/netlify` (v27.5.2). That directory **isn't on PATH**, and the CLI is **not logged in**. The user must run `! ~/.bun/bin/netlify login` and `! ~/.bun/bin/netlify link` (the login needs a browser). After that the agent can inspect the site.
- [ ] **Plan and region.** The plan is free by decision. Check whether the functions region can be Singapore on free, and record the answer in the spec (§1).
- [ ] **Site name is final:** `virtual-queue-system.netlify.app`. It goes on every printed QR code, so never rename it. Confirm with the user and record it.
- [ ] **Production environment variables** (names in `.env.example` and `backend.md` §10) with Functions + Runtime scopes (`NEXT_PUBLIC_*` also Builds), secret values marked. The Supabase URL and keys come from the linked project. **Don't print secret values in the transcript;** list names only (e.g. `netlify env:list --json` filtered to keys). No deployed code needs them yet; #4 will.
- [ ] **Deploy Previews:** disable them (the free plan likely can't password-protect).
- [ ] **VAPID keys:** the user should run `bunx web-push generate-vapid-keys` themselves and store the keys in Netlify, so the private key never enters an agent transcript.
- [ ] **Close #3** once the above is done or explicitly waived. Update its body for the free plan first.

## 3. Changes and decisions from this session not captured elsewhere

**Supabase cloud:**
- Project `queue-service` (ref `beolqxlclwhnvmoglgmo`, ap-southeast-1) is linked to the repo. The link state is in the gitignored `supabase/.temp/`.
- Cloud auth was changed to: `jwt_expiry` 600, `enable_signup` false, `site_url` `https://virtual-queue-system.netlify.app`. Nothing else was changed.
- **Don't run a plain `supabase config push`** from the repo. `supabase/config.toml` is the local-dev template, and pushing it would overwrite about 12 cloud settings (pooler sizes, OTP length, email rate limits, MFA, redirect URLs, local `site_url`). A non-interactive push also skips the confirmation prompt.
  - What worked: a scratch workdir whose `supabase/config.toml` declares only the intended keys. Run `supabase config diff --workdir <dir> --project-ref <ref>`, check it, then `config push` with the same flags. Undeclared keys are left unchanged.
- Reading the CLI token from the macOS Keychain to call the Management API directly was **blocked by the sandbox**. Don't retry that approach.
- The cloud **database is empty** (per the user). `supabase db push` and `migration list` need the database password, which the user must supply.
- **Flagged for the user:** the cloud shows `auth.sms.twilio.enabled = true`. It's unexpected, so ask whether it's intended.

**Supabase config gotcha (fixed in `fdf52c3`):**
- `[auth.email] enable_signup = false` disables the whole email provider, which blocks Owner password sign-in. Keep it `true`; `[auth] enable_signup = false` alone blocks sign-ups.
- A regression test in `tests/db/harness.test.ts` covers this.

**Local environment (outside the repo):**
- Colima and the Docker CLI were installed via Homebrew (the user chose this). The VM is 4 CPU / 6 GB / 40 GB, and local Supabase runs on it.
- `~/.docker/config.json` had a stale `"credsStore": "desktop"` left from Docker Desktop, which broke image pulls. That key was removed; the backup is `~/.docker/config.json.bak-desktop`.
- **Decision: keep local Supabase.** The user asked whether cloud makes it unnecessary. The answer was no, and the user agreed to keep it. Database tests reset data and fake time, so they can't run against production. It's also the agreed test seam for #4 onward. To stop it when idle: `bun run db:stop && colima stop`.

**Netlify plan:** the user plans to stay on the free plan for now (this handoff's main task).

**Technical gotchas learned (not in the specs):**
- `"use server"` files may only export async functions; exporting a `const` breaks every action in the file.
- A Server Action form clicked before hydration submits as a normal POST, and `page.reload()` in Playwright then re-submits it. Poll with `page.goto()` instead.
- `bun run typecheck` now runs `next typegen` first. Global types like `LayoutProps` are generated, so `tsc` alone fails on a clean checkout. After deleting routes, stale `.next/types` can also break `tsc`; `rm -rf .next` fixes it.
- `next dev` can load a server module separately for a page and an action, so module-level in-memory state isn't shared. Use `globalThis` if it must be.
- The shadcn init added the npm package `cn` (shadcn's own `shadcn-ui/cn`, used by `lib/utils.ts`). It's legitimate, not a typosquat.
- Vitest projects: `unit` (`{app,lib}/**/*.test.ts`) and `db` (`tests/db/**`, needs local Supabase running). Plain `bun run test` runs both.

## 4. After #3: the ticket frontier

#4 (Operator creates a Shop, Owner logs in) and #9 (Sentry) are unblocked and labelled `ready-for-agent`. #4 will need the first migration and the real `proxy.ts` (Supabase session refresh).

## Suggested skills

- `mattpocock-skills:domain-modeling`: write the ADR for "Netlify free plan for MVP", and keep spec wording in the glossary vocabulary.
- `mattpocock-skills:grilling`: optional; stress-test the free-plan trade-off (pausing on credit exhaustion, region, Deploy Previews) with the user before editing the specs.
- `mattpocock-skills:code-review`: review the spec and ADR edits (the Spec axis against #1 and #3) before committing.
- `mattpocock-skills:implement` (with `mattpocock-skills:tdd`): when moving on to #4.
