// The extension's settings: one interface, one set of defaults, one loader.
//
// These values used to be written down twice -- once in popup.ts and once in
// each options page's registerFormElement calls -- and had drifted: compute_time
// was 200 in one place and 500 in the other, preferred_responses and autoplay
// were inverted. Which value won depended on whether the user had ever opened
// Settings and pressed Apply.
//
// The keys are deliberately snake_case: they are also the localStorage keys and
// the field names the Python backend reads, so renaming them would silently
// discard every existing user's settings.

export type PieceCode = 'Q' | 'R' | 'B' | 'N';

/** Which side the alternate move-selection modes apply to: white, black, both. */
export type EvaluationColor = 1 | 2 | 3;

/** Which alternate move-selection mode the backend uses: worst, aggressive, human. */
export type EvaluationType = 1 | 2 | 3;

export interface ExtensionConfig {
    // engine
    compute_time: number;
    compute_depth: number;
    depth_or_time: boolean;
    preferred_responses: boolean;
    change_evaluation: boolean;
    evaluation_color: EvaluationColor;
    evaluation_type: EvaluationType;
    maximum_book_move: number;
    bookmoves: boolean;
    play_elo: number;

    // behaviour
    fen_refresh: number;
    think_time: number;
    think_variance: number;
    move_time: number;
    move_variance: number;
    simon_says_mode: boolean;
    autoplay: boolean;
    puzzle_mode: boolean;
    python_autoplay_backend: boolean;

    // appearance
    pieces: string;
    board: string;
    coordinates: boolean;
    promotion_piece: PieceCode;
}

export type ConfigKey = keyof ExtensionConfig;

export const DEFAULT_CONFIG: ExtensionConfig = {
    compute_time: 500,
    compute_depth: 16,
    depth_or_time: false,
    preferred_responses: true,
    change_evaluation: false,
    evaluation_color: 3,
    evaluation_type: 2,
    maximum_book_move: 8,
    bookmoves: false,
    play_elo: 1200,

    fen_refresh: 20,
    think_time: 20,
    think_variance: 20,
    move_time: 20,
    move_variance: 20,
    simon_says_mode: false,
    autoplay: true,
    puzzle_mode: false,
    python_autoplay_backend: false,

    pieces: 'wikipedia.svg',
    board: 'brown',
    coordinates: false,
    promotion_piece: 'Q',
};

/**
 * Reads one stored setting, or undefined if it is absent or unreadable.
 *
 * Settings are stored as JSON. An empty string is treated as absent: clearing a
 * number input stores "" and JSON.parse would throw on it.
 */
function readStored(key: ConfigKey): unknown {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

/**
 * Loads the stored settings over the defaults.
 *
 * Note `??`, not `||`. The old code used `JSON.parse(...) || default`, so a
 * legitimately stored 0 or false was discarded in favour of the default -- a
 * user who set a think time of 0 silently got 20.
 */
export function loadConfig(): ExtensionConfig {
    const config = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG) as ConfigKey[]) {
        const stored = readStored(key);
        if (stored !== undefined && typeof stored === typeof DEFAULT_CONFIG[key]) {
            // The runtime type has been checked against the default's, which is
            // as much as a JSON blob from localStorage can be trusted for.
            (config as Record<ConfigKey, unknown>)[key] = stored;
        }
    }
    return config;
}

/**
 * Polling any faster than this pins the CPU without showing anything new, and
 * `setInterval(fn, 0)` is a request to run as fast as the browser allows.
 */
export const MIN_FEN_REFRESH_MS = 10;
