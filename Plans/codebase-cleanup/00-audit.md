# Phase 0 — Audit

Findings from reading the tree at commit `0b49616`. Everything here is cited to
a file and line so the later phases can be checked against reality rather than
against a vibe.

## A. There is no tooling at all

There is no `package.json`, no `tsconfig.json`, no bundler, no linter, no test
runner, and no `dist/`. `manifest.json` points the browser straight at the
source files. Consequences:

- No type checking is possible today, even via JSDoc — nothing runs over the
  code.
- `lib/*.min.js` are loaded as `<script>` tags in `src/popup/popup.html:11-14`,
  so `$`, `LRU`, `ChessBoard` and `M` are **implicit globals** with no
  declaration anywhere (`popup.js:109`, `:119`, `:169`).
- `popup.js` is an ES module (`manifest`-free, loaded with
  `<script type="module">`) but `content-script.js` is a classic script injected
  by `manifest.json:38-40`. The two files cannot share an `import` today. This
  is *the* structural reason the message protocol and config defaults are
  duplicated rather than shared.

## B. Dead and broken code

| Location | Finding |
|---|---|
| `src/scripts/background-script.js:7` | Calls `loadStockfishModule()`, which is defined nowhere in the repo. The service worker throws on its only code path — it has never worked. Nothing sends `subject: 'loadStockfishModule'` either, so the whole file is dead. |
| `src/scripts/content-script.js:302` | `getRanksFiles()` is defined and never called. |
| `src/popup/popup.js:514` | `requestPythonBackendMove()` is defined and never called. |
| `src/popup/popup.js:26-27` | `callworstmove` is a hardcoded `false`; the `/stockfish/worst` branch is unreachable and that route does not exist on the backend. |
| `src/popup/popup.js:150-151` | `else if (response.cleanfen) { }` — empty branch, nothing sends `cleanfen`. |
| `src/scripts/content-script.js:57-58` | `else if (response.consoleMessage) { }` — empty branch, but `popup.js:403` *does* send it. Hand-and-brain console logging is silently a no-op. |

## C. The DOM → FEN wire format is a hand-rolled string protocol

`content-script.js:61-194` serialises board state into a single string:

```
'***ccfen***' + move + '*****' + move + '*****' ...
'***lipuz***' + turn  + '*****' + 'w-p-e2' + '*****' ...
```

and `popup.js:203-243` decodes it with magic offsets:

```js
const metaTag = txt.substring(3, 8);   // 'ccfen'
const prefix  = metaTag.substring(0, 2); // 'cc'
txt = txt.substring(11);                 // skip '***ccfen***'
```

The producer and the consumer are in different files, ~500 lines apart, with no
shared constant — the `3`, `8`, `11` and `*****` are re-derived by hand on each
side. `content-script.js:193` then runs `res.replace(/[^\w-+=#*]/g, '')` over
the whole payload, so any character outside that class is silently dropped.

This encoding is **not required by anything**. `chrome.runtime.sendMessage`
serialises with the structured clone algorithm and will happily carry an object.
The string exists for no reason and is the single biggest source of fragility in
the extension. Phase 2 deletes it.

## D. Site branching is duplicated eight times

`content-script.js` contains the same `if (site === 'chesscom') … else if
(site === 'lichess') … else if (site === 'blitztactics')` chain in eight
functions: `getMoves` (:61), `getOrientation` (:196), `getSelectedMoveRecord`
(:222), `getMoveRecords` (:235), `getLastMoveHighlights` (:254), `getTurn`
(:279), `getRanksFiles` (:302), `getBoard` (:322), `getPromotionSelection`
(:334).

Worse, lichess and blitztactics are backed by the same board library
(chessground) and their bodies are **byte-identical** in `getMoves`
(:153-172 vs :173-191), `getRanksFiles` (:312-318), `getBoard` (:326-330) and
`getOrientation` (:202-207). The blitztactics arm is a copy-paste of the lichess
arm in every case.

Adding a fifth site today means touching nine functions.

## E. Config is defined twice and has already drifted

Defaults live in `popup.js:77-103` *and* in
`src/options/pages/settings/general/general.js:70-90` /
`appearance.js:7-9`. They disagree:

| Key | `popup.js` | options page |
|---|---|---|
| `compute_time` | `200` | `500` |
| `preferred_responses` | `false` | `true` |
| `autoplay` | `false` | `true` |

Whichever value wins depends on whether the user has ever opened the settings
page and pressed Apply. Additionally:

- Every default in `popup.js` uses `JSON.parse(...) || default`, so a stored
  value of `0` or `false` is **silently replaced by the default**. A user who
  sets `think_time` to `0` gets `20`.
- `promotion_piece` bypasses the settings framework entirely — it is written
  straight to `localStorage` from `popup.js:20` and read at `:102` with `??`.
  It is the only key that handles falsy values correctly, by accident.
- Settings are stored in `localStorage`, not `chrome.storage`. This happens to
  work because the popup and options page share an extension origin, but it
  means the content script can never read config directly; hence the
  `pushConfig` message round-trip (`popup.js:409`, `content-script.js:55`).

## F. `popup.js` mixes every concern in one file

528 lines covering: config loading, HTTP client, FEN parsing, chessboard
rendering, SVG arrow drawing, UCI response parsing, DOM text updates, autoplay
dispatch, progress-bar animation, and Chrome debugger mouse injection.

Specific rough edges:

- `on_stockfish_response` (`:297-386`) does response parsing *and* six different
  DOM writes *and* autoplay *and* the progress bar.
- `:309` reads `arr[3]` from the split `bestmove` line with no length guard. A
  `bestmove e2e4` with no ponder throws.
- `:375` reads the score with `infoArr[9]` — a fixed positional index into a
  UCI `info` line. Any change in field order or an extra field shifts it. It
  should be parsed by looking for the `cp` / `mate` token.
- `:30-56` builds two near-identical request payloads differing only in
  `depth` vs `movetime`.
- `:122-133` and `:178-189` are the same fetch-info-then-fetch-bestmove chain,
  copy-pasted.
- `makeMoveWithObject` (`:257-295`) is two near-duplicate branches. `:287` reads
  `const color = from === 7 ? "w" : "b"` where `from` is a string like `"g7"` —
  the comparison is always false, so `color` is always `"b"`. `promotion`,
  `piece` and `flags` are bound and unused in both branches, and there are five
  `console.log` calls left in (`:270`, `:273`, `:276`, `:289`, `:290`).
- `:344`/`:352` log `"BEFORE"` / `"AFTER"` on every autoplay move.
- There are two `DOMContentLoaded` listeners (`:17` and `:75`).

## G. The chess.com auto-rematch clicker runs on every message

`content-script.js:33-43` looks for the game-over modal and clicks
`"New 5 min"` — but it sits at the top of the `onMessage` listener, before the
`queryfen` / `automove` / `pushConfig` dispatch. It therefore runs on *every*
inbound message, several times a second, regardless of what the message was.
The button text is also hardcoded to one specific time control.

## H. Python backend: two copies, one of them broken

`Stockfish API For Windows/stockfishapi.py` (424 lines) and
`Stockfish API for Linux/stockfishapi.py` (257 lines) are meant to be the same
service. They are not:

- The Linux copy still has the old O(legal_moves) per-move search loops that the
  Windows copy replaced, so the worst/aggressive/human modes behave differently
  per platform.
- The Linux copy hardcodes `'~/Descargas/Mephisto-master-main/…'`
  (`:13-14`) — it only runs on one person's machine.
- `preferred_responses.json` is also duplicated, and the Windows copy has seven
  Queen's Pawn entries the Linux copy lacks.

Inside the Windows copy:

- **Two Stockfish processes are started per run**: a raw `subprocess.Popen`
  (`:18`) and a `SimpleEngine` (`:25`). Both run the same binary.
- The raw pipe is used for the main analysis path (`:397-413`) with **no lock**.
  Flask serves requests on threads, so two concurrent requests interleave their
  `position`/`go` writes on one stdin and then race to read each other's lines
  off one stdout. The `SimpleEngine` path *is* locked (`engine_lock`), the raw
  path is not.
- The popup makes **two** HTTP calls per position — one `info`, one `bestmove`
  (`popup.js:122-130`) — so every position is searched twice.
- `handle_stockfish` (`:336-420`) reads request keys with a mix of `data['x']`
  and `data.get('x')`; a missing key is a 500 rather than a 400.
- Indentation at `:354-357` is 1-space, inconsistent with the rest of the file.

## I. Repository hygiene

- `Stockfish API For Windows/stockfish.exe` is 98.27 MB and is committed
  directly. GitHub warns on every push. It should be Git LFS or a download step.
- 62 of the 67 files reported as modified by `git status` at the start of this
  work had no content diff at all — a CRLF/`core.autocrlf` mismatch. A
  `.gitattributes` would stop the churn.
- `manifest.json:43-44` declares `host_permissions` for `localhost:8080`
  (the Python clicker) but **not** for `127.0.0.1:5000`, which is where the
  Stockfish API actually lives (`popup.js:27`). It works today only because the
  popup page's own fetches aren't subject to that restriction, which is a
  fragile thing to depend on.
