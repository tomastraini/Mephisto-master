import type { ExtensionConfig } from '../shared/config';
import type { ContentToPopupMessage, PopupToContentMessage } from '../shared/messages';

type Site = 'lichess' | 'chesscom' | 'blitztactics';
type Orientation = 'white' | 'black';
type Color = 'w' | 'b';

let site: Site | undefined; // the site that the content-script was loaded on
let config: ExtensionConfig | undefined; // configuration pulled from the popup
let moving = false; // whether the content-script is performing a move

const siteMap: Record<string, Site> = {
    'lichess.org': 'lichess',
    'www.chess.com': 'chesscom',
    'blitztactics.com': 'blitztactics',
};

const pieceMap: Record<string, string> = {
    pawn: 'p',
    rook: 'r',
    knight: 'n',
    bishop: 'b',
    queen: 'q',
    king: 'k',
};

const colorMap: Record<string, string> = {
    white: 'w',
    black: 'b',
};

/** Asserts a DOM lookup succeeded. Previously these sites threw a TypeError. */
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

chrome.runtime.onMessage.addListener((response: PopupToContentMessage) => {
    if (moving) return;
    const res = getMoves(config?.simon_says_mode ?? true);
    if (document.querySelector('.game-over-modal-content') && document.querySelector('.game-review-buttons-review')) {
        const buttonsContainer = document.querySelector('.game-over-buttons-component');
        if (buttonsContainer) {
            buttonsContainer.querySelectorAll('button').forEach((button) => {
                const label = button.querySelector('span');
                if (label && label.innerText === 'New 5 min') {
                    button.click();
                }
            });
        }
    }
    if (response.queryfen) {
        const orient = getOrientation();
        sendToPopup({ dom: res, orient: orient, fenresponse: true });
    } else if (response.automove) {
        toggleMoving();
        if (config?.puzzle_mode) {
            void simulatePvMoves((response.pv ?? '').split(' ')).finally(toggleMoving);
        } else {
            void simulateMove(response.move ?? '').finally(toggleMoving);
        }
    } else if (response.pushConfig) {
        config = response.config;
    } else if (response.consoleMessage) {
        // TODO(phase-2): the popup sends hand-and-brain hints here and nothing
        // consumes them, so the feature is silently a no-op.
    }
});

function sendToPopup(message: ContentToPopupMessage): void {
    void chrome.runtime.sendMessage(message);
}

function getMoves(getAllMoves: boolean): string {
    let prefix = '';
    let res = '';
    if (site === 'chesscom') {
        const moves = getMoveRecords();
        if (moves && moves.length) {
            prefix = '***ccfen***';
            const selectedMove = getSelectedMoveRecord();
            moves.forEach((move) => {
                const annotationElement = move.querySelector<HTMLElement>('.offset-for-annotation-icon');
                if (annotationElement) {
                    const text = annotationElement.innerText;
                    if (text.includes('=')) {
                        res += formatPromotionMove(text) + '*****';
                    } else {
                        // Regular case with icon-font-chess element
                        const iconElement = annotationElement.querySelector('.icon-font-chess');
                        if (iconElement) {
                            res += (iconElement.getAttribute('data-figurine') ?? '') + move.innerText + '*****';
                        } else {
                            res += move.innerText + '*****';
                        }
                    }
                } else {
                    const highlightElement = move.querySelector<HTMLElement>('.node-highlight-content');
                    if (highlightElement) {
                        const text = highlightElement.innerText;
                        if (text.includes('=')) {
                            res += formatPromotionMove(text) + '*****';
                        } else {
                            // Regular case with icon-font-chess element
                            const iconElement = highlightElement.querySelector('.icon-font-chess');
                            if (iconElement) {
                                res += (iconElement.getAttribute('data-figurine') ?? '') + move.innerText + '*****';
                            } else {
                                res += move.innerText + '*****';
                            }
                        }
                        return;
                    }
                    res += move.innerText + '*****';
                }
                if (!getAllMoves && move === selectedMove) {
                    // TODO(phase-3): `return` only skips to the next entry -- it
                    // does not stop the forEach. Hand-and-brain mode therefore
                    // does not truncate at the selected move on chess.com, but
                    // does on lichess, which uses a real `break` below.
                    return;
                }
            });
        } else {
            prefix = '***ccpuz***';
            res += getTurn() + '*****';
            for (const piece of document.querySelectorAll<HTMLElement>('.piece')) {
                let color: string | undefined;
                let type: string | undefined;
                let coordsStr: string | undefined;
                if (document.querySelector('chess-board')) {
                    let [colorTypeClass, coordsClass] = [piece.classList[1], piece.classList[2]];
                    if (!colorTypeClass || !coordsClass) continue;
                    if (!coordsClass.includes('square')) {
                        [colorTypeClass, coordsClass] = [coordsClass, colorTypeClass];
                    }
                    [color, type] = colorTypeClass;
                    coordsStr = coordsClass.split('-')[1];
                } else {
                    const background = piece.style.backgroundImage.match(/(\w+)\.png/);
                    if (!background?.[1]) continue;
                    [color, type] = background[1];
                    coordsStr = piece.classList[1]?.split('-')[1]?.replaceAll('0', '');
                }
                if (!color || !type || !coordsStr?.[0] || !coordsStr[1]) continue;
                const coords = String.fromCharCode('a'.charCodeAt(0) + parseInt(coordsStr[0]) - 1) + coordsStr[1];
                res += `${color}-${type}-${coords}*****`;
            }
        }
    } else if (site === 'lichess') {
        const moves = getMoveRecords();
        if (moves && moves.length) {
            prefix = '***lifen***';
            const selectedMove = getSelectedMoveRecord();
            for (const move of moves) {
                res += move.innerText.replace(/\n.*/, '') + '*****';
                if (!getAllMoves && move === selectedMove) {
                    break;
                }
            }
        } else {
            prefix = '***lipuz***';
            res += getTurn() + '*****';
            res += readChessgroundPieces('.main-board piece');
        }
    } else if (site === 'blitztactics') {
        prefix = '***btpuz***';
        res += getTurn() + '*****';
        res += readChessgroundPieces('.board-area piece');
    }
    return res ? prefix + res.replace(/[^\w-+=#*]/g, '') : 'no';
}

/**
 * chess.com writes a promotion as "g8=Q" but the parser in the popup expects
 * the piece first, with the "=" moved to the end: "Qg8=". A check marker has to
 * stay last, so "g8=Q+" becomes "Qg8+=".
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

/**
 * Reads piece positions off a chessground board, used by lichess and
 * blitztactics. Pieces are absolutely positioned, so the square has to be
 * recovered from the CSS transform.
 */
function readChessgroundPieces(selector: string): string {
    let res = '';
    const pieces = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
        (piece) => !!piece.classList[1],
    );
    for (const piece of pieces) {
        const transform = piece.style.transform;
        const [x, y] = transform
            .substring(transform.indexOf('(') + 1, transform.length - 1)
            .replaceAll('px', '')
            .replace(' ', '')
            .split(',')
            .map((num) => Number(num) / piece.getBoundingClientRect().width + 1);
        if (x === undefined || y === undefined) continue;

        const coords =
            getOrientation() === 'black'
                ? String.fromCharCode('h'.charCodeAt(0) - x + 1) + y
                : String.fromCharCode('a'.charCodeAt(0) + x - 1) + (9 - y);

        // A "ghost" is the piece being dragged; its real class list is shifted
        // by one and it only counts while it is visible.
        if (piece.classList[0] !== 'ghost') {
            res += `${colorMap[piece.classList[0] ?? '']}-${pieceMap[piece.classList[1] ?? '']}-${coords}*****`;
        } else if (piece.style.visibility === 'visible') {
            res += `${colorMap[piece.classList[1] ?? '']}-${pieceMap[piece.classList[2] ?? '']}-${coords}*****`;
        }
    }
    return res;
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
    sendToPopup({ pullConfig: true });
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

function getLastMoveHighlights(): [Element | undefined, Element | undefined] {
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
        [toSquare, fromSquare] = Array.from(document.querySelectorAll('.last-move'));
        const toPiece = findPieceAt('.main-board piece', toSquare);
        if (!toPiece) {
            [toSquare, fromSquare] = [fromSquare, toSquare];
        }
    } else if (site === 'blitztactics') {
        [fromSquare, toSquare] = [
            document.querySelector('.move-from') ?? undefined,
            document.querySelector('.move-to') ?? undefined,
        ];
    }
    return [toSquare, fromSquare];
}

/** Finds the chessground piece sitting on the same square as `square`. */
function findPieceAt(selector: string, square: Element | undefined): HTMLElement | undefined {
    if (!square) return undefined;
    const transform = (square as HTMLElement).style.transform;
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((piece) => !!piece.classList[1])
        .find((piece) => piece.style.transform === transform);
}

function getTurn(): Color {
    const [, toSquare] = getLastMoveHighlights();
    if (site === 'chesscom') {
        const square = required(toSquare, 'a highlighted destination square');
        const hlPiece = required(
            document.querySelector<HTMLElement>(`.piece.${square.classList[1]}`),
            'a piece on the destination square',
        );
        const hlColorType = document.querySelector('chess-board')
            ? Array.from(hlPiece.classList).find((c) => c.match(/[wb][prnbkq]/))
            : hlPiece.style.backgroundImage.match(/(\w+)\.png/)?.[1];
        return hlColorType?.[0] === 'w' ? 'b' : 'w';
    } else if (site === 'lichess' || site === 'blitztactics') {
        const selector = site === 'lichess' ? '.main-board piece' : '.board-area piece';
        const toPiece = required(findPieceAt(selector, toSquare), 'a piece on the destination square');
        return toPiece.classList.contains('white') ? 'b' : 'w';
    }
    throw new Error('Cannot determine the side to move: unrecognised site');
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

function dispatchSimulateClick(x: number, y: number): void {
    sendToPopup({ click: true, x: x, y: y });
}

function simulateClickSquare(bounds: DOMRect, range = 0.8): void {
    const [x, y] = getRandomSampledXY(bounds, range);
    dispatchSimulateClick(x, y);
}

function simulateMove(move: string): Promise<void> {
    const boardBounds = required(getBoard(), 'the board element').getBoundingClientRect();
    const orientation = getOrientation();

    function getBoundsFromCoords(coords: string): DOMRect {
        const squareSide = boardBounds.width / 8;
        const file = coords.charCodeAt(0);
        const rank = parseInt(coords.substring(1, 2));
        const [xIdx, yIdx] =
            orientation === 'white'
                ? [file - 'a'.charCodeAt(0), 8 - rank]
                : ['h'.charCodeAt(0) - file, rank - 1];
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

    async function performSimulatedMoveClicks(): Promise<void> {
        simulateClickSquare(getBoundsFromCoords(move.substring(0, 2)));
        await promiseTimeout(getMoveTime());
        simulateClickSquare(getBoundsFromCoords(move.substring(2)));
    }

    async function performSimulatedMoveSequence(): Promise<void> {
        await promiseTimeout(getThinkTime());
        await performSimulatedMoveClicks();
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

        const [fromSquare, toSquare] = getLastMoveHighlights();
        return deriveCoords(fromSquare) + deriveCoords(toSquare);
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
