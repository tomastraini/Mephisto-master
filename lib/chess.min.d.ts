// Declarations for the vendored chess.js build. TypeScript picks this up
// automatically when resolving `import { Chess } from ".../lib/chess.min.js"`.
//
// Covers only the surface the extension uses. Note that `setTurn` is not part
// of upstream chess.js -- it was added to this build so puzzle positions, which
// are read piece-by-piece off the DOM and have no move history, can declare
// whose turn it is.

export type Color = 'w' | 'b';
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
    type: PieceSymbol;
    color: Color;
}

/**
 * A move given as an object rather than SAN. The extension uses this form when
 * a site reports a promotion in a shape that is not valid SAN.
 */
export interface MoveSpec {
    from: string;
    to: string;
    promotion?: string;
    piece?: PieceSymbol;
    color?: Color;
    flags?: string;
}

export interface Move extends MoveSpec {
    san: string;
}

export declare class Chess {
    constructor(fen?: string);
    load(fen: string): boolean;
    clear(): void;
    put(piece: Piece, square: string): boolean;
    setTurn(color: string): void;
    turn(): Color;
    move(move: string | MoveSpec): Move | null;
    fen(): string;
}

export declare const WHITE: 'w';
export declare const BLACK: 'b';
export declare const PAWN: 'p';
export declare const KNIGHT: 'n';
export declare const BISHOP: 'b';
export declare const ROOK: 'r';
export declare const QUEEN: 'q';
export declare const KING: 'k';
