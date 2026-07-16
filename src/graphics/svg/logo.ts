import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoBuffer = readFileSync(path.join(__dirname, '../assets/mindset-logo.jpg'));

/** MindSet's shield logo, inlined as a base64 data URI so every graphic
 * template can embed it directly in the SVG — Sharp/librsvg rasterizes
 * <image> data URIs without a network fetch or a separate asset upload. */
export const MINDSET_LOGO_DATA_URI = `data:image/jpeg;base64,${logoBuffer.toString('base64')}`;
