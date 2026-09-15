# Phase 1 — Tooling & build

## Status: done

Shipped. `npm run build`, `npm run typecheck` and `npm run lint` are all green,
and `dist/` loads as an unpacked extension. What landed, and where it differs
from the plan below:

- **`tsconfig.json` is fully strict**, including `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, `verbatimModuleSyntax` and
  `isolatedModules`. Nothing needed to be relaxed.
- **esbuild, two builds.** An ESM build with code splitting for the popup,
  service worker and options page; a separate IIFE build for the content script,
  which cannot be a module. Output mirrors the source tree, so `manifest.json`
  and the HTML files kept their existing paths.
- **`require.js` is gone.** Its JavaScript half is replaced by
  `src/options/framework/pages.ts` — a statically listed map of dynamic imports,
  so the bundler can see and split every page while module bodies still execute
  after their markup is injected. Its CSS/HTML half moved to
  `framework/assets.ts`. This also removes the racy `moduleMap.latest` handshake.
- **`background-script.ts` was emptied, not ported.** Its only code path called
  an undefined `loadStockfishModule()` and would have thrown a ReferenceError;
  there was no behaviour to preserve, and it could not compile. The worker file
  is kept because the manifest declares it, with a TODO for Phase 2 to decide
  whether it should exist at all.
- **`src/shared/config.ts` and `src/shared/messages.ts` were added early**,
  carrying the *shapes* only. Typing the code at all required a name for the
  config and message objects. Phase 2 still owns unifying the *values* and
  switching `||` to `??`; both files carry TODOs saying so.
- **Type declarations**: `lib/chess.min.d.ts` sits next to the file it
  describes, so TypeScript finds it through normal resolution;
  `src/types/globals.d.ts` covers the `<script>`-tag globals `LRU`,
  `ChessBoard` and `M`.
- **`src/shared/dom.ts`** provides `byId`/`query`/`queryAll`. Strict mode would
  otherwise need a null check at roughly ninety call sites. `byId` throws on a
  missing id, which is what the old code already did — just with a message.
- **Two behavioural changes, both forced by the compiler**, both no-ops at
  runtime: `simulatePvMoves` called `simulateMove(move, false)` on a
  single-parameter function, so the ignored argument was dropped; and
  `simulatePromotionClicks` was `async` with nothing to await, so it became
  synchronous and its caller stopped awaiting it. Nothing else changed.
- **Extras not in the plan**: a `.gitattributes` to stop the CRLF churn that was
  reporting 62 unmodified files as modified, and `dist/`/`node_modules/` added
  to `.gitignore`.

Everything the audit flagged but this phase did not fix is marked in the source
with a `TODO(phase-N)` comment naming the phase that owns it. Two of the lint
findings are suppressed inline with an explanation rather than fixed, because
fixing them would change behaviour: the `[object Object]` startup path in
`popup.ts` (Phase 4) and the `||` config defaults (Phase 2).

---

**Goal:** get a TypeScript compiler and a bundler in front of the extension
without changing a single line of logic. At the end of this phase the extension
still behaves identically, but it is built from `src/` into `dist/` and the
compiler can see the code.

## Why a bundler is mandatory here

This isn't optional polish. MV3 content scripts declared in
`manifest.json:38-40` are loaded as **classic scripts** — they cannot use
`import`. So as long as there is no bundler, `content-script.ts` can never
import a shared type or constant from `popup.ts`, and Phase 2's whole premise
(one shared definition of messages, config and board state) is impossible.

Bundling the content script into a single IIFE is what unlocks everything else.

## Steps

### 1.1 — Add `package.json`

```jsonc
{
  "name": "mephisto",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "watch": "node scripts/build.mjs --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  }
}
```

Dev dependencies: `typescript`, `esbuild`, `@types/chrome`, `eslint`,
`typescript-eslint`, `vitest`.

**esbuild over Vite/Webpack**: this is four entry points and no framework.
esbuild's Node API in a ~40-line `scripts/build.mjs` is less machinery than a
Vite config with a CRX plugin, and it keeps the output readable, which matters
when debugging an unpacked extension.

### 1.2 — Add `tsconfig.json`

Start strict. The codebase is small enough that strictness is affordable, and
adopting it later never happens.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "types": ["chrome"],
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

`noUncheckedIndexedAccess` is the one that earns its keep immediately — it is
exactly what flags `arr[3]` at `popup.js:309` and `infoArr[9]` at `:375`.

### 1.3 — Declare the vendored globals

`lib/*.min.js` stay as they are, loaded by `<script>` tags. Give them a
`src/types/globals.d.ts` so the compiler knows about them:

```ts
declare class LRU<K, V> {
  constructor(max: number);
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  readonly tail: { value: V } | undefined;
}

interface ChessBoardInstance {
  position(): Record<string, string>;
  position(fen: string): void;
  orientation(): 'white' | 'black';
  orientation(side: 'white' | 'black'): void;
  move(move: string): void;
}
declare function ChessBoard(el: string, config: ChessBoardConfig): ChessBoardInstance;

declare const M: { Tooltip: { init(els: NodeListOf<Element>, opts: object): unknown[] } };
```

Only declare the members actually used — a narrow lie is more useful than a
broad `any`. `lib/chess.min.js` is already imported as a module
(`popup.js:1`); give it a matching `chess.d.ts` covering `Chess`, `load`,
`move`, `put`, `clear`, `setTurn`, `turn`, `fen`.

### 1.4 — Write `scripts/build.mjs`

Four entry points, four different output shapes:

| Entry | Format | Notes |
|---|---|---|
| `src/scripts/content-script.ts` | `iife` | **Must** be IIFE — classic script, no ESM |
| `src/popup/popup.ts` | `esm` | Loaded with `<script type="module">` |
| `src/scripts/background-script.ts` | `esm` | MV3 service worker supports modules |
| `src/options/options.ts` | `esm` | Plus the lazily-required page modules |

The options pages are loaded at runtime by `src/options/framework/require.js`,
which injects `<script src="${path}.js">` tags built from a path string. That
means those files must exist as individually addressable outputs — they can't be
rolled into one bundle. Either give each page its own esbuild entry point, or
(cleaner) replace `require.js` with static `import()` calls, which esbuild
understands and code-splits properly. **Prefer replacing it** — `require.js`
with its `moduleMap.latest` handshake (`require.js:16-18`, `:31`) is a
hand-rolled module loader that a bundler makes redundant, and it is racy if two
pages ever load concurrently.

The build also copies `manifest.json`, `_locales/`, `res/`, `lib/` and the HTML
and CSS files into `dist/`.

### 1.5 — Point the manifest at `dist/`

Build output is `dist/`, and `dist/` is what gets loaded as an unpacked
extension. Add `dist/` and `node_modules/` to `.gitignore`.

Also fix `manifest.json:43-44` while here: add `http://127.0.0.1:5000/*` to
`host_permissions` (see audit finding I).

### 1.6 — Rename `.js` → `.ts`, no other change

Rename every file under `src/`, run `tsc --noEmit`, and fix **only** what the
compiler complains about. Suppress anything that needs real thought with a
`// TODO(phase-N): …` comment referencing the phase that will handle it. The
point of this step is to reach a green compile with an unchanged program, not to
start refactoring.

Expect roughly: the implicit globals (fixed by 1.3), `arr[3]`/`infoArr[9]`
possibly-undefined, `config` and `board` used before assignment (they're
module-level `let`s initialised inside `DOMContentLoaded`), and `promotion`,
`piece`, `flags` flagged as unused in `makeMoveWithObject`.

### 1.7 — ESLint

Flat config, `typescript-eslint` recommended, plus `no-unused-vars` as an error
and `no-console` as a warning. The `no-console` warnings are the shopping list
for the debug logging noted in audit finding F.

## Done when

- `npm run build` produces a `dist/` that loads as an unpacked extension and
  behaves identically to today.
- `npm run typecheck` is green.
- `npm run lint` is green, or green modulo an explicit, reviewed suppression
  list.
- No behavioural change has been made. Diff is renames, types, and config.
