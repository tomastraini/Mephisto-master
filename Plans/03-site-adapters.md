# Phase 3 — Site adapters

**Goal:** collapse the eight repeated `if (site === …)` chains in
`content-script.js` into one interface with three implementations, and
de-duplicate the lichess/blitztactics arms that are currently byte-identical
copies (audit finding D).

Depends on Phase 2 for `BoardState`.

## The interface

Every site-specific chain in the file answers one of nine questions. That set
*is* the interface:

```ts
// src/content/sites/adapter.ts
export interface SiteAdapter {
  readonly site: Site;

  /** Null when the page has no move list — i.e. it's a puzzle. */
  readMoveList(): string[] | null;

  /** Used only when readMoveList() returns null. */
  readPieces(): PlacedPiece[];

  readOrientation(): Orientation;
  readTurn(): Color;

  /** [from, to] of the last move, for puzzle-mode move confirmation. */
  readLastMoveSquares(): [Element | null, Element | null];

  readBoardElement(): Element | null;
  readSelectedMoveIndex(): number | null;
  readPromotionChoice(piece: PieceType): Element | null;
}
```

Then dispatch once, at load, instead of nine times per call:

```ts
// src/content/sites/index.ts
const ADAPTERS: Record<string, () => SiteAdapter> = {
  'lichess.org':     () => new LichessAdapter(),
  'www.chess.com':   () => new ChesscomAdapter(),
  'blitztactics.com':() => new BlitzTacticsAdapter(),
};

export function detectAdapter(hostname: string): SiteAdapter | null {
  return ADAPTERS[hostname]?.() ?? null;
}
```

`content-script.ts` holds one `adapter` and stops knowing any site names.

## Files

```
src/content/
  content-script.ts          thin: message dispatch + automove orchestration
  sites/
    adapter.ts               the interface above
    index.ts                 hostname → adapter
    chessground.ts           shared base for lichess + blitztactics
    lichess.ts               extends ChessgroundAdapter
    blitztactics.ts          extends ChessgroundAdapter
    chesscom.ts              standalone
  automove/
    simulate.ts              simulateMove / simulatePvMoves
    coords.ts                square ↔ pixel conversion
    timing.ts                think/move time sampling
```

## 3.1 — Extract `ChessgroundAdapter`

lichess and blitztactics both render with chessground. Their bodies in
`getMoves` (`content-script.js:153-172` vs `:173-191`), `getRanksFiles`,
`getBoard` and `getOrientation` are identical apart from the board container
selector — `.main-board piece` vs `.board-area piece`, `cg-board` for both.

So the base class takes the container selector as its one point of variance:

```ts
abstract class ChessgroundAdapter implements SiteAdapter {
  protected abstract readonly pieceSelector: string;  // '.main-board piece' | '.board-area piece'
  // readPieces / readOrientation / readTurn / readBoardElement implemented once
}
```

`LichessAdapter` adds the move-list reading (`u8t` / `move` elements) that
blitztactics doesn't have — `BlitzTacticsAdapter.readMoveList()` returns `null`
unconditionally, which is exactly what the current code does implicitly by
falling into the `btpuz` branch.

The piece-coordinate math at `:159-165` and `:179-185` — the transform-parsing,
the orientation flip — is written twice today. It becomes one method.

## 3.2 — `ChesscomAdapter`

chess.com is genuinely different and stays standalone. It also carries the
messiest code in the file: `getMoves`'s chess.com arm (`:64-141`) is ~78 lines
with a doubly-nested promotion-parsing block that appears **twice**, once under
`.offset-for-annotation-icon` (`:71-89`) and once under `.node-highlight-content`
(`:91-116`). The two copies are identical:

```js
if (text.includes('=')) {
    const [movePart, promotionPiece] = text.split('=');
    let completeMove = promotionPiece + movePart;
    if (completeMove.includes("+")) { /* … */ }
    res += completeMove + '=' + '*****';
}
```

Extract that to one `parseAnnotatedMove(el: Element): string` and the arm drops
to roughly 20 lines.

While extracting, note the `return` inside the `moves.forEach` at `:113` and
`:118`. `return` inside a `forEach` callback continues to the next element — it
does not break the loop. The `if (!getAllMoves && move === selectedMove) return`
at `:117-119` therefore **does not stop collecting moves**, meaning
`getAllMoves: false` (hand-and-brain mode reading up to the selected move) does
not work on chess.com. The lichess arm gets this right with a `for…of` and a
`break` (`:149-151`).

Fixing it is correct but **it is a behaviour change** — hand-and-brain mode on
chess.com will start truncating at the selected move where today it doesn't.
Decide deliberately. Recommended: fix it, and note it in the commit, since the
lichess path already behaves that way and the asymmetry is clearly unintended.
This is why `readSelectedMoveIndex()` returns an index in the interface above
rather than an `Element` — the truncation becomes `moves.slice(0, idx + 1)` at
the call site, where it's obvious whether it happened.

## 3.3 — Move the auto-rematch clicker out of the message handler

The `"New 5 min"` clicker at `content-script.js:33-43` currently runs on every
inbound message (audit finding G). It is also chess.com-specific and lives in
site-agnostic code.

Make it `ChesscomAdapter.tryAcceptRematch()`, called from one place on a
deliberate interval, and read the button by a stable attribute rather than
matching the literal string `"New 5 min"`. If no stable selector exists, at
minimum take the time control from config instead of hardcoding it.

Consider whether this belongs behind its own setting. Auto-accepting rematches
is a distinct behaviour from move analysis, and today there is no way to turn it
off.

## 3.4 — Extract the automove code

`simulateMove` (`:400-436`) and `simulatePvMoves` (`:438-481`) use closures over
`boardBounds` to define inner functions — `getBoundsFromCoords`, `deriveCoords`,
`getThinkTime`, `getMoveTime`. These are pure given the bounds and config, and
belong in `automove/coords.ts` and `automove/timing.ts` as top-level functions
taking explicit parameters. That makes them testable (Phase 6) and removes the
closure nesting.

One real bug to fix while moving: `simulatePvMoves` calls
`simulateMove(move, false)` at `:473` but `simulateMove` takes **one** parameter
(`:400`). The `false` is silently ignored. Either the second parameter was meant
to exist (suppressing think-time on continuation moves would make sense) or the
argument is vestigial. Read the intent, then make the signature and the call
agree.

## Done when

- `content-script.ts` contains no `site === '…'` comparison.
- No code block appears in both the lichess and blitztactics paths.
- Adding a new site means adding one file under `sites/` and one line in
  `sites/index.ts`.
