# Phase 6 — Verification

There are currently **zero tests**. Since every phase above claims "behaviour is
unchanged", that claim needs something to lean on beyond careful reading.

The practical split: unit-test the pure logic (which is most of the risk), and
keep a written manual checklist for the DOM scraping (which can't be
meaningfully unit-tested against three third-party sites that change their
markup without notice).

## 6.1 — What to unit-test

After Phases 2-4 the genuinely pure, high-risk functions are:

| Module | Why it's worth testing |
|---|---|
| `shared/uci.ts` | Replaces positional indexing (`infoArr[9]`, `arr[3]`). Feed it real Stockfish output: `bestmove` with and without ponder, `score cp`, `score mate`, negative mate, `(none)`. |
| `shared/config.ts` | The `\|\|` → `??` change is exactly the kind of thing that regresses. Test that a stored `0` and a stored `false` survive a load round-trip. |
| `popup/position.ts` | FEN reconstruction from a move list, including the promotion handling that `makeMoveWithObject` currently gets wrong. Test both colours. |
| `content/automove/coords.ts` | Square ↔ pixel conversion, both orientations. Pure arithmetic, easy to get backwards, currently untested and buried in a closure. |
| `content/sites/chesscom.ts` — `parseAnnotatedMove` | The promotion-token parsing extracted in Phase 3.2. Pure string function once extracted. |

Vitest with `environment: 'happy-dom'` covers the few cases that need a DOM.

## 6.2 — Fixture-based adapter tests

The site adapters aren't pure, but they're testable if you capture their input.

Save real HTML snippets — a chess.com move list, a lichess move list, a lichess
puzzle board, a blitztactics board — into `test/fixtures/`, load them into
happy-dom, and assert the adapter produces the expected `BoardState`.

These will rot as the sites change their markup. That's fine and in fact the
point: a red test after a site redesign is a much better signal than a user
reporting the extension stopped working. Capture the fixtures **before**
starting Phase 3, from the current working extension, so they encode today's
known-good behaviour.

## 6.3 — Python tests

For Phase 5, the valuable tests are the pure heuristics:

- `intimidation_score` — assert a mate-in-one scores above a quiet developing
  move; assert a double check scores above a single check.
- `human_naturalness` — assert a capture scores above a quiet retreat.
- `score_to_cp` — mate scores fold to the expected side of the centipawn range.
- The mode functions with a stubbed `rank_moves`, so the selection logic is
  tested without running a real engine search.

That last one matters: it lets you verify `get_worst_move` actually picks from
the bottom of the list and `get_most_aggressive_move` respects the margin,
without a 0.3-second engine call per assertion.

## 6.4 — Manual smoke checklist

Keep this in the repo and run it before shipping any phase. Each phase's "done
when" is necessary; this is what makes it sufficient.

**Per site (lichess, chess.com, blitztactics):**

- [ ] Open a game. Popup shows the correct "Game detected on …" line.
- [ ] Board in the popup matches the board on the page, correct orientation.
- [ ] Board orientation flips correctly when playing as black.
- [ ] Best-move arrow (blue) and threat arrow (red) point at the right squares.
- [ ] Evaluation line updates with score and depth.
- [ ] Play a move on the page; popup updates within the refresh interval.

**Modes:**

- [ ] Autoplay plays the engine's move.
- [ ] Autoplay promotes to the configured piece (test all four, both colours).
- [ ] Hand-and-brain mode names the piece rather than the move.
- [ ] Puzzle mode walks the PV and waits for the opponent's reply.
- [ ] Each of the three "change evaluation" modes produces visibly different
      play from the default and from each other.
- [ ] Book moves are used for the first N moves when enabled.
- [ ] Preferred responses fire for a FEN in `preferred_responses.json`.

**Settings:**

- [ ] Change a setting, hit Apply, confirm the popup picks it up without a
      browser restart.
- [ ] Reset restores defaults.
- [ ] Set a numeric setting to `0` and confirm it stays `0` (this is the
      `\|\|` bug from audit finding E — it fails today).

**Backends:**

- [ ] Stockfish API reachable: analysis works.
- [ ] Stockfish API **not** running: popup shows an error rather than hanging on
      "Calculating..." forever.
- [ ] Python clicker backend enabled: clicks land in the right place.
- [ ] Debugger click backend: clicks land in the right place.

## 6.5 — CI

One GitHub Actions workflow on push: `npm run typecheck`, `npm run lint`,
`npm run test`, then `mypy backend` and `pytest backend`. Nothing more elaborate
is warranted at this size, but having the typecheck run on every push is what
stops the TypeScript migration from quietly decaying back into `any`.
