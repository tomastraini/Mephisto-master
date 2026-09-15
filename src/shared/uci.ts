// Parsing for the UCI text the engine backend returns.
//
// The popup used to read these lines by fixed position -- `arr[3]` for the
// ponder move and `infoArr[9]` for the score. The latter only lands on the
// score because Stockfish happens to emit `seldepth` and `multipv` before it;
// drop either and index 9 is the node count. Parsing by token name instead
// makes the lines self-describing and makes `ponder` properly optional.

export interface BestMove {
    best: string;
    /** UCI omits this when there is no reply to ponder on, e.g. at mate. */
    ponder?: string;
}

export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; moves: number };

export interface Info {
    depth?: number;
    score?: Score;
    pv?: string[];
}

/** Parses "bestmove e2e4 ponder e7e5". Returns null if the line is not one. */
export function parseBestMove(line: string): BestMove | null {
    const tokens = line.trim().split(/\s+/);
    const index = tokens.indexOf('bestmove');
    const best = index === -1 ? undefined : tokens[index + 1];
    if (best === undefined) return null;

    const ponderIndex = tokens.indexOf('ponder');
    const ponder = ponderIndex === -1 ? undefined : tokens[ponderIndex + 1];

    return ponder !== undefined && ponder !== '(none)' ? { best, ponder } : { best };
}

/** Parses an "info depth ... score cp ... pv ..." line. Absent fields stay undefined. */
export function parseInfo(line: string): Info {
    const tokens = line.trim().split(/\s+/);
    const info: Info = {};

    const depthIndex = tokens.indexOf('depth');
    if (depthIndex !== -1) {
        const depth = Number(tokens[depthIndex + 1]);
        if (Number.isFinite(depth)) info.depth = depth;
    }

    const scoreIndex = tokens.indexOf('score');
    if (scoreIndex !== -1) {
        const unit = tokens[scoreIndex + 1];
        const value = Number(tokens[scoreIndex + 2]);
        if (Number.isFinite(value)) {
            if (unit === 'cp') info.score = { kind: 'cp', value };
            else if (unit === 'mate') info.score = { kind: 'mate', moves: value };
        }
    }

    // `pv` is always last, so everything after it is the variation.
    const pvIndex = tokens.indexOf('pv');
    if (pvIndex !== -1) {
        const pv = tokens.slice(pvIndex + 1);
        if (pv.length) info.pv = pv;
    }

    return info;
}
