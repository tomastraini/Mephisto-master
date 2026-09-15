# Phase 2 — Shared contracts

## Status: done

Shipped. `src/shared/` now holds `board-state.ts`, `config.ts`, `messages.ts`
and `uci.ts`, imported by both the popup and the content script. Notes on what
differs from the plan below:

- **The `*****` protocol is gone.** No `'***'` or `'*****'` literal remains in
  `src/`. One piece of it was load-bearing and was kept: the old
  `res.replace(/[^\w-+=#*]/g, '')` scrub over the whole payload also stripped
  chess.com's figurine glyphs out of move text, without which a move reads
  `"N♘f3"`. That is now `sanitizeMoveToken`, applied per move.
- **`PiecePlacementState` keeps its `turn` field.** The board-reading plan's
  amendment (drop `turn`, add `lastMove`) is correct *for the position tracker*,
  which derives turn from its own history. Nothing derives it yet, so removing
  it now would just break the piece-scan path. Left as an amendment for
  whenever that plan is picked up.
- **Config keys stay snake_case.** The plan's sketch used camelCase, but these
  keys are also the localStorage keys and the Python backend's JSON field names
  — renaming them would silently discard every existing user's settings.
  `promotion_piece` was folded in from its bespoke localStorage access.
- **Defaults resolved to the options-page values**, including `autoplay: true`,
  per the decision taken when this phase started.
- **`loadConfig` uses `??` and a runtime type check** against the default's
  type, which is as much as a JSON blob from localStorage can be trusted for. A
  stored `0` or `false` now survives. `MIN_FEN_REFRESH_MS` clamps the poll
  interval, because `??` makes a stored `fen_refresh` of 0 reachable and
  `setInterval(fn, 0)` is a request to spin.
- **The fen cache now actually caches.** It previously looked up one key,
  discarded the result, recomputed the position unconditionally, and stored it
  under a *different* key — so it never hit once. It now keys on the move
  history, so a SAN replay happens per new position rather than per poll.
- **`console-log` was implemented** rather than deleted; it is the
  hand-and-brain hint channel and had a sender but an empty handler.
- **Two extras** beyond the plan, both in `board-state.ts`: `Square` is a
  template-literal type with `squareFromIndices` validating its inputs, and
  `toBoardIndex` snaps pixel-derived indices to a square within a tolerance.
  Together they drop pieces caught mid-animation instead of computing a garbage
  file letter for them, and stop floating-point error truncating a piece one
  file to the left.

Verified `parseInfo` against real Stockfish lines: the old `infoArr[9]` reads
the **node count as the score** whenever the engine omits `multipv`.

---

**Goal:** create `src/shared/` and move the three things that are currently
re-derived by hand on both sides of a boundary into one typed definition each:
the message protocol, the config, and the board state.

This is the highest-value phase. It depends on Phase 1 only because the content
script can't `import` until there's a bundler.

## 2.1 — `src/shared/messages.ts`

Today every message is an ad-hoc object literal, and the receiver distinguishes
them by truthiness-testing a marker property
(`content-script.js:44-58`, `popup.js:136-152`). There are eight message shapes
in flight, two of which have no sender and one of which has no handler (audit
finding B).

Replace with a discriminated union on a `kind` field:

```ts
export type PopupToContent =
  | { kind: 'query-fen' }
  | { kind: 'automove'; move: string }
  | { kind: 'automove-pv'; pv: string[] }
  | { kind: 'push-config'; config: Config }
  | { kind: 'console-log'; message: string };

export type ContentToPopup =
  | { kind: 'board-state'; state: BoardState; orientation: Orientation }
  | { kind: 'pull-config' }
  | { kind: 'simulate-click'; x: number; y: number };

export type Message = PopupToContent | ContentToPopup;
```

Then a typed send/receive pair so no call site touches `chrome.*` directly:

```ts
export function sendToActiveTab(message: PopupToContent): Promise<void>;
export function onMessage<T extends Message>(handler: (msg: T) => void): void;
```

Notes:

- `automove` and `automove-pv` are split apart deliberately. Today one message
  carries either `move` or `pv` and the receiver picks based on
  `config.puzzle_mode` (`content-script.js:49-53`), which means the sender's
  intent is reconstructed from config on the far side. Splitting the variant
  makes the payload say what it is.
- Dropping `cleanfen` and the dead `loadStockfishModule` subject is part of this
  step — the union simply won't have them.
- `console-log` currently has a sender and an empty handler
  (`content-script.js:57`). Decide explicitly: either implement it
  (`console.log(msg.message)`, one line, restores hand-and-brain logging) or
  delete the sender at `popup.js:403`. **Recommend implementing it** — it was
  clearly meant to work and it's one line.
- With the union in place, `switch (msg.kind)` gets exhaustiveness checking from
  `strict` mode. A new message variant becomes a compile error at every handler
  that doesn't cover it.

## 2.2 — `src/shared/config.ts`

One interface, one defaults object, one loader. This deletes the duplication and
the drift documented in audit finding E.

```ts
export interface Config {
  // engine
  computeTime: number;
  computeDepth: number;
  depthOrTime: boolean;
  // ...
}

export const DEFAULT_CONFIG: Config = { computeTime: 500, /* … */ };

export function loadConfig(): Config;   // merges stored values over defaults
export function saveConfig(patch: Partial<Config>): void;
```

Rules for this step:

- **`loadConfig` must not use `||`.** Use `stored[key] ?? DEFAULT_CONFIG[key]`,
  or better, check `key in stored`. This is a behaviour change: a user who has
  stored `0` or `false` will now get their value instead of the default. That's
  a bug fix (audit finding E) — call it out in the commit message.
- Resolve the three drifted defaults by picking a winner per key. The options
  page values (`compute_time: 500`, `preferred_responses: true`,
  `autoplay: true`) are the better set — they're what a user who has opened
  settings already has.
- Bring `promotion_piece` into the same structure instead of its bespoke
  `localStorage` path (`popup.js:20`, `:102`).
- `src/options/util/SettingsPage.ts` should derive its defaults from
  `DEFAULT_CONFIG` rather than passing a literal to `registerFormElement`. The
  signature becomes `registerFormElement(key: keyof Config, description, type)`
  — the key is now typed, so a typo in a setting name is a compile error.
- Keep `localStorage` for now. Moving to `chrome.storage` is a real improvement
  (it's async-safe and readable from the content script, which would remove the
  `push-config` round-trip entirely) but it's an async migration that touches
  every read site. Note it as a follow-up; don't bundle it into this phase.

## 2.3 — `src/shared/board-state.ts` — delete the `*****` protocol

The big one. Audit finding C explains why the string encoding exists for no
reason. Replace it with a structured type that travels over
`chrome.runtime.sendMessage` as an object:

```ts
export type Site = 'lichess' | 'chesscom' | 'blitztactics';
export type Orientation = 'white' | 'black';
export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${1|2|3|4|5|6|7|8}`;

export interface PlacedPiece {
  color: Color;
  type: PieceType;
  square: Square;
}

/** A game page: we know the move list, so the position is replayed from it. */
export interface MoveListState {
  source: 'move-list';
  site: Site;
  moves: string[];        // SAN, in order
}

/** A puzzle page: no move list, so we read the pieces off the DOM directly. */
export interface PiecePlacementState {
  source: 'piece-placement';
  site: Site;
  turn: Color;
  pieces: PlacedPiece[];
}

export type BoardState = MoveListState | PiecePlacementState;
```

What this removes, concretely:

- The `'***ccfen***'` / `'***lipuz***'` prefixes and the `3`/`8`/`11` substring
  offsets at `popup.js:209-212`. `state.site` and `state.source` replace them.
- The `'*****'` joining and splitting at eight sites in `content-script.js` and
  three in `popup.js`.
- The `res.replace(/[^\w-+=#*]/g, '')` scrub at `content-script.js:193`, which
  currently corrupts anything outside that character class.
- The `fen === '[object Object]'` guard at `popup.js:29` — a defensive check
  against a stringification bug that can't happen once the payload is an object.

The two `source` variants also make the shape of the code honest: today
`parse_fen_from_response` (`popup.js:203`) branches on
`metaTag.includes("puz")` to decide between two completely different decoding
strategies. That branch becomes a `switch (state.source)` with the compiler
checking both arms.

The `fenCache` (`popup.js:119`) keys off the raw move string with a regex
strip. Post-change it should key off `moves.slice(0, -1).join(' ')`, which is
the same idea stated directly.

## 2.4 — `src/shared/uci.ts`

Both the popup and the Python backend speak UCI text. Give the popup side a
real parser instead of positional indexing (audit finding F):

```ts
export interface BestMoveLine { bestmove: string; ponder?: string }
export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; moves: number };
export interface InfoLine { depth?: number; score?: Score; pv?: string[] }

export function parseBestMove(line: string): BestMoveLine | undefined;
export function parseInfo(line: string): InfoLine;
```

`parseInfo` walks tokens looking for `depth`, `score cp|mate` and `pv` by name.
This replaces `infoArr[9]` (`popup.js:375`) and makes `ponder` genuinely
optional, fixing the unguarded `arr[3]` at `:309`.

These are pure functions over strings — they're the first thing Phase 6 tests.

## Done when

- `src/shared/` exists with the four modules above, imported by both the popup
  and the content script.
- No `'*****'` or `'***'` literal remains anywhere in `src/`.
- No config default is written down in more than one place.
- `grep -rn "response\.\(queryfen\|automove\|pushConfig\)" src/` returns nothing
  — all message dispatch goes through `switch (msg.kind)`.
