// Čtení tabulky v prohlížeči: CSV (UTF-8 i Windows-1250 z českého Excelu) a Excel .xlsx.
// Bez knihoven: .xlsx je ZIP s XML, rozbalí ho DecompressionStream prohlížeče.

export interface Table {
  header: string[];
  rows: string[][];
}

export class ReadError extends Error {}

export async function readTable(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (name.endsWith('.xls') && !isZip) {
    throw new ReadError('Starý formát .xls neumíme přečíst. V Excelu soubor uložte jako .xlsx nebo CSV.');
  }
  if (name.endsWith('.ods')) throw new ReadError('Soubor uložte jako .xlsx nebo CSV.');
  const grid = isZip ? await readXlsx(buf) : parseCsv(decodeText(bytes));
  return toTable(grid);
}

function toTable(grid: string[][]): Table {
  const rows = grid
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length < 2) throw new ReadError('V souboru jsme nenašli hlavičku a aspoň jeden řádek s kartou.');
  const [header, ...data] = rows;
  const width = Math.max(header.length, ...data.map((r) => r.length));
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r);
  return { header: pad(header).map((h, i) => h || `Sloupec ${i + 1}`), rows: data.map(pad) };
}

// Český Excel ukládá CSV ve Windows-1250. Neplatné UTF-8 tedy čteme v něm.
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

/** CSV podle RFC 4180; oddělovač (středník, čárka, tabulátor) se pozná z prvního řádku. */
export function parseCsv(text: string): string[][] {
  const nl = text.search(/\r?\n/);
  const firstLine = (nl < 0 ? text : text.slice(0, nl)).replace(/"[^"]*"/g, '');
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// --- Excel .xlsx ---

async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels'
    || n === 'xl/sharedStrings.xml' || n.startsWith('xl/worksheets/sheet'));
  const text = (n: string) => (files.has(n) ? new TextDecoder().decode(files.get(n)) : null);
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const all = (doc: Document | Element, tag: string) => Array.from(doc.getElementsByTagNameNS('*', tag));

  // První list sešitu podle workbook.xml, jinak sheet1.xml.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = all(xml(wb), 'sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = all(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = text(sheetPath) ?? text([...files.keys()].find((n) => n.startsWith('xl/worksheets/sheet')) ?? '');
  if (!sheet) throw new ReadError('V sešitu jsme nenašli žádný list.');

  const shared = text('xl/sharedStrings.xml');
  const strings = shared
    ? all(xml(shared), 'si').map((si) => all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join(''))
    : [];

  const grid: string[][] = [];
  for (const r of all(xml(sheet), 'row')) {
    const rowIdx = Number(r.getAttribute('r') ?? grid.length + 1) - 1;
    const row: string[] = [];
    for (const c of all(r, 'c')) {
      const ref = c.getAttribute('r') ?? '';
      const col = ref ? colIndex(ref) : row.length;
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent ?? '').join('');
      else if (type === 'b') value = v === '1' ? '1' : '0';
      else value = v;
      while (row.length < col) row.push('');
      row[col] = value;
    }
    while (grid.length < rowIdx) grid.push([]);
    grid[rowIdx] = row;
  }
  return grid;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ReadError('Soubor Excelu je poškozený.');
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
