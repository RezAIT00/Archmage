// tiny helper: node tools/patch.mjs file <<< JSON [[old,new],...]  (exact-match replacements, fails loudly)
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
const pairs = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const [a, b] of pairs) { if (!s.includes(a)) { console.error('NOT FOUND in ' + file + ':\n' + a); process.exit(1); } s = s.replace(a, b); }
fs.writeFileSync(file, s); console.log('patched', file, pairs.length);
