// The messages exchanged between the popup and the content script.
//
// Every message used to be an ad-hoc object literal that the receiver
// identified by truthiness-testing a marker property, which meant a typo in a
// property name was a message that silently did nothing, and two of the eight
// shapes in flight had no sender or no handler at all.
//
// A discriminated union on `kind` makes `switch (message.kind)` exhaustive:
// adding a variant becomes a compile error at every handler that does not
// cover it.

import type { BoardState, Orientation } from './board-state';
import type { ExtensionConfig } from './config';

export type PopupToContent =
    | { kind: 'query-board' }
    /** Play a single move, in UCI ("e2e4", "e7e8q"). */
    | { kind: 'automove'; move: string }
    /** Walk a principal variation, playing our moves and waiting for theirs. */
    | { kind: 'automove-pv'; pv: string[] }
    | { kind: 'push-config'; config: ExtensionConfig }
    | { kind: 'console-log'; message: string };

export type ContentToPopup =
    /** `state` is null when nothing recognisable was on the page. */
    | { kind: 'board-state'; state: BoardState | null; orientation: Orientation }
    | { kind: 'pull-config' }
    | { kind: 'simulate-click'; x: number; y: number };

export type Message = PopupToContent | ContentToPopup;

/**
 * Guards against anything else sharing the runtime message channel -- other
 * extensions, page scripts, or an older build of this one left in another tab.
 */
export function isMessage<T extends Message>(value: unknown): value is T {
    return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string';
}
