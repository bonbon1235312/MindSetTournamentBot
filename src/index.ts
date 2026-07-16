/**
 * Compatibility entrypoint for the Pterodactyl "Discord - TypeScript" egg.
 *
 * The egg hard-codes `npx ts-node ...`, but this NodeNext ESM project uses
 * `.js` import specifiers that point to TypeScript source files. ts-node's
 * default ESM resolver cannot remap those specifiers on Node 24 without an
 * extra loader flag that the panel does not expose.
 *
 * tsx's programmatic importer performs that resolution in-process, so the
 * fixed egg command can remain unchanged and no NODE_OPTIONS variable is
 * required.
 */
import { tsImport } from 'tsx/esm/api';

await tsImport('./main.ts', import.meta.url);
