# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## Specs

The MVP tech specs live in `docs/specs/` (`backend.md`, `frontend.md`, `third-party.md`). Read the relevant spec before working on a ticket; the spec wins over assumptions, and the glossary wins over the spec's wording if they ever disagree.

## Impeccable's files

The Impeccable design skill reads only `PRODUCT.md` (who the product is for, its rules) and
`DESIGN.md` (how it looks), plus its own copy of `DESIGN.md` in `.impeccable/design.json`. It
never reads the specs, `CONTEXT.md` or the ADRs, so nothing keeps them in step on its own:

- **After editing `DESIGN.md`**, run `/impeccable doctor`; a `design-sidecar-stale` finding means
  refresh the copy with `/impeccable document` (sidecar only, `DESIGN.md` kept).
  `.impeccable/design.json` is tracked: commit it with `DESIGN.md`.
- **After a spec change that changes the product** (a new screen, rule or audience), compare
  `PRODUCT.md` with the specs and ADRs claim by claim; `doctor` cannot see this drift. The specs
  win; `PRODUCT.md` is their summary for Impeccable and links to `docs/specs/frontend.md`.
