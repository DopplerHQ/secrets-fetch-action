import { readFileSync } from 'fs';

export const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;
