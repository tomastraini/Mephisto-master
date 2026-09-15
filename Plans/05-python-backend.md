# Phase 5 — Python backend

**Goal:** one backend instead of two drifted copies, with type hints, safe
concurrent engine access, and the tuning constants separated from the logic.

Touches no JavaScript. Can be done independently of every other phase.

## The problem

`Stockfish API For Windows/stockfishapi.py` (424 lines) and
`Stockfish API for Linux/stockfishapi.py` (257 lines) are supposed to be the
same service. They aren't:

- Linux still runs the old O(n) per-move search loops for the worst / aggressive
  / human modes. Windows was rewritten to use one MultiPV analysis. **The three
  "change evaluation" modes behave differently depending on the user's OS.**
- Linux hardcodes `'~/Descargas/Mephisto-master-main/Stockfish API for Linux'`
  (`:13-14`). It runs on exactly one machine.
- `preferred_responses.json` is duplicated, and Windows has seven Queen's Pawn
  entries Linux lacks.

The only genuine per-platform difference is the engine binary filename
(`stockfish.exe` vs `stockfishl`).

## Target layout

```
backend/
  pyproject.toml
  mephisto_backend/
    __init__.py
    app.py            Flask routes
    engine.py         Stockfish process management
    settings.py       tuning constants + engine path resolution
    modes.py          worst / aggressive / human move selection
    heuristics.py     intimidation_score, human_naturalness, piece values
    book.py           lichess opening explorer client
    preferred.py      preferred_responses.json loading
  data/
    preferred_responses.json
  engines/
    .gitkeep          binaries live here, not in git (see 5.5)
```

One `preferred_responses.json`. One implementation of each mode.

## 5.1 — Resolve the engine path instead of hardcoding it

```python
# settings.py
ENGINE_DIR = Path(__file__).resolve().parent.parent / "engines"
ENGINE_NAME = "stockfish.exe" if sys.platform == "win32" else "stockfish"
ENGINE_PATH = Path(os.environ.get("MEPHISTO_ENGINE", ENGINE_DIR / ENGINE_NAME))
```

The Windows copy already derives `current_dir` from `__file__` (fixed in commit
`0b49616`); this generalises it and adds an env-var override so the binary
doesn't have to live inside the repo.

Fail loudly at startup if the binary is missing, with the resolved path in the
message. Today a missing binary is an opaque `FileNotFoundError` from `Popen`.

## 5.2 — Fix the engine concurrency

This is the correctness item in this phase.

The service currently starts **two** Stockfish processes:

- a raw `subprocess.Popen` (`:18`), used by the main analysis path
  (`:397-413`), and
- a `chess.engine.SimpleEngine` (`:25`), used by the worst/aggressive/human
  modes.

The `SimpleEngine` path is guarded by `engine_lock`. **The raw pipe is not.**
Flask serves requests on threads, so two concurrent requests will interleave
their `position`/`go` writes into one stdin and then race to consume each
other's lines from one stdout — the `for line in stockfish_process.stdout` loop
at `:405` takes whatever arrives, including another request's output.

The popup polls on a timer and fires two requests per position, so this is not a
theoretical race.

Two options:

1. **Drop the raw pipe entirely** and serve the main path from `SimpleEngine`
   too, under the same lock. `SimpleEngine.analyse()` returns depth, score and
   pv, which is everything `handle_stockfish` reconstructs by hand at
   `:406-418`. This halves the number of Stockfish processes and removes a whole
   class of parsing code. **Recommended.**
2. Keep the raw pipe but put it behind its own lock and a proper
   read-until-`bestmove` helper.

Option 1 is the better outcome and is mostly deletion. The only reason to prefer
2 is if some caller depends on the raw `info depth …` line being passed through
verbatim — and one does: the popup's `'info'` response type forwards the raw
string to `parseInfo`. That's fine, since the line can be reconstructed from
`SimpleEngine`'s structured result, or Phase 2's `uci.ts` can take structured
JSON instead. Prefer the latter: sending JSON to a JSON API and then parsing UCI
text out of it is a layering mistake worth removing while both sides are open.

## 5.3 — Separate tuning constants from logic

`settings.py` already has a home for the block currently at lines 30-60 of the
Windows file (`WORST_SEARCH_TIME`, `AGGRESSIVE_MARGIN`, `HUMAN_TEMPERATURE`,
…). Load them from environment variables with the current values as defaults, so
the human-play feel can be tuned without editing code:

```python
HUMAN_TEMPERATURE = float(os.environ.get("MEPHISTO_HUMAN_TEMPERATURE", 90.0))
```

## 5.4 — Type hints and request validation

Add hints throughout — `python-chess` ships type information, so this is cheap
and catches real mistakes:

```python
def rank_moves(board: chess.Board, engine: SimpleEngine,
               search_time: float, limit: int | None = None) -> list[tuple[chess.Move, int]]:
```

Run `mypy` (or `pyright`) in CI alongside the TypeScript check.

For the request body, `handle_stockfish` (`:336-420`) mixes `data['x']` and
`data.get('x')`, so a missing key is a 500 rather than a 400. Define the payload
once — a `@dataclass` with a `from_json` classmethod is enough; pydantic if
you'd rather. Field names and types should match Phase 2's `Config`, so there is
one agreed wire shape rather than two.

While in there, fix the 1-space indentation at `:354-357`.

## 5.5 — Get the engine binary out of git

`Stockfish API For Windows/stockfish.exe` is **98.27 MB**, committed directly.
GitHub warns on every push, and it is now in history twice (a 70 MB version and
a 98 MB version), so the repo carries ~170 MB of binary forever.

Options, in order of preference:

1. **Don't track it.** Add `engines/` to `.gitignore` and provide
   `scripts/fetch-engine.py` that downloads the right build for the platform.
   Cleanest, and it's how Stockfish is normally distributed.
2. **Git LFS.** Keeps `git clone` working out of the box but requires LFS on
   every clone and has quota implications.

Either way, purging the existing blobs from history requires a force-push and a
re-clone for anyone else with the repo. Since this looks like a single-user
fork, that's probably acceptable — but confirm before rewriting history, and do
it as its own isolated commit, not folded into a refactor.

## 5.6 — Also fold in the clicker

`src/scripts/mephisto-clicker.py` is the `localhost:8080` click backend the
extension talks to (`popup.js:511`). It is unrelated to the chess engine but is
the same kind of thing — a small local Flask service the extension depends on.
Move it under `backend/` as a second entry point so there is one Python project
with one dependency set, rather than a loose script in `src/scripts/`.

## Done when

- One `stockfishapi` implementation exists; the `Stockfish API for Linux/` and
  `Stockfish API For Windows/` directories are gone.
- The same code runs on both platforms, differing only in the resolved binary
  path.
- `mypy` is clean.
- The three evaluation modes produce identical behaviour on Windows and Linux.
- No engine binary is tracked in git.
