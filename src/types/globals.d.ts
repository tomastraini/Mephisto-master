// Declarations for the vendored libraries in lib/, which are loaded as plain
// <script> tags by popup.html and options.html rather than imported.
//
// These describe only the members the extension actually uses. A narrow
// declaration that is occasionally incomplete is more useful than a broad
// `any` that never catches anything -- widen as needed.

/** lib/lru.min.js */
declare class LRU<K extends string | number, V> {
    constructor(limit?: number);
    readonly size: number;
    readonly limit: number;
    readonly head: LRUNode<K, V> | null;
    readonly tail: LRUNode<K, V> | null;
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    remove(key: K): LRUNode<K, V> | undefined;
}

interface LRUNode<K, V> {
    key: K;
    value: V;
}

/** lib/chessboard/chessboard.min.js */
interface ChessBoardConfig {
    position?: string;
    pieceTheme?: string;
    appearSpeed?: 'slow' | 'fast' | number;
    moveSpeed?: 'slow' | 'fast' | number;
    showNotation?: boolean;
    draggable?: boolean;
    orientation?: BoardOrientation;
}

type BoardOrientation = 'white' | 'black';

/** Maps a square ("e4") to a piece code ("wP"). */
type ChessBoardPosition = Record<string, string | undefined>;

interface ChessBoardInstance {
    position(): ChessBoardPosition;
    position(fen: string, useAnimation?: boolean): void;
    orientation(): BoardOrientation;
    orientation(side: BoardOrientation): void;
    move(...moves: string[]): ChessBoardPosition;
    clear(useAnimation?: boolean): void;
    destroy(): void;
}

declare function ChessBoard(containerId: string, config?: ChessBoardConfig): ChessBoardInstance;

/** lib/materialize/materialize.min.js */
interface MaterializeComponent {
    destroy(): void;
}

interface MaterializeCollapsible extends MaterializeComponent {
    open(index?: number): void;
    close(index?: number): void;
}

declare const M: {
    Tooltip: {
        init(elements: ArrayLike<Element>, options?: object): MaterializeComponent[];
    };
    Sidenav: {
        init(elements: ArrayLike<Element>, options?: object): MaterializeComponent[];
    };
    ScrollSpy: {
        init(elements: ArrayLike<Element>, options?: object): MaterializeComponent[];
    };
    FormSelect: {
        init(elements: ArrayLike<Element>, options?: object): MaterializeComponent[];
    };
    Collapsible: {
        init(
            elements: ArrayLike<Element>,
            options?: {
                onOpenStart?: (element: Element) => void;
                onCloseStart?: (element: Element) => void;
            },
        ): MaterializeCollapsible[];
    };
};

/** Materialize stores each component instance on the element it initialised. */
interface Element {
    M_Collapsible?: MaterializeCollapsible;
}
