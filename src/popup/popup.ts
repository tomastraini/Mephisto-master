import { Chess, type Color, type MoveSpec, type PieceSymbol } from '../../lib/chess.min.js';
import { type BoardState, SITE_NAMES } from '../shared/board-state';
import { type ExtensionConfig, loadConfig, MIN_FEN_REFRESH_MS } from '../shared/config';
import { byId, findById, query } from '../shared/dom';
import { type ContentToPopup, isMessage, type PopupToContent } from '../shared/messages';
import { parseBestMove, parseInfo } from '../shared/uci';

interface StockfishResponse {
    response: string;
    play_yes?: boolean;
}

/** What the backend sends when it turns a request away instead of answering it. */
interface StockfishError {
    error: string;
}

let board: ChessBoardInstance;
let fenCache: LRU<string, string>;
let config: ExtensionConfig;

let isCalculating = false;
let prog = 0;
let lastFen = '';
let lastPv: string[] = [];
let lastScore: number | string = '';
let lastBestMove = '';
let lastResponseMove = '';
let turn: Color | '' = '';

async function fetchStockfishAPI(fen: string, fromWhere: 'info' | 'bestmove'): Promise<StockfishResponse | undefined> {
    const url = 'http://127.0.0.1:5000/stockfish';
    if (fen === undefined || fen === '' || fen.includes('undef')) return;
    if (fen === '[object Object]') {
        fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    }
    const objectToSend = {
        fen: fen,
        type: fromWhere,
        depth: config.depth_or_time ? config.compute_depth : null,
        movetime: config.depth_or_time ? null : config.compute_time,
        bookmoves: config.bookmoves,
        maximum_book_move: config.maximum_book_move,
        play_elo: config.play_elo,
        preferred_responses: config.preferred_responses,
        change_evaluation: config.change_evaluation,
        evaluation_color: config.evaluation_color,
        evaluation_type: config.evaluation_type,
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(objectToSend),
    });

    // The backend rejects positions and search limits it can't use (a board read
    // that dropped a piece, a missing compute time) rather than handing them to
    // Stockfish, which used to exit on them. Report why instead of letting an
    // absent `response` throw further down.
    const body = (await response.json()) as StockfishResponse | StockfishError;
    if (!response.ok || !('response' in body)) {
        const reason = 'error' in body ? body.error : `HTTP ${response.status}`;
        // eslint-disable-next-line no-console -- the backend refusing a request should not be silent
        console.warn(`Mephisto: engine request rejected — ${reason}`);
        return undefined;
    }
    return body;
}

const pieceNameMap: Record<string, string> = {
    P: 'Pawn',
    R: 'Rook',
    N: 'Knight',
    B: 'Bishop',
    Q: 'Queen',
    K: 'King',
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll<HTMLInputElement>('input[name="promotion"]').forEach((radio) => {
        radio.addEventListener('click', () => {
            localStorage.setItem('promotion_piece', radio.value);
        });
    });

    config = loadConfig();
    push_config();

    // init chess board
    byId('board').classList.add(config.board);
    const [pieceSet, ext] = config.pieces.split('.');
    board = ChessBoard('board', {
        position: 'start',
        pieceTheme: `/res/chesspieces/${pieceSet}/{piece}.${ext}`,
        appearSpeed: 'fast',
        moveSpeed: 'fast',
        showNotation: config.coordinates,
        draggable: false,
    });

    // init fen LRU cache
    fenCache = new LRU(1000);
    const fen = fenCache.tail ?? { value: '' };

    // TODO(phase-4): `${fen}` stringifies an object to "[object Object]", which
    // is what the guard at the top of fetchStockfishAPI rewrites to the start
    // position. The whole dance means "analyse the starting position". Kept
    // verbatim so this phase changes no behaviour; the lint rules below are
    // correct and are what flagged it.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
    void analysePosition(`${fen}`);

    chrome.runtime.onMessage.addListener((message: unknown) => {
        if (!isMessage<ContentToPopup>(message)) return;
        switch (message.kind) {
            case 'board-state': {
                if (!message.state) break;
                if (board.orientation() !== message.orientation) {
                    board.orientation(message.orientation);
                }
                const fen = toFen(message.state);
                if (lastFen !== fen) {
                    new_pos(fen);
                }
                break;
            }
            case 'pull-config':
                push_config();
                break;
            case 'simulate-click':
                void dispatchClickEvent(message.x, message.y);
                break;
        }
    });

    // query the board periodically from the content-script
    request_fen();
    setInterval(request_fen, Math.max(config.fen_refresh, MIN_FEN_REFRESH_MS));

    // register button click listeners
    byId('analyze').addEventListener('click', () => {
        window.open(`https://lichess.org/analysis?fen=${lastFen}`, '_blank');
    });
    byId('config').addEventListener('click', () => {
        window.open('/src/options/options.html', '_blank');
    });

    // initialize materialize
    M.Tooltip.init(document.querySelectorAll('.tooltipped'), {});
});

/** Asks the engine for an evaluation, then for the move it would play. */
async function analysePosition(fen: string): Promise<void> {
    try {
        on_stockfish_response(await fetchStockfishAPI(fen, 'info'));
        on_stockfish_response(await fetchStockfishAPI(fen, 'bestmove'));
    } finally {
        // TODO(phase-4): a failed fetch leaves the popup showing "Calculating..."
        // with no indication that the local engine is not running.
        toggle_calculating(false);
    }
}

function new_pos(fen: string): void {
    byId('chess_line_1').innerHTML = `
        <div>Calculating...<div>
        <progress id="progBar" value="2" max="100">
    `;
    byId('chess_line_2').innerText = '';
    void analysePosition(fen);

    board.position(fen);
    lastFen = fen;
    if (config.simon_says_mode) {
        draw_arrow(lastBestMove, 'blue', byId('move-arrow'));
        draw_arrow(lastResponseMove, 'red', byId('response-arrow'));
        request_console_log(`Best Move: ${lastBestMove}`);
    } else {
        clear_arrows();
    }
    toggle_calculating(true);
}

function toFen(state: BoardState): string {
    byId('game-detection').innerText = SITE_NAMES[state.site];
    switch (state.source) {
        case 'piece-placement':
            return fenFromPlacement(state);
        case 'move-list':
            return fenFromMoveList(state);
    }
}

/**
 * Rebuilds a position that was read piece by piece.
 *
 * Used for puzzles, and for any site whose move list cannot be read.
 */
function fenFromPlacement(state: Extract<BoardState, { source: 'piece-placement' }>): string {
    const chess = new Chess();
    chess.clear(); // clear the board so we can place our pieces
    for (const piece of state.pieces) {
        chess.put({ type: piece.type, color: piece.color }, piece.square);
    }
    chess.setTurn(state.turn);
    turn = chess.turn();
    return restoreCastlingRights(chess);
}

/**
 * Replays a move list into a position.
 *
 * All but the last move are replayed through a cache, since they do not change
 * between polls; only the final move is applied fresh each time.
 */
function fenFromMoveList(state: Extract<BoardState, { source: 'move-list' }>): string {
    const history = state.moves.slice(0, -1);
    const lastMove = state.moves[state.moves.length - 1];
    const cacheKey = history.join(' ');

    let position = fenCache.get(cacheKey);
    if (position === undefined) {
        position = replayMoves(history);
        fenCache.set(cacheKey, position);
    }

    const chess = new Chess();
    chess.load(position);
    if (lastMove) {
        chess.move(lastMove.includes('=') ? makeMoveWithObject(lastMove) : lastMove);
    }
    turn = chess.turn();
    return chess.fen();
}

function replayMoves(moves: string[]): string {
    const chess = new Chess();
    for (const move of moves) {
        chess.move(move.includes('=') ? makeMoveWithObject(move) : move);
    }
    return chess.fen();
}

/**
 * Puts castling rights back into a position that was rebuilt piece by piece.
 *
 * `chess.clear()` zeroes the rights and `put()` never restores them, so every
 * position reconstructed from a piece scan -- which is all of lichess, all
 * puzzles and all of blitztactics -- reached Stockfish with castling forbidden
 * and got a correspondingly wrong best move back.
 *
 * Rights cannot be read off placement, so infer them: a king and its rook still
 * on their home squares almost certainly means the right survives. That is
 * wrong only when a king or rook moved away and came back, which is rare and
 * still strictly better than forbidding castling outright.
 *
 * This also makes preferred_responses reachable on those sites for the first
 * time -- every entry in preferred_responses.json carries KQkq, so a `-` FEN
 * could never match one.
 *
 * En passant is deliberately not attempted: it cannot be derived from placement
 * alone, it needs the previous position.
 */
function restoreCastlingRights(chess: Chess): string {
    const at = (square: string, color: Color, type: PieceSymbol): boolean => {
        const piece = chess.get(square);
        return piece !== null && piece.color === color && piece.type === type;
    };

    let rights = '';
    if (at('e1', 'w', 'k')) {
        if (at('h1', 'w', 'r')) rights += 'K';
        if (at('a1', 'w', 'r')) rights += 'Q';
    }
    if (at('e8', 'b', 'k')) {
        if (at('h8', 'b', 'r')) rights += 'k';
        if (at('a8', 'b', 'r')) rights += 'q';
    }

    const fields = chess.fen().split(' ');
    fields[2] = rights || '-';
    const fen = fields.join(' ');
    return chess.validate_fen(fen).valid ? fen : chess.fen();
}


/**
 * Rebuilds a promotion as a move object.
 *
 * The content script hands promotions over in the shape "Qg8=" (or "Qgxh1=" for
 * a capture), which is not valid SAN, so chess.js has to be given the move as
 * an object. The origin square is inferred: a promoting pawn always comes from
 * the rank directly behind the one it lands on.
 */
function makeMoveWithObject(lastMove: string): MoveSpec {
    const [fromTo = ''] = lastMove.split('=');
    const isCapture = lastMove.includes('x');

    const to = isCapture ? fromTo.substring(3, 5) : fromTo.substring(1, 3);
    const file = isCapture ? (fromTo[1] ?? '') : (to[0] ?? '');
    const rank = parseInt(to[1] ?? '');
    const rankFrom = isCapture ? (to.includes('8') ? 7 : 2) : rank === 8 ? rank - 1 : rank + 1;
    const from = file + rankFrom;

    // TODO(phase-4): the original read `from === 7 ? "w" : "b"` with `from` a
    // string like "g7", so this was always "b". Preserved deliberately --
    // changing it changes which piece a promotion produces.
    const color: Color = isCapture ? 'b' : new Chess().turn();

    const promotion =
        color !== turn || (color === 'b' && turn === 'b')
            ? (lastMove[0] ?? '').toLowerCase()
            : config.promotion_piece.toLowerCase();

    return {
        from,
        to,
        promotion,
        piece: 'p',
        color,
        flags: isCapture ? 'pc' : 'n',
    };
}

// -------------------------------------------------------------------------------------------

function on_stockfish_response(event: StockfishResponse | undefined): void {
    if (event === undefined) {
        return;
    }
    if (event.play_yes === true) {
        request_automove('');
    }
    const message = event.response;
    const bestMove = parseBestMove(message);
    if (bestMove) {
        let best = bestMove.best;
        const threat = bestMove.ponder ?? '';
        const toplay = turn === 'w' ? 'White' : 'Black';
        const next = turn === 'w' ? 'Black' : 'White';
        draw_arrow(best, 'blue', byId('move-arrow'));
        draw_arrow(threat, 'red', byId('response-arrow'));
        if (config.simon_says_mode) {
            const startSquare = best.substring(2, 4);
            if (!board.position()[startSquare]) {
                board.move(best);
            }
            const startPiece = board.position()[startSquare];
            const startPieceType = startPiece ? startPiece.substring(1) : null;
            if (startPieceType) {
                byId('chess_line_1').innerText = pieceNameMap[startPieceType] ?? '';
            }
        }
        if (best === '(none)') {
            byId('chess_line_1').innerText = `${next} Wins`;
        } else if (threat && threat !== '(none)') {
            byId('chess_line_1').innerText = `${toplay} to play, best move is ${best}`;
            byId('chess_line_2').innerText = `Best response for ${next} is ${threat}`;
        } else {
            byId('chess_line_1').innerText = `${toplay} to play, best move is ${best}`;
            byId('chess_line_2').innerText = '';
        }
        if (toplay.toLowerCase() === board.orientation()) {
            lastBestMove = best;
            lastResponseMove = threat;
            if (config.simon_says_mode) {
                const startPiece = board.position()[best.substring(0, 2)];
                if (startPiece) {
                    request_console_log(`${pieceNameMap[startPiece.substring(1)] ?? ''} ==> ${lastScore}`);
                }
            }
            if (config.autoplay) {
                // e.g. f2g1q -- rewrite the engine's promotion to the configured piece
                // TODO(phase-4): 'k' is not a legal promotion and 'n' is missing.
                const promotionPieces = ['q', 'k', 'r', 'b'];
                const lastChar = best.slice(-1);
                if (best.length === 5 && promotionPieces.includes(lastChar)) {
                    best = best.slice(0, -1) + config.promotion_piece.toLowerCase();
                }
                request_automove(best);
            }
        }
        toggle_calculating(false);
    } else if (message.includes('info depth')) {
        const info = parseInfo(message);
        if (info.score?.kind === 'mate') {
            const mateNum = Math.abs(info.score.moves);
            if (mateNum === 0) {
                byId('evaluation').innerText = 'Checkmate!';
                byId('chess_line_2').innerText = '';
            } else {
                byId('evaluation').innerText = `Checkmate in ${mateNum}`;
            }
            toggle_calculating(false);
        } else if (info.score?.kind === 'cp') {
            // Reported relative to the side to move; the popup shows it from
            // the other side, as it always has.
            const score = (info.score.value * -1) / 100.0;
            byId('evaluation').innerText = `Score: ${score} at depth ${info.depth ?? '?'}`;
            lastScore = score;
        }
        lastPv = info.pv ?? [];
    }
    if (isCalculating) {
        prog++;
        const progMapping = 100 * (1 - Math.exp(-prog / 30));
        findById('progBar')?.setAttribute('value', `${Math.round(progMapping)}`);
    }
}

// -------------------------------------------------------------------------------------------

function sendToContent(message: PopupToContent): void {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId !== undefined) {
            void chrome.tabs.sendMessage(tabId, message);
        }
    });
}

function request_fen(): void {
    sendToContent({ kind: 'query-board' });
}

function request_automove(move: string): void {
    // Puzzle mode walks the whole principal variation; otherwise just the move.
    const pv = lastPv.length ? lastPv : [move];
    sendToContent(config.puzzle_mode ? { kind: 'automove-pv', pv } : { kind: 'automove', move });
}

function request_console_log(message: string): void {
    sendToContent({ kind: 'console-log', message });
}

function push_config(): void {
    sendToContent({ kind: 'push-config', config });
}

// -------------------------------------------------------------------------------------------

function getCoords(move: string): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = move.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    const y0 = parseInt(move.substring(1, 2));
    const x1 = move.charCodeAt(2) - 'a'.charCodeAt(0) + 1;
    const y1 = parseInt(move.substring(3, 4));
    return board.orientation() === 'white'
        ? { x0: x0, y0: y0, x1: x1, y1: y1 }
        : { x0: 9 - x0, y0: 9 - y0, x1: 9 - x1, y1: 9 - y1 };
}

function draw_arrow(move: string, color: string, overlay: HTMLElement): void {
    if (!move || move === '(none)') {
        overlay.lastElementChild?.remove();
        return;
    }

    const boardElem = query('#board .board-b72b1');
    if (!boardElem) return;
    const bodyWidth = document.body.clientWidth;
    const boardSide = boardElem.clientWidth;
    const marginLeft = (bodyWidth - boardSide) / 2;

    const coords = getCoords(move);
    let x0 = 0.5 + (coords.x0 - 1);
    let y0 = 8 - (0.5 + (coords.y0 - 1));
    let x1 = 0.5 + (coords.x1 - 1);
    let y1 = 8 - (0.5 + (coords.y1 - 1));

    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    // TODO(phase-4): x0 is mutated before being reused to compute x1, so the
    // arrowhead is slightly off along x. Preserved to keep arrows identical.
    x0 = x0 + 0.1 * ((x1 - x0) / d);
    y0 = y0 + 0.1 * (dy / d);
    x1 = x1 - 0.4 * ((x1 - x0) / d);
    y1 = y1 - 0.4 * (dy / d);

    overlay.innerHTML = `
        <svg width="${boardSide}" height="${boardSide}" viewBox="0, 0, 8, 8" style="margin-left: ${marginLeft}px">
            <defs>
                <marker id="arrow-${color}" markerWidth="13" markerHeight="13" refX="1" refY="7" orient="auto">
                    <path d="M1,5.75 L3,7 L1,8.25" fill="${color}" />
                </marker>
            </defs>
            <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" fill="${color}" stroke-width="0.225"
                marker-end="url(#arrow-${color})"/>
        </svg>
    `;
}

function clear_arrows(): void {
    if (!config.simon_says_mode) {
        byId('move-arrow').lastElementChild?.remove();
        byId('response-arrow').lastElementChild?.remove();
    }
}

function toggle_calculating(on: boolean): void {
    prog = 0;
    isCalculating = on;
}

// -------------------------------------------------------------------------------------------

async function dispatchClickEvent(x: number, y: number): Promise<void> {
    if (config.python_autoplay_backend) {
        await requestPythonBackendClick(x, y);
    } else {
        await requestDebuggerClick(x, y);
    }
}

function requestDebuggerClick(x: number, y: number): Promise<void> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (tabId === undefined) {
                resolve();
                return;
            }
            const debugee: chrome.debugger.Debuggee = { tabId };
            // TODO(phase-4): attaches on every click and never detaches; the
            // "already attached" error is swallowed by ignoring lastError.
            chrome.debugger.attach(debugee, '1.3', () => {
                void (async () => {
                    for (const type of ['mousePressed', 'mouseReleased'] as const) {
                        await dispatchMouseEvent(debugee, 'Input.dispatchMouseEvent', {
                            type,
                            button: 'left',
                            clickCount: 1,
                            x: x,
                            y: y,
                        });
                    }
                    resolve();
                })();
            });
        });
    });
}

function dispatchMouseEvent(
    debugee: chrome.debugger.Debuggee,
    mouseEvent: string,
    mouseEventOpts: Record<string, unknown>,
): Promise<void> {
    return new Promise((resolve) => {
        chrome.debugger.sendCommand(debugee, mouseEvent, mouseEventOpts, () => resolve());
    });
}

async function requestPythonBackendClick(x: number, y: number): Promise<void> {
    await callPythonBackend('http://localhost:8080/performClick', { x: x, y: y });
}

async function callPythonBackend(url: string, data: object): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
}
