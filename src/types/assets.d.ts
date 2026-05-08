/**
 * Static asset module declarations.
 *
 * esbuild's `dataurl` loader rewrites `import url from './foo.png'` to a
 * base64 data-URI string at build time. TypeScript needs this ambient
 * module declaration to type the import.
 *
 * Inlining keeps binary assets out of the release zip — the official
 * Obsidian Community Plugins installer and BRAT both download only
 * main.js / manifest.json / styles.css and ignore everything else.
 */

declare module "*.png" {
	const src: string;
	export default src;
}
