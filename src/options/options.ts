import { byId, query, queryAll } from '../shared/dom';
import { createPageStylesheet, loadPageMarkup, stylesheetId } from './framework/assets';
import { componentPathFor, DEFAULT_PAGE, isPageId, loadPageModule, type PageId } from './framework/pages';

document.addEventListener('DOMContentLoaded', () => {
    let activeScrollspies: MaterializeComponent[] | undefined;

    M.Collapsible.init(queryAll('.collapsible'), {
        onOpenStart: (elem) => elem.classList.add('open'),
        onCloseStart: (elem) => elem.classList.remove('open'),
    });
    M.Sidenav.init(queryAll('.sidenav'), {});

    const contentElem = query('#content .container');
    const titleElem = byId('title');
    const headElem = byId('header');
    const headTag = query('head');

    if (!contentElem || !headTag) {
        throw new Error('Options page markup is missing #content .container or <head>');
    }

    function updateActiveTab(pageId: PageId): void {
        const link = byId<HTMLAnchorElement>(pageId);
        location.hash = link.hash;

        queryAll('#nav-mobile li').forEach((item) => {
            if (!item.classList.contains('open')) {
                item.classList.remove('active');
            }
        });

        let elem: Element | null = link;
        while (elem && elem.id !== 'nav-mobile') {
            if (elem.tagName === 'LI') {
                elem.classList.add('active');
            } else if (elem.classList.contains('collapsible') && !elem.children[0]?.classList.contains('open')) {
                // Re-opening forces Materialize to re-measure the body height.
                elem.M_Collapsible?.close();
                elem.M_Collapsible?.open();
            }
            elem = elem.parentElement;
        }
    }

    async function injectPage(pageId: PageId): Promise<void> {
        updateActiveTab(pageId);
        const componentPath = componentPathFor(pageId);

        contentElem!.innerHTML = await loadPageMarkup(componentPath);
        activeScrollspies?.forEach((scrollspy) => scrollspy.destroy());
        activeScrollspies = M.ScrollSpy.init(queryAll('.scrollspy'), {});
        headElem.scrollIntoView(true);

        // Stylesheets stay in the document once fetched and are toggled rather
        // than removed, so navigating back to a page does not re-fetch its CSS.
        queryAll<HTMLLinkElement>('.page-stylesheet').forEach((sheet) => (sheet.disabled = true));
        const cached = document.getElementById(stylesheetId(componentPath)) as HTMLLinkElement | null;
        if (cached) {
            cached.disabled = false;
        } else {
            headTag!.appendChild(createPageStylesheet(componentPath));
        }

        // Imported only now: several page modules read their elements at module
        // scope and depend on the markup above already being in the DOM.
        const pageModule = await loadPageModule(pageId);
        pageModule.page?.onInit();
        titleElem.innerText = pageModule.title;
    }

    function pageIdFromHash(hash: string): PageId {
        const id = hash.substring(1);
        return isPageId(id) ? id : DEFAULT_PAGE;
    }

    queryAll<HTMLAnchorElement>('#nav-mobile a.menu-item').forEach((link) => {
        link.addEventListener('click', (event) => {
            const target = event.target as HTMLAnchorElement;
            void injectPage(pageIdFromHash(target.hash));
            if (target.id === 'logo-container') {
                target.parentElement?.classList.remove('active');
                byId('about').parentElement?.classList.add('active');
            }
        });
    });

    void injectPage(pageIdFromHash(location.hash));
});
