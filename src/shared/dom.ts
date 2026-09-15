// Typed element lookup.
//
// `document.getElementById` returns `HTMLElement | null`, so under strict mode
// every call site would otherwise need its own null check and cast. These
// helpers do it once. They throw on a missing element rather than returning
// null: the previous code dereferenced the result immediately, so a missing id
// was already a TypeError -- this just makes the message say which id.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Expected an element with id "${id}"`);
    }
    return element as T;
}

/** For elements that legitimately may not be present yet. */
export function findById<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

export function query<T extends Element = Element>(selector: string, root: ParentNode = document): T | null {
    return root.querySelector<T>(selector);
}

export function queryAll<T extends Element = Element>(selector: string, root: ParentNode = document): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
}
