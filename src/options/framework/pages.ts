// The set of options pages, and how to load each one.
//
// The imports are dynamic so that a page module's top-level code still runs
// *after* its markup has been injected -- several pages look up their elements
// at module scope. They are also statically listed, which lets the bundler see
// every page and split it into its own chunk.

import type { SettingsPage } from '../util/SettingsPage';

export interface OptionsPageModule {
    /** Shown in the header when the page is active. */
    readonly title: string;
    /** Present only on pages that have form state to persist. */
    readonly page?: SettingsPage;
}

const PAGE_LOADERS = {
    'getting-started': () => import('../pages/getting-started/getting-started'),
    'settings/general': () => import('../pages/settings/general/general'),
    'settings/appearance': () => import('../pages/settings/appearance/appearance'),
    about: () => import('../pages/about/about'),
    disclaimers: () => import('../pages/disclaimers/disclaimers'),
} as const satisfies Record<string, () => Promise<OptionsPageModule>>;

export type PageId = keyof typeof PAGE_LOADERS;

export const DEFAULT_PAGE: PageId = 'settings/general';

export function isPageId(value: string): value is PageId {
    return value in PAGE_LOADERS;
}

export function loadPageModule(id: PageId): Promise<OptionsPageModule> {
    return PAGE_LOADERS[id]();
}

/** Path prefix shared by a page's markup, stylesheet and module. */
export function componentPathFor(id: PageId): string {
    const name = id.substring(id.lastIndexOf('/') + 1);
    return `pages/${id}/${name}`;
}
