import ExcelJS from 'exceljs';
import { query } from './db';

// Reads an Excel commission rec (the 11-column rec or the ledger variant) and turns it into rows for importLines().
// Columns are matched by header NAME, never position. Payment, total, notes and blank rows are skipped.
export type XlsxOptions = { manager: string; trackerYear: number; artist?: string };
export type XlsxResult = { csv: string; startRow: number; parsed: number; newRows: number; skipped: { payments: number; totals: number; notes: number; blank: number; duplicates: number }; warnings: string[]; noArtist: number };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ALIASES: Record<string, string> = {
  'client name': 'client_name', client: 'client_name', artist: 'artist', 'commission type': 'commission_type', type: 'commission_type', source: 'source',
  'statement year': 'statement_year', 'statement month': 'statement_month', date: 'deposit_date', 'deposit date': 'deposit_date',
  'memo / description': 'memo', 'memo/description': 'memo', memo: 'memo', description: 'memo', amount: 'amount', rate: 'rate', commission: 'commission',
  support: 'support_file', 'show date': 'show_date',
};
const OUT = ['tracker_year', 'manager', 'current_manager', 'source_row', 'client_name', 'artist', 'commission_type', 'source', 'statement_year', 'statement_month', 'statement_month_num',
  'deposit_date', 'memo', 'amount', 'rate', 'commission', 'actual_commission', 'fx_rate', 'commission_usd', 'support_file', 'show_date', 'sheet_url'];

type Raw = ExcelJS.CellValue;
const text = (v: Raw): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o && o.result != null) return text(o.result);
    if ('richText' in o) return o.richText.map((r: any) => r.text).join('').trim();
    if ('text' in o) return String(o.text).trim();
    return '';
  }
  return String(v).trim();
};
const num = (v: Raw): number | null => {
  const s = text(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (s === '' || s === '-') return null;
  const n = Number(s.replace(/%$/, ''));
  return Number.isNaN(n) ? NaN : s.endsWith('%') ? n / 100 : n;
};
const isoDate = (v: Raw): string | null => {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  const s = text(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return 'INVALID:' + s;
};
const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

export async function readRecXlsx(buf: Buffer, o: XlsxOptions): Promise<XlsxResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets.find(w => w.rowCount > 1) ?? wb.worksheets[0];
  const res: XlsxResult = { csv: '', startRow: 0, parsed: 0, newRows: 0, skipped: { payments: 0, totals: 0, notes: 0, blank: 0, duplicates: 0 }, warnings: [], noArtist: 0 };
  if (!ws) throw new Error('The workbook has no sheets.');

  // Find the header row and map columns by name.
  let headerRow = 0; const col: Record<string, number> = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const m: Record<string, number> = {};
    row.eachCell((c, i) => { const k = ALIASES[text(c.value).toLowerCase()]; if (k && !(k in m)) m[k] = i; });
    if ('client_name' in m && 'amount' in m) { headerRow = n; Object.assign(col, m); }
  });
  if (!headerRow) throw new Error('Could not find the header row. Expected columns named like "Client Name" and "Amount" (the 11-column rec).');
  const miss = ['commission_type', 'deposit_date', 'amount', 'commission'].filter(k => !(k in col));
  if (miss.length) throw new Error(`Missing column(s): ${miss.join(', ')}. Expected the 11-column rec headers.`);

  // Known artists for these clients, so the dashboard can group them.
  const known = new Map((await query<{ name: string; artist: string }>(`select c.name, a.name artist from clients c join artists a using (artist_id)`)).map(r => [r.name.toLowerCase(), r.artist]));
  const mgr = (await query<{ max: number | null }>(`select max(l.source_row)::int max from revenue_lines l join managers m using (manager_id) where m.name = $1 and l.tracker_year = $2`, [o.manager, o.trackerYear]))[0];
  const existing = await query<any>(`select deposit_date::text d, memo, amount::float8 a, commission::float8 c, source from revenue_lines l join managers m using (manager_id) where m.name = $1 and l.tracker_year = $2`, [o.manager, o.trackerYear]);
  const seen = new Map<string, number>();
  const key = (d: string | null, memo: string, a: number | null, c: number | null, src: string) => [d ?? '', memo, a == null ? '' : a.toFixed(2), c == null ? '' : c.toFixed(2), src].join('|');
  for (const e of existing) { const k = key(e.d, e.memo ?? '', e.a, e.c, e.source ?? ''); seen.set(k, (seen.get(k) ?? 0) + 1); }

  res.startRow = (mgr?.max ?? 1) + 1;
  let next = res.startRow, stop = false;
  const rows: string[][] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow || stop) return;
    const v = (k: string) => (k in col ? row.getCell(col[k]).value : null);
    const first = text(row.getCell(1).value);
    if (/^statement notes/i.test(first)) { stop = true; res.skipped.notes++; return; }       // everything below is notes
    if (/^total/i.test(first)) { res.skipped.totals++; return; }
    if (/payment received/i.test(text(v('memo')))) { res.skipped.payments++; return; }
    if (!row.hasValues || ['client_name', 'amount', 'commission'].every(k => text(v(k)) === '')) { res.skipped.blank++; return; }

    const where = `Row ${n}`;
    const amount = num(v('amount')), rate = num(v('rate'));
    let commission = num(v('commission'));
    const cv = v('commission') as any;
    // Files made by Python/openpyxl hold formulas with no saved result: =H2*I2 means amount x rate.
    if (commission == null && cv && typeof cv === 'object' && cv.formula) {
      if (amount != null && rate != null && /^[A-Z]+\d+\*[A-Z]+\d+$/.test(String(cv.formula).replace(/\s/g, ''))) commission = Math.round(amount * rate * 1e6) / 1e6;
      else throw new Error(`${where}: the Commission cell is a formula (=${cv.formula}) with no saved value. Open the file in Excel, save it, and upload again.`);
    }
    if (Number.isNaN(amount) || Number.isNaN(rate) || Number.isNaN(commission)) throw new Error(`${where}: an Amount, Rate or Commission value isn't a number.`);
    const date = isoDate(v('deposit_date'));
    if (date?.startsWith('INVALID:')) throw new Error(`${where}: date "${date.slice(8)}" isn't MM/DD/YY or YYYY-MM-DD.`);
    const rateOut = rate != null && rate > 1 ? rate / 100 : rate;
    const client = text(v('client_name'));
    const artist = text(v('artist')) || known.get(client.toLowerCase()) || o.artist || '';
    if (!artist) res.noArtist++;
    const month = text(v('statement_month')), yr = num(v('statement_year'));
    const mi = MONTHS.indexOf(month.toLowerCase());
    const memo = text(v('memo')), src = text(v('source'));

    res.parsed++;
    const k = key(date, memo, amount, commission, src);
    if ((seen.get(k) ?? 0) > 0) { seen.set(k, seen.get(k)! - 1); res.skipped.duplicates++; return; }
    rows.push([String(o.trackerYear), o.manager, '', String(next++), client, artist, text(v('commission_type')).replace(/^(other|management service|sponsorship)$/i, 'All'), src, yr == null ? '' : String(yr), month, mi >= 0 ? String(mi + 1) : '',
      date ?? '', memo, amount == null ? '' : String(amount), rateOut == null ? '' : String(rateOut), commission == null ? '' : String(commission), '', '', '', text(v('support_file')), isoDate(v('show_date')) ?? '', '']);
  });
  res.newRows = rows.length;
  res.csv = [OUT.join(','), ...rows.map(r => r.map(q).join(','))].join('\n');
  if (!res.parsed) res.warnings.push('No data lines were found below the header row.');
  if (res.skipped.payments > 0) res.warnings.push(`This file has ${res.skipped.payments} payment rows, so it looks like a year-to-date LEDGER. Ledgers restate lines that are probably already in the tracker (often at a different rate or date), and importing them would add duplicates. Import only the months that are new.`);
  if (res.noArtist) res.warnings.push(`${res.noArtist} lines have no artist (this file has no Artist column and the client isn't known). They'll be in the Database tab but not on an artist's page. Fill in the Artist box to set one for the whole file.`);
  return res;
}
