import { Chess, type Color, type MoveSpec, type PieceSymbol } from '../../lib/chess.min.js';
import type { EvaluationColor, EvaluationType, ExtensionConfig, PieceCode } from '../shared/config';
import { byId, findById, query } from '../shared/dom';
import type { ContentToPopupMessage, PopupToContentMessage } from '../shared/messages';

interface StockfishResponse {
    response: string;
    play_yes?: boolean;
}

let board: ChessBoardInstance;
let fenCache: LRU<string, string>;
let config: ExtensionConfig;

let isCalculating = false;
let prog = 0;
let lastFen = '';
let lastPv = '';
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
    return response.json() as Promise<StockfishResponse>;
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

    // load extension configurations from localStorage
    // TODO(phase-2): `|| default` swallows a legitimately stored 0 or false,
    // and these defaults are a second copy of the ones in the options pages
    // (which disagree on compute_time, preferred_responses and autoplay).
    config = {
        // general settings
        compute_time: readSetting('compute_time', 200),
        compute_depth: readSetting('compute_depth', 16),
        depth_or_time: readSetting('depth_or_time', false),
        preferred_responses: readSetting('preferred_responses', false),
        change_evaluation: readSetting('change_evaluation', false),
        evaluation_color: readSetting<EvaluationColor>('evaluation_color', 3),
        evaluation_type: readSetting<EvaluationType>('evaluation_type', 2),
        maximum_book_move: readSetting('maximum_book_move', 8),
        bookmoves: readSetting('bookmoves', false),
        play_elo: readSetting('play_elo', 1200),
        fen_refresh: readSetting('fen_refresh', 20),
        think_time: readSetting('think_time', 20),
        think_variance: readSetting('think_variance', 20),
        move_time: readSetting('move_time', 20),
        move_variance: readSetting('move_variance', 20),
        simon_says_mode: readSetting('simon_says_mode', false),
        autoplay: readSetting('autoplay', false),
        puzzle_mode: readSetting('puzzle_mode', false),
        python_autoplay_backend: readSetting('python_autoplay_backend', false),
        // appearance settings
        pieces: readSetting('pieces', 'wikipedia.svg'),
        board: readSetting('board', 'brown'),
        coordinates: readSetting('coordinates', false),
        promotionPiece: (localStorage.getItem('promotion_piece') as PieceCode | null) ?? 'Q',
    };
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

    chrome.runtime.onMessage.addListener((response: ContentToPopupMessage) => {
        if (response.fenresponse && response.dom !== 'no') {
            if (response.orient && board.orientation() !== response.orient) {
                board.orientation(response.orient);
            }
            const parsed = parse_fen_from_response(response.dom ?? '');
            if (lastFen !== parsed) {
                new_pos(parsed);
            }
        } else if (response.pullConfig) {
            push_config();
        } else if (response.click) {
            void dispatchClickEvent(response.x ?? 0, response.y ?? 0);
        }
    });

    // query fen periodically from content-script
    request_fen();
    setInterval(function () {
        request_fen();
    }, config.fen_refresh);

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

/**
 * Reads one stored setting, falling back to `fallback`.
 *
 * TODO(phase-2): the `||` is deliberate here only because it is what the
 * original did -- it means a stored 0 or false is discarded in favour of the
 * default. Phase 2 replaces this with `??`.
 */
function readSetting<T>(key: string, fallback: T): T {
    const stored = localStorage.getItem(key);
    const parsed = stored !== null ? (JSON.parse(stored) as T) : null;
    return parsed || fallback;
}

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

function parse_fen_from_response(txt: string): string {
    const prefixMap: Record<string, string> = {
        li: 'Game detected on Lichess.org',
        cc: 'Game detected on Chess.com',
        bt: 'Game detected on BlitzTactics.com',
    };
    const metaTag = txt.substring(3, 8);
    const prefix = metaTag.substring(0, 2);
    byId('game-detection').innerText = prefixMap[prefix] ?? '';
    txt = txt.substring(11);
    const chess = new Chess();

    const lastMoveRegex = /([\w-+=#]+[*]+)$/;
    const cacheKey = txt.replace(lastMoveRegex, '');
    fenCache.get(cacheKey); // refreshes the entry's position in the cache
    const fenPosition = createFenFromMoves(cacheKey);

    if (metaTag.includes('puz')) {
        // chess.com & blitztactics.com puzzle pages
        chess.clear(); // clear the board so we can place our pieces
        const [playerTurn, ...pieces] = txt.split('*****').slice(0, -1);
        for (const piece of pieces) {
            const [color, type, square] = piece.split('-');
            if (!color || !type || !square) continue;
            chess.put({ type: type as PieceSymbol, color: color as Color }, square);
        }
        if (playerTurn) chess.setTurn(playerTurn);
        turn = chess.turn();
        return restoreCastlingRights(chess);
    } else {
        const lastMove = txt.match(lastMoveRegex)?.[0].split('*****')[0];
        chess.load(fenPosition);
        if (lastMove) {
            chess.move(lastMove.includes('=') ? makeMoveWithObject(lastMove) : lastMove);
        }

        turn = chess.turn();
        const fen = chess.fen();

        fenCache.set(txt, fenPosition);
        return fen;
    }
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

function createFenFromMoves(moves: string): string {
    const chess = new Chess();
    for (const move of moves.split('*****')) {
        chess.move(move.includes('=') ? makeMoveWithObject(move) : move);
    }
    return chess.fen();
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
            : config.promotionPiece.toLowerCase();

    return {
        from,
        to,
        promotion,
        piece: 'p',
        color,
        flags: isCapture ? 'pc' : 'n',
    };
}

function on_stockfish_response(event: StockfishResponse | undefined): void {
    if (event === undefined) {
        return;
    }
    if (event.play_yes === true) {
        request_automove('');
    }
    const message = event.response;
    if (message.includes('bestmove')) {
        const arr = message.split(' ');
        let best = arr[1] ?? '';
        // TODO(phase-4): parse this properly -- `ponder` is optional in UCI.
        const threat = (arr[3] ?? '').replace(/\n/g, '');
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
                    best = best.slice(0, -1) + config.promotionPiece.toLowerCase();
                }
                request_automove(best);
            }
        }
        toggle_calculating(false);
    } else if (message.includes('info depth')) {
        const pvSplit = message.split(' pv ');
        const info = pvSplit[0] ?? '';
        if (info.includes('score mate')) {
            const mateNum = Math.abs(parseInt(message.split('score mate ')[1]?.split(' ')[0] ?? ''));
            if (mateNum === 0) {
                byId('evaluation').innerText = 'Checkmate!';
                byId('chess_line_2').innerText = '';
            } else {
                byId('evaluation').innerText = `Checkmate in ${mateNum}`;
            }
            toggle_calculating(false);
        } else if (info.includes('score')) {
            const infoArr = info.split(' ');
            const depth = infoArr[2];
            // TODO(phase-4): positional index into a UCI info line -- parse by
            // token name instead, this breaks if a field is added or reordered.
            const score = Number(infoArr[9]) * -1;
            byId('evaluation').innerText = `Score: ${score / 100.0} at depth ${depth}`;
            lastScore = score / 100.0;
        }
        lastPv = pvSplit[1] ?? '';
    }
    if (isCalculating) {
        prog++;
        const progMapping = 100 * (1 - Math.exp(-prog / 30));
        findById('progBar')?.setAttribute('value', `${Math.round(progMapping)}`);
    }
}

// -------------------------------------------------------------------------------------------

function sendToContent(message: PopupToContentMessage): void {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId !== undefined) {
            void chrome.tabs.sendMessage(tabId, message);
        }
    });
}

function request_fen(): void {
    sendToContent({ queryfen: true });
}

function request_automove(move: string): void {
    sendToContent(config.puzzle_mode ? { automove: true, pv: lastPv || move } : { automove: true, move: move });
}

function request_console_log(message: string): void {
    sendToContent({ consoleMessage: message });
}

function push_config(): void {
    sendToContent({ pushConfig: true, config: config });
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
