# Phase 4 — Popup decomposition

**Goal:** split the 528-line `popup.js` into modules with one job each, and
replace the positional string parsing with the typed helpers from Phase 2.

Depends on Phase 2. Independent of Phase 3.

## Target layout

```
src/popup/
  popup.ts             wiring only: load config, build modules, register listeners
  engine-client.ts     HTTP to the local Stockfish API
  position.ts          BoardState → FEN
  view/
    board.ts           the ChessBoard instance
    arrows.ts          SVG arrow overlay
    status.ts          the two text lines, evaluation, progress bar
  autoplay.ts          decides when to send an automove and with what promotion
  click-backend.ts     chrome.debugger vs the Python clicker
```

## 4.1 — `engine-client.ts`

Collapses `fetchStockfishAPI` (`popup.js:25-65`).

```ts
export class EngineClient {
  constructor(private readonly baseUrl = 'http://127.0.0.1:5000') {}
  analyse(fen: string, type: 'info' | 'bestmove', config: Config): Promise<string>;
}
```

Changes:

- The two near-identical payload objects at `:30-56` become one object with
  `depth` and `movetime` set from a single ternary. They differ in two fields
  out of eleven.
- Delete the `callworstmove` dead branch (`:26-27`).
- Return the `response` string directly rather than the `{response: string}`
  envelope — unwrapping belongs here, not at three call sites.
- Add error handling. Today a failed fetch lands in a `.catch` that only calls
  `toggle_calculating(false)` (`:131-133`, `:187-189`), so when the Python
  backend isn't running the popup silently shows "Calculating..." forever. It
  should say the backend is unreachable. This is a small UX addition, not a
  behaviour change to existing working paths.

Also fold in the duplicated fetch chain from `:122-133` and `:178-189`:

```ts
async function analysePosition(fen: string): Promise<void> {
  await handleResponse(await engine.analyse(fen, 'info', config));
  await handleResponse(await engine.analyse(fen, 'bestmove', config));
  status.setCalculating(false);
}
```

Worth noting for Phase 5: this two-call pattern makes the backend search every
position **twice**. A single call returning both the info line and the bestmove
would halve engine work. That's a protocol change spanning both sides — record
it, don't do it here.

## 4.2 — `position.ts`

Replaces `parse_fen_from_response` (`:203-243`), `createFenFromMoves`
(`:245-255`) and `makeMoveWithObject` (`:257-295`).

With `BoardState` from Phase 2 the top level is a two-arm switch:

```ts
export function toFen(state: BoardState, promotionPiece: PieceType): string {
  switch (state.source) {
    case 'move-list':       return replayMoves(state.moves, promotionPiece);
    case 'piece-placement': return placePieces(state.turn, state.pieces);
  }
}
```

`makeMoveWithObject` needs real attention — it is the worst function in the
file. Its two branches (capture vs non-capture promotion) are near-duplicates,
and it has the confirmed bug at `:287`:

```js
const color = from === 7 ? "w" : "b";   // `from` is a string like "g7" — always "b"
```

Rather than port the bug, work out what the function is actually for. It exists
because chess.com reports a promotion as `"Qg8="` or `"Qgxh1="` — figurine first,
then the square — and `chess.js` needs a `{from, to, promotion}` object. So the
real job is: given a promotion SAN token and whose turn it is, produce that
object. Written directly that's about 15 lines with one branch for the capture
form, not two parallel branches with divergent colour logic.

Getting the colour right is a behaviour change (today it is always `'b'`).
Verify against a real promotion on chess.com for both colours before and after.
Also delete the five `console.log` calls at `:270`, `:273`, `:276`, `:289`,
`:290`.

## 4.3 — `view/arrows.ts`

`draw_arrow` (`:425-460`), `getCoords` (`:415-423`) and `clear_arrows`
(`:462-467`) move here roughly as-is. Two things to fix while moving:

- The vector math at `:444-447` mutates `x0` and then uses the mutated value to
  compute `x1`:
  ```js
  x0 = x0 + 0.1 * ((x1 - x0) / d);
  x1 = x1 - 0.4 * ((x1 - x0) / d);   // <- x0 is already changed here
  ```
  The `y` lines use the pre-computed `dy` and are consistent; the `x` lines use
  a re-derived `(x1 - x0)` and are not. The arrowhead is therefore slightly
  off along x. Use `dx`/`dy` consistently.
- The SVG string at `:456` has a stray quote: `fill=${color}"`. Harmless in
  practice but it should be `fill="${color}"`.

`clear_arrows` checks `config.simon_says_mode` internally (`:463`) while its
only caller already checks the same flag (`:197`). Drop the inner check; let the
caller decide.

## 4.4 — `view/status.ts`

Owns the six DOM elements the current code reaches for by `getElementById`
scattered across the file: `chess_line_1`, `chess_line_2`, `evaluation`,
`progBar`, `game-detection`, `board`. Query them once at construction.

Note `new_pos` (`:173-176`) writes a `<progress id="progBar">` into
`chess_line_1` via `innerHTML`, and `on_stockfish_response` (`:384`) then reads
that element back by id. So the progress bar's existence depends on whether
`chess_line_1` was last written as HTML or as text — `:323` and `:328` overwrite
it with `innerText`, destroying the bar, after which `:384` operates on `null`.
Under `strict` this is a compile error, which is the good outcome: it forces the
progress bar to become an element that's always present and shown/hidden, rather
than one that's conditionally created and silently destroyed.

## 4.5 — `autoplay.ts`

Extracts `:342-354` and `request_automove` (`:394-401`). Its job: given a best
move and the config, decide whether to play it and rewrite the promotion suffix
to the user's preferred piece.

The promotion rewrite at `:345-351` uses `['q', 'k', 'r', 'b']` as the set of
promotion pieces — `'k'` is wrong, a pawn cannot promote to a king, and `'n'`
(knight) is missing. Since the check only gates whether the last character is
replaced, the practical effect is that a knight promotion from the engine
(`e7e8n`) is left alone instead of being rewritten. Use `'qrbn'`.

Also drop the `"BEFORE"`/`"AFTER"` logs at `:344` and `:352`.

## 4.6 — `click-backend.ts`

`dispatchClickEvent`, `requestDebuggerClick`, `dispatchMouseEvent`,
`requestPythonBackendClick`, `callPythonBackend` (`:474-528`) move as-is behind:

```ts
export interface ClickBackend { click(x: number, y: number): Promise<void> }
export function createClickBackend(config: Config): ClickBackend;
```

Delete `requestPythonBackendMove` (`:514`), which nothing calls.

`requestDebuggerClick` attaches the debugger on **every** click (`:485`) and
never detaches. Attaching when already attached is an error that's currently
swallowed because the callback ignores `chrome.runtime.lastError`. Attach once,
lazily, and keep the handle.

## 4.7 — `popup.ts`

What's left: read config, construct the modules, register the two
`DOMContentLoaded` handlers as one (`:17` and `:75` are both present today),
wire the message listener to a typed `switch`, start the refresh interval, and
attach the two button handlers. Target under 100 lines.

## Done when

- No file in `src/popup/` exceeds ~150 lines.
- No `substring(n, m)` with a literal offset remains — all string parsing goes
  through `shared/uci.ts` or `shared/board-state.ts`.
- No `console.log` remains outside an explicit debug helper.
