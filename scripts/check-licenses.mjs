import { readFile } from 'node:fs/promises';

const approved = new Set([
  '(MIT OR CC0-1.0)',
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'ISC',
  'LGPL-3.0-or-later',
  'MIT',
  'Python-2.0',
  'Unlicense',
]);

// npm omits these two MIT license fields from lockfile v3 metadata. Their
// package archives still include the license text; keep the exception narrow.
const approvedMissing = new Set(['node_modules/busboy', 'node_modules/streamsearch']);
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const failures = [];
let checked = 0;

for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.link) continue;
  checked += 1;
  if (!entry.license) {
    if (!approvedMissing.has(path)) failures.push(`${path}: missing license metadata`);
  } else if (!approved.has(entry.license)) {
    failures.push(`${path}: unapproved license ${entry.license}`);
  }
}

if (failures.length) {
  console.error(`Dependency license check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Dependency license check passed for ${checked} lockfile entries.`);
