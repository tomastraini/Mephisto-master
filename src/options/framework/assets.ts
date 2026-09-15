// Runtime loading of a page's markup and stylesheet.
//
// The JavaScript half of the old require.js is gone -- page modules are now
// real ES modules, loaded through the import map in pages.ts. Markup and CSS
// still load at navigation time because only one page is in the DOM at a time.

/** Fetches a page's HTML fragment. */
export async function loadPageMarkup(componentPath: string): Promise<string> {
    const response = await fetch(`${componentPath}.html`);
    if (!response.ok) {
        throw new Error(`Could not load ${componentPath}.html: ${response.status}`);
    }
    return response.text();
}

/**
 * Builds a <link> for a page's stylesheet. Stylesheets are kept in the document
 * once loaded and toggled with `disabled`, so switching back to a page does not
 * re-fetch its CSS.
 */
export function createPageStylesheet(componentPath: string): HTMLLinkElement {
    const stylesheet = document.createElement('link');
    stylesheet.id = stylesheetId(componentPath);
    stylesheet.rel = 'stylesheet';
    stylesheet.href = `${componentPath}.css`;
    stylesheet.className = 'page-stylesheet';
    return stylesheet;
}

export function stylesheetId(componentPath: string): string {
    return `${componentPath}-stylesheet`;
}
