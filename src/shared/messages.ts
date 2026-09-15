// The messages exchanged between the popup and the content script.
//
// TODO(phase-2): these are still the original ad-hoc payloads, where the
// receiver distinguishes a message by truthiness-testing a marker property.
// Phase 2 replaces them with a discriminated union on a `kind` field, which
// gives exhaustiveness checking at every handler. Typing them as-is here is
// only so the two sides agree on the shape today.

import type { ExtensionConfig } from './config';

export interface PopupToContentMessage {
    queryfen?: boolean;
    automove?: boolean;
    /** Set when automove is a single move (UCI, e.g. "e2e4" or "e7e8q"). */
    move?: string;
    /** Set when automove should walk a principal variation, space separated. */
    pv?: string;
    pushConfig?: boolean;
    config?: ExtensionConfig;
    consoleMessage?: string;
}

export interface ContentToPopupMessage {
    /** The encoded board state, or 'no' when nothing was detected. */
    dom?: string;
    orient?: 'white' | 'black';
    fenresponse?: boolean;
    pullConfig?: boolean;
    click?: boolean;
    x?: number;
    y?: number;
}
