// The shape of the extension's settings.
//
// TODO(phase-2): the *values* are still defined twice -- once in popup.ts and
// once in the options pages' registerFormElement calls -- and they have already
// drifted (compute_time 200 vs 500, preferred_responses and autoplay inverted).
// Phase 2 collapses them into a single DEFAULT_CONFIG here and replaces the
// `||` fallbacks in popup.ts with `??` so that a stored 0/false survives.
// This file currently declares the shape only.

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
    promotionPiece: PieceCode;
}
