@AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `akashaf/virtual-queue-system`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Gotchas

Things that are true of this repo and are not in the specs, each of which cost real time to
find. Read before touching migrations, `proxy.ts`, Server Actions or anything on Netlify:
`docs/agents/gotchas.md`. Add to it when something surprises you.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, with the MVP tech specs in `docs/specs/`. See `docs/agents/domain.md`.
