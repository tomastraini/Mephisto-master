// Builds the extension into dist/.
//
// Output paths mirror the source tree (dist/src/popup/popup.js, ...) so that
// manifest.json and the HTML files keep working with the paths they already
// reference. Load dist/ as the unpacked extension.

import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const watch = process.argv.includes('--watch');

/** Copied verbatim; nothing here goes through the bundler. */
const STATIC_DIRS = ['_locales', 'lib', 'res'];
const STATIC_FILES = ['manifest.json'];
/**
 * Everything under src/ that is not TypeScript ships as-is: page markup,
 * stylesheets, images, the Python clicker. This is an exclusion list rather
 * than an allowlist so that adding an asset of a new kind does not silently
 * drop it from the build.
 */
const isBundledSource = (file) => file.endsWith('.ts');

const shared = {
    bundle: true,
    target: 'chrome110',
    sourcemap: true,
    logLevel: 'info',
    absWorkingDir: ROOT,
};

/**
 * The popup, the service worker and the options page are all ES modules, so
 * they can share code through a split chunk.
 */
const esmBuild = {
    ...shared,
    entryPoints: [
        'src/popup/popup.ts',
        'src/scripts/background-script.ts',
        'src/options/options.ts',
    ],
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    outbase: 'src',
    outdir: 'dist/src',
};

/**
 * Content scripts declared in manifest.json are loaded as classic scripts and
 * cannot use `import`, so this one is bundled into a self-contained IIFE.
 * (That is also why it gets its own build: esbuild cannot code-split IIFE.)
 */
const contentBuild = {
    ...shared,
    entryPoints: ['src/scripts/content-script.ts'],
    format: 'iife',
    outbase: 'src',
    outdir: 'dist/src',
};

async function copyStaticAssets() {
    for (const dir of STATIC_DIRS) {
        await cp(join(ROOT, dir), join(DIST, dir), { recursive: true });
    }
    for (const file of STATIC_FILES) {
        await cp(join(ROOT, file), join(DIST, file));
    }
    for (const file of await walk(join(ROOT, 'src'))) {
        if (isBundledSource(file)) continue;
        const dest = join(DIST, relative(ROOT, file));
        await mkdir(dirname(dest), { recursive: true });
        await cp(file, dest);
    }
}

/**
 * Checks that every path the manifest and the HTML files point at actually
 * exists in dist/. Chrome reports a missing manifest reference as "Could not
 * load manifest" with no detail, and a missing asset in a page not at all, so
 * it is worth catching here.
 */
async function verifyReferences() {
    const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
    const missing = [];

    const manifestRefs = [
        ...Object.values(manifest.icons ?? {}),
        ...Object.values(manifest.action?.default_icon ?? {}),
        manifest.action?.default_popup,
        manifest.action?.options_page,
        manifest.background?.service_worker,
        ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
    ].filter(Boolean);

    for (const ref of new Set(manifestRefs)) {
        if (!existsSync(join(DIST, ref))) missing.push(`manifest.json -> ${ref}`);
    }

    for (const file of await walk(DIST)) {
        if (!file.endsWith('.html')) continue;
        const html = await readFile(file, 'utf8');
        for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
            if (/^(https?:|data:|#)/.test(url)) continue;
            const resolved = url.startsWith('/') ? join(DIST, url) : join(dirname(file), url);
            if (!existsSync(resolved)) {
                missing.push(`${relative(DIST, file)} -> ${url}`);
            }
        }
    }

    if (missing.length) {
        throw new Error(`Broken references in dist/:\n  ${missing.join('\n  ')}`);
    }
}

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const path = join(dir, entry.name);
            return entry.isDirectory() ? walk(path) : [path];
        }),
    );
    return files.flat();
}

async function main() {
    await rm(DIST, { recursive: true, force: true });
    await copyStaticAssets();

    if (watch) {
        const contexts = await Promise.all([
            esbuild.context(esmBuild),
            esbuild.context(contentBuild),
        ]);
        await Promise.all(contexts.map((context) => context.watch()));
        await verifyReferences();
        console.log('watching...');
    } else {
        await Promise.all([esbuild.build(esmBuild), esbuild.build(contentBuild)]);
        await verifyReferences();
    }
}

await main();
