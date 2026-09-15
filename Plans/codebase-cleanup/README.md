# Mephisto Cleanup Plan

A staged plan to pay down the debt in this repo: convert the extension to
TypeScript, give the untyped message/config/board protocols real types,
collapse the duplicated site branching into adapters, and de-duplicate the
Python backend.

**Guiding rule: behaviour stays the same.** Every phase below is a refactor.
Where a phase fixes a bug found during the audit, the fix is called out
explicitly so it can be accepted or deferred on purpose rather than smuggled in
with a rename.

## Phases

| # | Plan | Status | What it delivers | Depends on |
|---|------|--------|------------------|------------|
| 0 | [Audit](00-audit.md) | done | Findings with file:line — the evidence the rest of the plan is built on | — |
| 1 | [Tooling & build](01-tooling.md) | **done** | `package.json`, TypeScript, bundler, lint, `dist/` output | — |
| 2 | [Shared contracts](02-contracts.md) | **done** | Typed messages, one config source of truth, structured board state | 1 |
| 3 | [Site adapters](03-site-adapters.md) | todo | `SiteAdapter` per site; kills the 8 repeated if-chains | 2 |
| 4 | [Popup decomposition](04-popup.md) | todo | `popup.js` split into engine client / parser / view / autoplay | 2 |
| 5 | [Python backend](05-python-backend.md) | todo | One backend instead of two drifted copies; typed; engine access made safe | — |
| 6 | [Verification](06-verification.md) | todo | Tests for the pure logic + a manual smoke checklist | 1 |

Work left behind by a completed phase is marked in the source with
`TODO(phase-N)`, naming the phase that owns it:

```
grep -rn "TODO(phase-" src/
```

Phases 1→2 are sequential. After 2, phases 3, 4 and 5 are independent and can
be done in any order. Phase 5 touches no JavaScript and can start immediately
if you'd rather begin there.

## Order of value

If the whole thing is too much at once, this is the order that buys the most
per hour of work:

1. **Phase 2's board-state change** — deleting the `*****` string protocol
   removes the single most fragile thing in the codebase.
2. **Phase 5** — the Linux backend is currently broken and unmaintained; one
   shared backend stops the drift.
3. **Phase 3** — the site branching is where every future site-breakage fix
   will land, so it should be the part that's easy to edit.
4. Everything else.

## Non-goals

- Rewriting the UI, adding a framework, or changing how the popup looks.
- Replacing the vendored `lib/*.min.js` files with npm packages. They get
  type declarations in Phase 1 and are otherwise left alone.
- Changing the extension's feature set. No features added, none removed.
- Bundling Stockfish into the extension. The local HTTP backend stays.
