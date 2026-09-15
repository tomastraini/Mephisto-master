// What the content script observed on the page, as structured data.
//
// This replaces a hand-rolled string protocol: the content script used to
// serialise the board into '***ccfen***' + move + '*****' + move + ... and the
// popup decoded it with literal substring offsets (3, 8, 11) re-derived by hand
// ~500 lines away in another file. Nothing required that encoding --
// chrome.runtime.sendMessage serialises with structured clone and carries an
// object perfectly well.

export type Site = 'lichess' | 'chesscom' | 'blitztactics';
export type Orientation = 'white' | 'black';
export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

const SQUARE_PATTERN = /^[a-h][1-8]$/;

export function isSquare(value: string): value is Square {
    return SQUARE_PATTERN.test(value);
}

/**
 * Builds a square from zero-based file/rank indices, or null if either is out
 * of range or fractional.
 *
 * Fractional indices are not hypothetical: piece coordinates are recovered from
 * CSS transforms, and a piece captured mid-animation sits between squares. The
 * old code fed those straight into String.fromCharCode and produced a garbage
 * file letter, which chess.js then silently rejected.
 */
export function squareFromIndices(fileIndex: number, rankIndex: number): Square | null {
    if (!Number.isInteger(fileIndex) || !Number.isInteger(rankIndex)) return null;
    if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) return null;
    return `${String.fromCharCode('a'.charCodeAt(0) + fileIndex)}${rankIndex + 1}` as Square;
}

/**
 * Snaps a board index recovered from pixel geometry to an integer, or returns
 * null when it is not close enough to one to be a real square.
 *
 * Two things make this necessary. Dividing a CSS translate by a square width
 * rarely lands exactly on an integer, so a bare truncation can drop a piece one
 * file to the left. And a piece caught mid-animation genuinely sits between
 * squares, which should be skipped rather than rounded to a neighbour.
 */
export function toBoardIndex(value: number, tolerance = 0.05): number | null {
    const rounded = Math.round(value);
    return Math.abs(value - rounded) <= tolerance ? rounded : null;
}

export interface PlacedPiece {
    color: Color;
    type: PieceType;
    square: Square;
}

/** A game page: the move list is readable, so the position is replayed from it. */
export interface MoveListState {
    source: 'move-list';
    site: Site;
    /** SAN, in order. Promotions arrive in the site's own notation. */
    moves: string[];
}

/** A puzzle page, or a site whose move list cannot be read: the pieces are read directly. */
export interface PiecePlacementState {
    source: 'piece-placement';
    site: Site;
    turn: Color;
    pieces: PlacedPiece[];
}

export type BoardState = MoveListState | PiecePlacementState;

export const SITE_NAMES: Record<Site, string> = {
    lichess: 'Game detected on Lichess.org',
    chesscom: 'Game detected on Chess.com',
    blitztactics: 'Game detected on BlitzTactics.com',
};

/**
 * Strips characters that cannot appear in the move notation chess.js accepts.
 *
 * Load-bearing: chess.com renders a move as a figurine glyph plus the text, and
 * the piece letter is recovered separately from a data-figurine attribute, so
 * the glyph has to come out or the token reads "N♘f3". The old code applied
 * this to the whole concatenated payload; applying it per move is the same
 * thing without the '*' separator to preserve.
 */
export function sanitizeMoveToken(move: string): string {
    return move.replace(/[^\w\-+=#]/g, '');
}
