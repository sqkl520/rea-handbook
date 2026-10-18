// Parse .NET PE/CLI metadata tables directly: TypeDef, MethodDef, Field, AssemblyRef.
// Reads only file bytes; never loads or executes the assembly.
// Usage: node dotnet-metadata.cjs <exe> [outPrefix]
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node dotnet-metadata.cjs <assembly> [outPrefix]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(2); }
const outPrefix = process.argv[3] || null;
const buf = fs.readFileSync(file);

// ---------- PE ----------
const peOff = buf.readUInt32LE(0x3c);
if (buf.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') throw new Error('not PE');
const coff = peOff + 4;
const machine = buf.readUInt16LE(coff);
const numSections = buf.readUInt16LE(coff + 2);
const optSize = buf.readUInt16LE(coff + 16);
const opt = coff + 20;
const magic = buf.readUInt16LE(opt);
const isPE32Plus = magic === 0x20b;
const numRva = buf.readUInt32LE(opt + (isPE32Plus ? 108 : 92));
const dataDirBase = opt + (isPE32Plus ? 112 : 96);

const sections = [];
const secBase = opt + optSize;
for (let i = 0; i < numSections; i++) {
  const s = secBase + i * 40;
  sections.push({
    name: buf.toString('latin1', s, s + 8).replace(/\0+$/, ''),
    vsize: buf.readUInt32LE(s + 8),
    vaddr: buf.readUInt32LE(s + 12),
    rawSize: buf.readUInt32LE(s + 16),
    rawPtr: buf.readUInt32LE(s + 20),
  });
}
const rvaToOff = (rva) => {
  for (const s of sections) {
    if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) return s.rawPtr + (rva - s.vaddr);
  }
  return null;
};

// CLR header = data directory 14
const clrDirOff = dataDirBase + 14 * 8;
const clrRva = buf.readUInt32LE(clrDirOff);
const clrOff = rvaToOff(clrRva);
const metaRva = buf.readUInt32LE(clrOff + 8);
const metaSize = buf.readUInt32LE(clrOff + 12);
const metaOff = rvaToOff(metaRva);
console.log('=== PE ===');
console.log('machine:', machine.toString(16), '| sections:', numSections, '| PE32+:', isPE32Plus);
console.log('CLR header at', clrRva.toString(16), '| metadata', metaSize, 'bytes');

// ---------- metadata root ----------
if (buf.readUInt32LE(metaOff) !== 0x424a5342) throw new Error('no BSJB signature');
const verLen = buf.readUInt32LE(metaOff + 12);
let p = metaOff + 16 + ((verLen + 3) & ~3);
const flags = buf.readUInt16LE(p);
const streamCount = buf.readUInt16LE(p + 2);
p += 4;

const streams = {};
for (let i = 0; i < streamCount; i++) {
  const off = buf.readUInt32LE(p);
  const size = buf.readUInt32LE(p + 4);
  let q = p + 8;
  let name = '';
  while (buf[q] !== 0) name += String.fromCharCode(buf[q++]);
  p = q + 1;
  p = (p + 3) & ~3;
  streams[name] = { off: metaOff + off, size };
}
console.log('streams:', Object.keys(streams).join(', '));

const strHeap = streams['#Strings'];
const blobHeap = streams['#Blob'];
const readStr = (idx) => {
  let q = strHeap.off + idx;
  let s = '';
  while (buf[q] !== 0) s += String.fromCharCode(buf[q++]);
  return s;
};

// ---------- #~ table header ----------
const tilde = streams['#~'] || streams['#-'];
const heapSizes = buf.readUInt8(tilde.off + 6);
const valid = buf.readBigUInt64LE(tilde.off + 8);
const sortedMask = buf.readBigUInt64LE(tilde.off + 16);
let tp = tilde.off + 24;

// Table slots are indexed by the bit position in the `valid` mask, which includes the
// `Ptr` indirection tables (FieldPtr, MethodPtr, ...). They never appear in a `#~` stream,
// but they still occupy a slot, so the names must be listed at their true indexes.
const TABLES = ['Module','TypeRef','TypeDef','FieldPtr','Field','MethodPtr','MethodDef','ParamPtr','Param','InterfaceImpl','MemberRef','Constant','CustomAttribute','FieldMarshal','DeclSecurity','ClassLayout','FieldLayout','StandAloneSig','EventMap','EventPtr','Event','PropertyMap','PropertyPtr','Property','MethodSemantics','MethodImpl','ModuleRef','TypeSpec','ImplMap','FieldRVA','ENCLog','ENCMap','Assembly','AssemblyProcessor','AssemblyOS','AssemblyRef','AssemblyRefProcessor','AssemblyRefOS','File','ExportedType','ManifestResource','NestedClass','GenericParam','MethodSpec','GenericParamConstraint'];
const rows = {};
for (let i = 0; i < 64; i++) {
  if ((valid >> BigInt(i)) & 1n) {
    rows[TABLES[i]] = buf.readUInt32LE(tp);
    tp += 4;
  }
}
console.log('rows:', JSON.stringify(rows));

const strIdx = (heapSizes & 1) ? 4 : 2;
const guidIdx = (heapSizes & 2) ? 4 : 2;
const blobIdx = (heapSizes & 4) ? 4 : 2;
const tblIdx = (t) => (rows[t] >= 65536 ? 4 : 2);
const codedIdx = (tables) => {
  let max = 0;
  for (const t of tables) max = Math.max(max, rows[t] || 0);
  const bits = Math.ceil(Math.log2(tables.length));
  return max < (1 << (16 - bits)) ? 2 : 4;
};
const TypeDefOrRef = codedIdx(['TypeDef','TypeRef','TypeSpec']);
const ResolutionScope = codedIdx(['Module','ModuleRef','AssemblyRef','TypeRef']);
const MemberRefParent = codedIdx(['TypeDef','TypeRef','ModuleRef','MethodDef','TypeSpec']);

// skip preceding tables in fixed order to reach a target table
const ORDER = TABLES.filter((t) => rows[t] !== undefined);
const rowSize = {
  Module: 2 + strIdx + guidIdx * 3,
  TypeRef: ResolutionScope + strIdx * 2,
  TypeDef: 4 + strIdx * 2 + TypeDefOrRef + tblIdx('Field') + tblIdx('MethodDef'),
  Field: 2 + strIdx + blobIdx,
  MethodDef: 4 + 2 + 2 + strIdx + blobIdx + tblIdx('Param'),
  Param: 2 + 2 + strIdx,
  InterfaceImpl: tblIdx('TypeDef') + TypeDefOrRef,
  MemberRef: MemberRefParent + strIdx + blobIdx,
  Constant: 2 + codedIdx(['Field','Param','Property']) + blobIdx,
  CustomAttribute: codedIdx(['MethodDef','MemberRef']) + codedIdx(['TypeDef','TypeRef','Module','MethodDef','Param','Field','Property','Event','Assembly']) + blobIdx,
  FieldMarshal: codedIdx(['Field','Param']) + blobIdx,
  DeclSecurity: 2 + codedIdx(['TypeDef','MethodDef','Assembly']) + blobIdx,
  ClassLayout: 2 + 4 + tblIdx('TypeDef'),
  FieldLayout: 4 + tblIdx('Field'),
  StandAloneSig: blobIdx,
  EventMap: tblIdx('TypeDef') + tblIdx('Event'),
  Event: 2 + strIdx + TypeDefOrRef,
  PropertyMap: tblIdx('TypeDef') + tblIdx('Property'),
  Property: 2 + strIdx + blobIdx,
  MethodSemantics: 2 + tblIdx('MethodDef') + codedIdx(['Event','Property']),
  MethodImpl: tblIdx('TypeDef') + codedIdx(['MethodDef','MemberRef']) + codedIdx(['MethodDef','MemberRef']),
  ModuleRef: strIdx,
  TypeSpec: blobIdx,
  ImplMap: 2 + codedIdx(['Field','MethodDef']) + strIdx + tblIdx('ModuleRef'),
  FieldRVA: 4 + tblIdx('Field'),
  Assembly: 4 + 2 + 2 + 2 + 2 + 4 + blobIdx + strIdx + strIdx,
  AssemblyRef: 2 + 2 + 2 + 2 + 4 + blobIdx + strIdx + strIdx + blobIdx,
  File: 4 + strIdx + blobIdx,
  ExportedType: 4 + 4 + strIdx + strIdx + codedIdx(['File','ExportedType','Assembly']),
  ManifestResource: 4 + 4 + strIdx + codedIdx(['File','AssemblyRef','ExportedType']),
  NestedClass: tblIdx('TypeDef') * 2,
  GenericParam: 2 + 2 + codedIdx(['TypeDef','MethodDef']) + strIdx,
  MethodSpec: codedIdx(['MethodDef','MemberRef']) + blobIdx,
  GenericParamConstraint: tblIdx('GenericParam') + TypeDefOrRef,
};

// walk to each table, recording its absolute offset
const tableOff = {};
let cur = tp;
for (const t of ORDER) {
  tableOff[t] = cur;
  cur += (rows[t] || 0) * (rowSize[t] || 0);
}
const readIdx = (off, size) => (size === 2 ? buf.readUInt16LE(off) : buf.readUInt32LE(off));

// ---------- TypeDef ----------
const types = [];
const tdOff = tableOff.TypeDef, tdSz = rowSize.TypeDef;
for (let i = 0; i < rows.TypeDef; i++) {
  const o = tdOff + i * tdSz;
  let q = o + 4;
  const name = readStr(readIdx(q, strIdx)); q += strIdx;
  const ns = readStr(readIdx(q, strIdx)); q += strIdx;
  q += TypeDefOrRef;
  const fieldList = readIdx(q, tblIdx('Field')); q += tblIdx('Field');
  const methodList = readIdx(q, tblIdx('MethodDef'));
  types.push({ row: i + 1, ns, name, fieldList, methodList });
}
// row ranges: a type owns [list, nextList)
const fieldRange = (i) => {
  const start = types[i].fieldList;
  const end = i + 1 < types.length ? types[i + 1].fieldList : rows.Field + 1;
  return [start, end];
};
const methodRange = (i) => {
  const start = types[i].methodList;
  const end = i + 1 < types.length ? types[i + 1].methodList : rows.MethodDef + 1;
  return [start, end];
};

// ---------- Field names ----------
const fieldNames = [];
{
  const o0 = tableOff.Field, sz = rowSize.Field;
  for (let i = 0; i < rows.Field; i++) {
    fieldNames.push(readStr(readIdx(o0 + i * sz + 2, strIdx)));
  }
}
// ---------- MethodDef names ----------
const methodNames = [];
{
  const o0 = tableOff.MethodDef, sz = rowSize.MethodDef;
  for (let i = 0; i < rows.MethodDef; i++) {
    methodNames.push(readStr(readIdx(o0 + i * sz + 8, strIdx)));
  }
}
// ---------- AssemblyRef ----------
const asmRefs = [];
if (rows.AssemblyRef) {
  const o0 = tableOff.AssemblyRef, sz = rowSize.AssemblyRef;
  for (let i = 0; i < rows.AssemblyRef; i++) {
    const o = o0 + i * sz;
    let q = o + 2 + 2 + 2 + 2 + 4; // major minor build rev flags
    q += blobIdx; // public key or token
    const name = readStr(readIdx(q, strIdx)); q += strIdx;
    asmRefs.push(name);
  }
}
// ---------- Assembly (own identity) ----------
let selfName = null, selfVersion = null;
if (rows.Assembly) {
  const o = tableOff.Assembly;
  const maj = buf.readUInt16LE(o + 4), min = buf.readUInt16LE(o + 6);
  const bld = buf.readUInt16LE(o + 8), rev = buf.readUInt16LE(o + 10);
  selfVersion = `${maj}.${min}.${bld}.${rev}`;
  let q = o + 4 + 2 + 2 + 2 + 2 + 4 + blobIdx;
  selfName = readStr(readIdx(q, strIdx));
}

console.log();
console.log('=== assembly ===');
console.log('self:', selfName, selfVersion);
console.log('refs:', asmRefs.join(', '));

// ---------- report ----------
const entries = types.map((t, i) => ({
  full: t.ns ? `${t.ns}.${t.name}` : t.name,
  ns: t.ns,
  name: t.name,
  fields: fieldRange(i)[0] < fieldRange(i)[1] ? fieldNames.slice(fieldRange(i)[0] - 1, fieldRange(i)[1] - 1) : [],
  methods: methodRange(i)[0] < methodRange(i)[1] ? methodNames.slice(methodRange(i)[0] - 1, methodRange(i)[1] - 1) : [],
}));

console.log();
console.log('=== types:', entries.length, '(total methods', methodNames.length, ', fields', fieldNames.length, ') ===');
const byNs = {};
for (const e of entries) byNs[e.ns || '(global)'] = (byNs[e.ns || '(global)'] || 0) + 1;
console.log('namespaces:');
for (const [k, v] of Object.entries(byNs).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);

if (outPrefix) {
  fs.writeFileSync(`${outPrefix}-types.json`, JSON.stringify({ selfName, selfVersion, asmRefs, types: entries }, null, 1));
  const lines = entries.map((e) => `${e.full}\t${e.fields.length}f\t${e.methods.length}m`);
  fs.writeFileSync(`${outPrefix}-types.txt`, lines.join('\n'));
  console.log();
  console.log('written:', `${outPrefix}-types.json`, `${outPrefix}-types.txt`);
}
