// Builds the extension into dist/.
//
// Output paths mirror the source tree (dist/src/popup/popup.js, ...) so that
// manifest.json and the HTML files keep working with the paths they already
// reference. Load dist/ as the unpacked extension.

import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const watch = process.argv.includes('--watch');

/** Copied verbatim; nothing here goes through the bundler. */
const STATIC_DIRS = ['_locales', 'lib', 'res'];
const STATIC_FILES = ['manifest.json'];
/** Non-TS files under src/ that ship as-is (page markup and styles). */
const STATIC_SRC_EXTENSIONS = ['.html', '.css', '.py'];

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
        if (!STATIC_SRC_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
        const dest = join(DIST, relative(ROOT, file));
        await mkdir(dirname(dest), { recursive: true });
        await cp(file, dest);
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
        console.log('watching...');
    } else {
        await Promise.all([esbuild.build(esmBuild), esbuild.build(contentBuild)]);
    }
}

await main();
