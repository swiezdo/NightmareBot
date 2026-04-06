import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, '..');
export const ROTATION_EN_PATH = path.join(ROOT, 'json', 'rotation_tsushima_en.json');
export const ROTATION_RU_PATH = path.join(ROOT, 'json', 'rotation_tsushima_ru.json');
export const TSUSHIMA_OUTPUT_PATH = path.join(ROOT, 'waves', 'tsushima.json');
export const DATA_DIR = path.join(ROOT, 'data');
