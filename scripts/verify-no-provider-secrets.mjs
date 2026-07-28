import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.wrangler', 'coverage', 'dist', 'node_modules']);
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
];

const matches = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }

    const text = await readFile(path, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        matches.push(relative(root, path));
        break;
      }
      pattern.lastIndex = 0;
    }
  }
}

await scan(root);

if (matches.length > 0) {
  console.error(`Provider-like secret detected in: ${matches.join(', ')}`);
  process.exit(1);
}

console.log('No provider secret values detected.');
