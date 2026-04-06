import fs from 'node:fs';
import path from 'node:path';
import { TSUSHIMA_OUTPUT_PATH } from '../paths.js';

/**
 * @param {object} draft Single map entry (as one element of tsushima.json array).
 */
export function writeTsushimaFile(draft) {
  const dir = path.dirname(TSUSHIMA_OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(TSUSHIMA_OUTPUT_PATH)) {
    fs.copyFileSync(TSUSHIMA_OUTPUT_PATH, `${TSUSHIMA_OUTPUT_PATH}.bak`);
  }
  fs.writeFileSync(TSUSHIMA_OUTPUT_PATH, `${JSON.stringify([draft], null, 2)}\n`, 'utf8');
}
