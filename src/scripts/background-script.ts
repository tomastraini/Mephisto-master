// MV3 service worker.
//
// This file previously held a handler for a 'loadStockfishModule' message that
// called `loadStockfishModule()` -- a function that is not defined anywhere in
// the repository, and a message that nothing ever sent. Its only code path
// threw a ReferenceError, so there is no behaviour here to preserve and it has
// been removed rather than ported.
//
// The worker itself is kept because manifest.json declares it and because the
// extension will need one: the popup currently talks to the content script
// directly through chrome.tabs, which only works while the popup is open.
//
// TODO(phase-2): decide whether analysis should move here so that it survives
// the popup closing, or whether the service worker entry should be dropped from
// the manifest entirely.

export {};
