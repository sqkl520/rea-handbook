// Compact view of a REA --type extraction: type names, field names+types, method names+signatures,
// and the #US string literals the bodies load.
// Usage: node rea-type-view.cjs <extracted.json>
const fs = require('fs');

if (process.argv[2] === undefined) {
  console.error('usage: node rea-type-view.cjs <rea-output.json>');
  process.exit(2);
}
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = d.normalized_result;

console.log('artifact:', n.artifact.path, '| coverage:', n.coverage && n.coverage.state);

const ft = (f) => {
  const t = f.field_type;
  if (typeof t === 'string') return t;
  return String(JSON.stringify(t)).slice(0, 60);
};
console.log();
console.log('=== TYPES ===');
for (const t of (n.types || [])) console.log(' ', t.full_name, '| fields:', t.field_list && t.field_list.count, 'methods:', t.method_list && t.method_list.count);

console.log();
console.log('=== FIELDS (' + (n.fields || []).length + ') ===');
for (const f of (n.fields || [])) console.log('  ' + f.name.padEnd(34), ft(f));

console.log();
console.log('=== METHODS (' + (n.methods || []).length + ') ===');
for (const m of (n.methods || [])) {
  const sig = m.signature || {};
  const ret = sig.return_type ?? '?';
  const ps = (sig.parameter_types || []).join(', ');
  console.log('  ' + m.name.padEnd(40), `(${ps}) -> ${typeof ret === 'string' ? ret : JSON.stringify(ret)}`);
}

console.log();
console.log('=== STRING LITERALS (' + ((n.user_strings || []).length) + ') ===');
for (const s of (n.user_strings || [])) {
  const v = typeof s === 'string' ? s : (s.value ?? JSON.stringify(s));
  console.log('  ' + v.slice(0, 200).replace(/\n/g, '\\n'));
}
