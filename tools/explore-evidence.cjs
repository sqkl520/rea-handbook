// Explore the structure of a REA evidence JSON file without loading it all into memory twice.
const fs = require('fs');
const path = require('path');

const p = process.argv[2];
if (!p) {
  console.error('usage: node explore-evidence.cjs <evidence.json>');
  process.exit(2);
}
if (!fs.existsSync(p)) { console.error('file not found: ' + p); process.exit(2); }
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log('top keys:', Object.keys(d));
const n = d.normalized_result || d;
console.log('normalized keys:', Object.keys(n));
if (n.application) console.log('application keys:', Object.keys(n.application));
if (n.graph) console.log('graph keys:', Object.keys(n.graph));
if (n.modules) console.log('modules keys:', Array.isArray(n.modules) ? `array len ${n.modules.length}` : Object.keys(n.modules));
if (n.limitations) console.log('limitations:', JSON.stringify(n.limitations).slice(0, 500));
