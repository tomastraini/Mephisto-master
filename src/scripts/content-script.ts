import {
    type BoardState,
    type Color,
    type Orientation,
    type PieceType,
    type PlacedPiece,
    type Site,
    sanitizeMoveToken,
    squareFromIndices,
    toBoardIndex,
} from '../shared/board-state';
import type { ExtensionConfig } from '../shared/config';
import { type ContentToPopup, isMessage, type PopupToContent } from '../shared/messages';

let site: Site | undefined; // the site that the content-script was loaded on
let config: ExtensionConfig | undefined; // configuration pulled from the popup
let moving = false; // whether the content-script is performing a move

const siteMap: Record<string, Site> = {
    'lichess.org': 'lichess',
    'www.chess.com': 'chesscom',
    'blitztactics.com': 'blitztactics',
};

const pieceMap: Record<string, PieceType> = {
    pawn: 'p',
    rook: 'r',
    knight: 'n',
    bishop: 'b',
    queen: 'q',
    king: 'k',
};

const colorMap: Record<string, Color> = {
    white: 'w',
    black: 'b',
};

/** Asserts a DOM lookup succeeded. These sites previously threw a TypeError. */
function required<T>(value: T | null | undefined, what: string): T {
    if (value === null || value === undefined) {
        throw new Error(`Expected ${what} on ${site ?? 'unknown site'}`);
    }
    return value;
}

window.onload = () => {
    site = siteMap[window.location.hostname];
    pullConfig();
};

chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isMessage<PopupToContent>(message)) return;
    if (moving) return;
    tryAcceptRematch();

    switch (message.kind) {
        case 'query-board': {
            // Reading the board is the only thing here that touches site
            // markup, so it is the only thing that can fail. It used to run
            // unconditionally before the dispatch below, which meant one bad
            // read also stopped automove from running and stopped push-config
            // from ever landing, leaving `config` undefined.
            let state: BoardState | null = null;
            let orientation: Orientation = 'white';
            try {
                state = readBoardState(config?.simon_says_mode ?? true);
                orientation = getOrientation();
            } catch (error) {
                // eslint-disable-next-line no-console -- a silent board-read failure is what made this hard to diagnose
                console.warn('Mephisto: could not read the board', error);
            }
            sendToPopup({ kind: 'board-state', state, orientation });
            break;
        }
        case 'automove':
            toggleMoving();
            void simulateMove(message.move).finally(toggleMoving);
            break;
        case 'automove-pv':
            toggleMoving();
            void simulatePvMoves(message.pv).finally(toggleMoving);
            break;
        case 'push-config':
            config = message.config;
            break;
        case 'console-log':
            // eslint-disable-next-line no-console -- this is the hand-and-brain hint channel
            console.log(message.message);
            break;
    }
});

function sendToPopup(message: ContentToPopup): void {
    void chrome.runtime.sendMessage(message);
}

/**
 * chess.com only: click through the game-over dialog into another game.
 *
 * TODO(phase-3): this is chess.com-specific but lives in site-agnostic code,
 * the button is matched on the literal text "New 5 min" so it only works for
 * one time control, and there is no setting to turn it off.
 */
function tryAcceptRematch(): void {
    if (!document.querySelector('.game-over-modal-content') || !document.querySelector('.game-review-buttons-review')) {
        return;
    }
    const buttonsContainer = document.querySelector('.game-over-buttons-component');
    buttonsContainer?.querySelectorAll('button').forEach((button) => {
        if (button.querySelector('span')?.innerText === 'New 5 min') {
            button.click();
        }
    });
}

// -------------------------------------------------------------------------------------------

/**
 * Reads whatever the page is showing: a move list where one is available, the
 * piece placement otherwise.
 */
function readBoardState(includeAllMoves: boolean): BoardState | null {
    if (site === 'chesscom') {
        const moves = readChesscomMoveList();
        return moves.length
            ? { source: 'move-list', site, moves }
            : { source: 'piece-placement', site, turn: getTurn(), pieces: readChesscomPieces() };
    }

    if (site === 'lichess') {
        const moves = readLichessMoveList(includeAllMoves);
        return moves.length
            ? { source: 'move-list', site, moves }
            : {
                  source: 'piece-placement',
                  site,
                  turn: getTurn(),
                  pieces: readChessgroundPieces('.main-board piece'),
              };
    }

    if (site === 'blitztactics') {
        return {
            source: 'piece-placement',
            site,
            turn: getTurn(),
            pieces: readChessgroundPieces('.board-area piece'),
        };
    }

    return null;
}

/**
 * TODO(phase-3): unlike lichess, this does not stop at the selected move, so
 * hand-and-brain mode reads the whole list on chess.com even when it should
 * read only up to the move you are looking at. The original wrote `return`
 * inside a forEach, which skips an element rather than breaking the loop, so
 * the truncation has never actually worked. Fixing it is a behaviour change
 * and belongs with the site adapters -- hence no `includeAllMoves` here.
 */
function readChesscomMoveList(): string[] {
    const records = getMoveRecords();
    if (!records.length) return [];

    const moves: string[] = [];
    for (const record of records) {
        const annotation =
            record.querySelector<HTMLElement>('.offset-for-annotation-icon') ??
            record.querySelector<HTMLElement>('.node-highlight-content');

        if (annotation && annotation.innerText.includes('=')) {
            moves.push(sanitizeMoveToken(formatPromotionMove(annotation.innerText)));
        } else {
            // The piece letter lives in a data attribute on the figurine icon;
            // the text node carries only the destination square.
            const figurine = (annotation ?? record).querySelector('.icon-font-chess')?.getAttribute('data-figurine');
            moves.push(sanitizeMoveToken((figurine ?? '') + record.innerText));
        }
    }
    return moves;
}

function readLichessMoveList(includeAllMoves: boolean): string[] {
    const records = getMoveRecords();
    if (!records.length) return [];

    const selectedMove = getSelectedMoveRecord();
    const moves: string[] = [];
    for (const record of records) {
        moves.push(sanitizeMoveToken(record.innerText.replace(/\n.*/, '')));
        if (!includeAllMoves && record === selectedMove) break;
    }
    return moves;
}

/**
 * chess.com writes a promotion as "g8=Q" but the popup's parser expects the
 * piece first with the "=" moved to the end: "Qg8=". A check marker has to stay
 * last, so "g8=Q+" becomes "Qg8+=".
 */
function formatPromotionMove(text: string): string {
    const [movePart = '', promotionPiece = ''] = text.split('=');
    let completeMove = promotionPiece + movePart;
    if (completeMove.includes('+')) {
        const [before = '', after = ''] = completeMove.split('+');
        completeMove = before + after + '+';
    }
    return completeMove + '=';
}

function readChesscomPieces(): PlacedPiece[] {
    const pieces: PlacedPiece[] = [];
    const usesWebComponent = !!document.querySelector('chess-board');

    for (const element of document.querySelectorAll<HTMLElement>('.piece')) {
        let colorType: string | undefined;
        let coords: string | undefined;

        if (usesWebComponent) {
            let [colorTypeClass, coordsClass] = [element.classList[1], element.classList[2]];
            if (!colorTypeClass || !coordsClass) continue;
            // The two classes are not always in the same order.
            if (!coordsClass.includes('square')) {
                [colorTypeClass, coordsClass] = [coordsClass, colorTypeClass];
            }
            colorType = colorTypeClass;
            coords = coordsClass.split('-')[1];
        } else {
            colorType = element.style.backgroundImage.match(/(\w+)\.png/)?.[1];
            coords = element.classList[1]?.split('-')[1]?.replaceAll('0', '');
        }

        const piece = toPlacedPiece(colorType, coords);
        if (piece) pieces.push(piece);
    }
    return pieces;
}

const PIECE_TYPES = new Set<string>(['p', 'n', 'b', 'r', 'q', 'k']);

/** chess.com encodes a piece as "wp" and a square as two 1-based digits, "52" = e2. */
function toPlacedPiece(colorType: string | undefined, coords: string | undefined): PlacedPiece | null {
    if (!colorType || !coords) return null;

    const colorChar = colorType[0];
    const typeChar = colorType[1];
    if ((colorChar !== 'w' && colorChar !== 'b') || !typeChar || !PIECE_TYPES.has(typeChar)) return null;

    const square = squareFromIndices(Number(coords[0]) - 1, Number(coords[1]) - 1);
    return square ? { color: colorChar, type: typeChar as PieceType, square } : null;
}

/**
 * Reads piece positions off a chessground board (lichess and blitztactics).
 * Pieces are absolutely positioned, so the square comes from the CSS transform.
 */
function readChessgroundPieces(selector: string): PlacedPiece[] {
    const pieces: PlacedPiece[] = [];
    const orientation = getOrientation();
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => !!element.classList[1],
    );

    for (const element of elements) {
        const transform = element.style.transform;
        const [rawX, rawY] = transform
            .substring(transform.indexOf('(') + 1, transform.length - 1)
            .replaceAll('px', '')
            .replace(' ', '')
            .split(',')
            .map((value) => Number(value) / element.getBoundingClientRect().width + 1);
        if (rawX === undefined || rawY === undefined) continue;

        const x = toBoardIndex(rawX);
        const y = toBoardIndex(rawY);
        if (x === null || y === null) continue;

        const square =
            orientation === 'black' ? squareFromIndices(8 - x, y - 1) : squareFromIndices(x - 1, 8 - y);
        if (!square) continue;

        // A "ghost" is the piece being dragged; its classes are shifted by one
        // and it only counts while it is visible.
        const isGhost = element.classList[0] === 'ghost';
        if (isGhost && element.style.visibility !== 'visible') continue;

        const color = colorMap[element.classList[isGhost ? 1 : 0] ?? ''];
        const type = pieceMap[element.classList[isGhost ? 2 : 1] ?? ''];
        if (color && type) pieces.push({ color, type, square });
    }
    return pieces;
}

function getOrientation(): Orientation {
    let orientedBlack: boolean | null = true;
    if (site === 'chesscom') {
        const topLeftCoord = document.querySelector('.coordinate-light') || document.querySelector('.coords-light');
        orientedBlack = topLeftCoord && topLeftCoord.innerHTML === '1';
    } else if (site === 'lichess' || site === 'blitztactics') {
        const topLeftCoord = document.querySelector('.files');
        orientedBlack = topLeftCoord && topLeftCoord.classList.contains('black');
    }
    return orientedBlack ? 'black' : 'white';
}

function toggleMoving(): void {
    moving = !moving;
}

function pullConfig(): void {
    sendToPopup({ kind: 'pull-config' });
}

// -------------------------------------------------------------------------------------------

function getSelectedMoveRecord(): HTMLElement | null {
    if (site === 'chesscom') {
        return (
            document.querySelector<HTMLElement>('.node .selected') || // vs player + computer (new)
            document.querySelector<HTMLElement>('.move-node-highlighted .move-text-component') || // vs player + computer (old)
            document.querySelector<HTMLElement>('.move-node.selected .move-text') // analysis
        );
    } else if (site === 'lichess') {
        return document.querySelector<HTMLElement>('u8t.a1t') || document.querySelector<HTMLElement>('move .active');
    }
    return null;
}

function getMoveRecords(): HTMLElement[] {
    const firstNonEmpty = (...selectors: string[]): HTMLElement[] => {
        for (const selector of selectors) {
            const found = Array.from(document.querySelectorAll<HTMLElement>(selector));
            if (found.length) return found;
        }
        return [];
    };

    if (site === 'chesscom') {
        return firstNonEmpty(
            '.node', // vs player + computer (new)
            '.move-text-component', // vs player + computer (old)
            '.move-text', // analysis
        );
    } else if (site === 'lichess') {
        return firstNonEmpty(
            'u8t', // vs player + computer
            'move', // vs training
        );
    }
    return [];
}

/**
 * The two highlighted squares of the last move, or undefined squares when no
 * move has been played yet.
 *
 * Returned as a named pair rather than a tuple on purpose: this used to return
 * `[toSquare, fromSquare]` while two of its three callers destructured it as
 * `[from, to]`, so `getTurn()` looked for a piece on the square the move had
 * just vacated, found nothing, and threw. Naming the fields makes that class of
 * mistake impossible.
 */
function getLastMoveHighlights(): { from: Element | undefined; to: Element | undefined } {
    let fromSquare: Element | undefined;
    let toSquare: Element | undefined;
    if (site === 'chesscom') {
        let highlights = document.querySelectorAll('.highlight');
        if (highlights.length === 0) {
            highlights = document.querySelectorAll('.hover-square');
        }
        if (highlights.length === 0) {
            highlights = document.querySelectorAll('.node-highlight-content');
        }
        [fromSquare, toSquare] = Array.from(highlights);
    } else if (site === 'lichess') {
        // `.last-move` comes back in document order, not move order, so work
        // out which square is the destination by seeing which still has a piece.
        [toSquare, fromSquare] = Array.from(document.querySelectorAll('.last-move'));
        if (toSquare && fromSquare && !findPieceAt('.main-board piece', toSquare)) {
            [toSquare, fromSquare] = [fromSquare, toSquare];
        }
    } else if (site === 'blitztactics') {
        fromSquare = document.querySelector('.move-from') ?? undefined;
        toSquare = document.querySelector('.move-to') ?? undefined;
    }
    return { from: fromSquare, to: toSquare };
}

/** Finds the chessground piece sitting on the same square as `square`. */
function findPieceAt(selector: string, square: Element | undefined): HTMLElement | undefined {
    if (!square) return undefined;
    const transform = (square as HTMLElement).style.transform;
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((piece) => !!piece.classList[1])
        .find((piece) => piece.style.transform === transform);
}

/**
 * Whose move it is, worked out from the colour of the piece that made the last
 * move.
 *
 * Falls back to White whenever there is nothing to reason from. The common case
 * is the start of a game -- no move has been played, so it is White's turn by
 * definition. This used to throw instead, which took the whole content script
 * down with it, and is why the extension appeared dead until White had moved.
 */
function getTurn(): Color {
    const { to } = getLastMoveHighlights();
    if (!to) return 'w';

    if (site === 'chesscom') {
        const hlPiece = document.querySelector<HTMLElement>(`.piece.${to.classList[1]}`);
        if (!hlPiece) return 'w';
        const hlColorType = document.querySelector('chess-board')
            ? Array.from(hlPiece.classList).find((c) => c.match(/[wb][prnbkq]/))
            : hlPiece.style.backgroundImage.match(/(\w+)\.png/)?.[1];
        return hlColorType?.[0] === 'w' ? 'b' : 'w';
    }

    const selector = site === 'lichess' ? '.main-board piece' : '.board-area piece';
    const toPiece = findPieceAt(selector, to);
    if (!toPiece) return 'w';
    return toPiece.classList.contains('white') ? 'b' : 'w';
}

function getBoard(): Element | null {
    if (site === 'chesscom') {
        return document.querySelector('.board');
    } else if (site === 'lichess' || site === 'blitztactics') {
        return document.querySelector('cg-board');
    }
    return null;
}

function getPromotionSelection(promotion: string): Element | undefined {
    let promotions: ArrayLike<Element> | undefined;
    if (site === 'chesscom') {
        const promotionElems = document.querySelectorAll('.promotion-piece');
        if (promotionElems.length) promotions = promotionElems;
    } else if (site === 'lichess') {
        const promotionModal = document.querySelector('#promotion-choice');
        if (promotionModal) promotions = promotionModal.children;
    } else if (site === 'blitztactics') {
        promotions = document.querySelector('.pieces')?.children;
    }

    // Each site lays the promotion picker out in its own order.
    const promoteMap: Record<string, number> =
        site === 'chesscom'
            ? { b: 0, n: 1, q: 2, r: 3 }
            : site === 'lichess'
              ? { q: 0, n: 1, r: 2, b: 3 }
              : { q: 0, r: 1, n: 2, b: 3 };
    const idx = promoteMap[promotion];
    return promotions && idx !== undefined ? promotions[idx] : undefined;
}

// -------------------------------------------------------------------------------------------

function promiseTimeout(time: number): Promise<number> {
    return new Promise((resolve) => {
        setTimeout(() => resolve(time), time);
    });
}

function getOffsetCorrectionXY(): [number, number] {
    if (config?.python_autoplay_backend) {
        return getBrowserOffsetXY();
    }
    return [0, 0];
}

/**
 * The Python clicker moves the real cursor, so its coordinates are relative to
 * the screen rather than the viewport.
 */
function getBrowserOffsetXY(): [number, number] {
    const topBarHeight = window.outerHeight - window.innerHeight;
    const offsetX = window.screenX;
    const offsetY = window.screenY + topBarHeight;
    return [offsetX, offsetY];
}

/** Picks a point inside `bounds`, away from the very edge, so clicks vary. */
function getRandomSampledXY(bounds: DOMRect, range = 0.8): [number, number] {
    const margin = (1 - range) / 2;
    const x = bounds.x + (range * Math.random() + margin) * bounds.width;
    const y = bounds.y + (range * Math.random() + margin) * bounds.height;
    const [correctX, correctY] = getOffsetCorrectionXY();
    return [x + correctX, y + correctY];
}

// -------------------------------------------------------------------------------------------

function simulateClickSquare(bounds: DOMRect, range = 0.8): void {
    const [x, y] = getRandomSampledXY(bounds, range);
    sendToPopup({ kind: 'simulate-click', x, y });
}

function simulateMove(move: string): Promise<void> {
    const boardBounds = required(getBoard(), 'the board element').getBoundingClientRect();
    const orientation = getOrientation();

    function getBoundsFromCoords(coords: string): DOMRect {
        const squareSide = boardBounds.width / 8;
        const file = coords.charCodeAt(0);
        const rank = parseInt(coords.substring(1, 2));
        const [xIdx, yIdx] =
            orientation === 'white' ? [file - 'a'.charCodeAt(0), 8 - rank] : ['h'.charCodeAt(0) - file, rank - 1];
        return new DOMRect(
            boardBounds.x + xIdx * squareSide,
            boardBounds.y + yIdx * squareSide,
            squareSide,
            squareSide,
        );
    }

    function getThinkTime(): number {
        return (config?.think_time ?? 0) + Math.random() * (config?.think_variance ?? 0);
    }

    function getMoveTime(): number {
        return (config?.move_time ?? 0) + Math.random() * (config?.move_variance ?? 0);
    }

    async function performSimulatedMoveSequence(): Promise<void> {
        await promiseTimeout(getThinkTime());
        simulateClickSquare(getBoundsFromCoords(move.substring(0, 2)));
        await promiseTimeout(getMoveTime());
        simulateClickSquare(getBoundsFromCoords(move.substring(2)));
        if (move[4]) {
            await promiseTimeout(getMoveTime());
            simulatePromotionClicks(move[4]); // conditional promotion click
        }
    }

    return performSimulatedMoveSequence();
}

function simulatePvMoves(pv: string[]): Promise<void> {
    const boardBounds = required(getBoard(), 'the board element').getBoundingClientRect();

    function deriveLastMove(): string {
        function deriveCoords(square: Element | undefined): string {
            if (!square) return 'no';
            const squareBounds = square.getBoundingClientRect();
            const xIdx = Math.floor((squareBounds.x + 1 - boardBounds.x) / squareBounds.width);
            const yIdx = Math.floor((squareBounds.y + 1 - boardBounds.y) / squareBounds.height);
            return getOrientation() === 'white'
                ? String.fromCharCode('a'.charCodeAt(0) + xIdx) + (8 - yIdx)
                : String.fromCharCode('h'.charCodeAt(0) - xIdx) + (yIdx + 1);
        }

        const { from, to } = getLastMoveHighlights();
        return deriveCoords(from) + deriveCoords(to);
    }

    /** Waits for the board to change, then reports whether it changed as predicted. */
    async function confirmResponse(move: string, lastMove: string | undefined): Promise<boolean> {
        let runtime = 0;
        while (runtime < 10000) {
            // < 10 seconds
            runtime += await promiseTimeout(config?.fen_refresh ?? 20);
            const observedLastMove = deriveLastMove();
            if (observedLastMove !== lastMove) {
                return observedLastMove === move;
            }
        }
        return false;
    }

    async function performSimulatedPvMoveSequence(): Promise<void> {
        for (let i = 0; i < pv.length; i++) {
            const lastMove = pv[i - 1];
            const move = pv[i];
            if (move === undefined) continue;
            if (i % 2 === 0) {
                // even index -> my move
                await simulateMove(move);
            } else {
                // odd index -> their move
                if (!(await confirmResponse(move, lastMove))) return;
            }
        }
    }

    return performSimulatedPvMoveSequence();
}

function simulatePromotionClicks(promotion: string): void {
    const promotionChoice = getPromotionSelection(promotion);
    if (promotionChoice) {
        simulateClickSquare(promotionChoice.getBoundingClientRect());
    }
}
