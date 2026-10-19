/**
 * Minimal .xlsx reader (Excel, or Google Sheets → File → Download → Microsoft Excel).
 *
 * An .xlsx file is a zip of XML parts. We unzip with the platform's
 * DecompressionStream (browsers and Node 18+) and read cell values, turning
 * date-formatted numbers into YYYY-MM-DD. Formulas come through as their
 * last computed values. Older binary .xls files aren't supported.
 */

export interface Sheet {
  name: string;
  /** rows[r][c] is the cell's display value ('' when empty). */
  rows: string[][];
}

// ---- zip ------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This doesn't look like an Excel (.xlsx) file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .xlsx file');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
  }
  return files;
}

// ---- xml helpers -----------------------------------------------------------

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
};

/** Concatenated text of all <t> elements (handles rich-text runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

// ---- dates -------------------------------------------------------------------

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code: string): boolean {
  // Strip quoted text and [colour]/[$-locale] blocks, then look for day/month/year tokens.
  const f = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dy]/i.test(f) || /m{3,}/i.test(f) || (/m/i.test(f) && /[dy]/i.test(f));
}

/** Excel serial day → YYYY-MM-DD (1900 date system; serial 25569 = 1970-01-01). */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- workbook ------------------------------------------------------------------

export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const files = await unzip(bytes);
  const read = (path: string) => {
    const f = files.get(path);
    return f ? new TextDecoder().decode(f) : '';
  };

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  const stylesXml = read('xl/styles.xml');
  const customFormats = new Map([...stylesXml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') ?? '']));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const styleIsDate = [...cellXfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (customFormats.has(id) && isDateFormat(customFormats.get(id)!));
  });

  const rels = new Map(
    [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), (attr(m[0], 'Target') ?? '').replace(/^\/?xl\//, '')]),
  );

  const sheets: Sheet[] = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet ${sheets.length + 1}`;
    const target = rels.get(attr(m[0], 'r:id'));
    if (!target) continue;
    const xml = read(`xl/${target}`);
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(attr(rm[1], 'r') ?? rows.length + 1) - 1;
      const cells: string[] = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1];
        const inner = cm[2] ?? '';
        const ref = attr(a, 'r');
        const c = ref ? colIndex(ref) : cells.length;
        const type = attr(a, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = texts(inner);
        else if (type === 'str' || type === 'e') value = v ? decodeXml(v) : '';
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) {
          const num = Number(v);
          value = styleIsDate[Number(attr(a, 's') ?? 0)] && Number.isFinite(num) && num > 1000 ? excelSerialToIso(num) : v;
        }
        while (cells.length < c) cells.push('');
        cells[c] = value.trim();
      }
      while (rows.length < r) rows.push([]);
      rows[r] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
