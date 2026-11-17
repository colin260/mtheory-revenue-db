import { parse } from 'csv-parse/sync';
import { transaction } from './db';

// Same columns as data/revenue_lines.csv. line_id is assigned by the database.
const REQUIRED = ['tracker_year', 'manager', 'source_row'];
const NUMERIC = ['statement_year', 'statement_month_num', 'amount', 'rate', 'commission', 'actual_commission', 'fx_rate', 'commission_usd'];
const DATES = ['deposit_date', 'show_date'];
const TEXT = ['commission_type', 'source', 'statement_month', 'memo', 'support_file', 'sheet_url'];
const LINE_COLS = ['tracker_year', 'manager_id', 'source_row', 'client_id', 'artist_id', ...TEXT, ...NUMERIC, ...DATES];

export type ImportResult = { ok: boolean; dryRun: boolean; rows: number; inserted: number; updated: number; newManagers: string[]; errors: string[] };

class DryRun extends Error { constructor(public result: ImportResult) { super('dry run'); } }
const blank = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export async function importLines(csvText: string, dryRun: boolean): Promise<ImportResult> {
  const res: ImportResult = { ok: false, dryRun, rows: 0, inserted: 0, updated: 0, newManagers: [], errors: [] };
  let rows: Record<string, string>[];
  try { rows = parse(csvText, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true }); }
  catch (e) { res.errors.push(`Could not read the file as CSV: ${(e as Error).message}`); return res; }
  res.rows = rows.length;
  if (!rows.length) { res.errors.push('The file has no data rows.'); return res; }
  const missing = REQUIRED.filter(c => !(c in rows[0]));
  if (missing.length) { res.errors.push(`Missing required column(s): ${missing.join(', ')}. Use the template for the expected headers.`); return res; }

  // Validate everything first; nothing is written if any row is bad.
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = `Row ${i + 2}`, bad = (m: string) => res.errors.length < 50 && res.errors.push(`${at}: ${m}`);
    if (!/^\d{4}$/.test(r.tracker_year ?? '')) bad('tracker_year must be a 4-digit year');
    if (!blank(r.manager)) bad('manager is required');
    if (!/^\d+$/.test(r.source_row ?? '')) bad('source_row must be a whole number (the row number in the tracker tab)');
    for (const c of NUMERIC) if (blank(r[c]) !== null && Number.isNaN(Number(r[c]))) bad(`${c} "${r[c]}" is not a number`);
    if (blank(r.statement_month_num) !== null && !(Number(r.statement_month_num) >= 1 && Number(r.statement_month_num) <= 12)) bad('statement_month_num must be 1–12');
    for (const c of DATES) if (blank(r[c]) !== null && !validDate(r[c])) bad(`${c} "${r[c]}" must be YYYY-MM-DD`);
    const k = `${r.tracker_year}|${r.manager}|${r.source_row}`;
    if (seen.has(k)) bad(`duplicate of an earlier row (same tracker_year, manager, source_row)`);
    seen.add(k);
  });
  if (res.errors.length) return res;

  try {
    await transaction(async run => {
      const ids = async (table: 'managers' | 'artists' | 'clients', idCol: string, name: string, extra: Record<string, unknown> = {}) => {
        const cols = ['name', ...Object.keys(extra)];
        const vals = [name, ...Object.values(extra)];
        const ins = await run(`insert into ${table}(${cols.join(',')}) values (${vals.map((_, i) => `$${i + 1}`).join(',')}) on conflict (name) do nothing returning ${idCol}`, vals);
        if (ins.rows.length) return { id: ins.rows[0][idCol], created: true };
        return { id: (await run(`select ${idCol} from ${table} where name = $1`, [name])).rows[0][idCol], created: false };
      };
      const mgr = new Map<string, number>(), art = new Map<string, number>(), cli = new Map<string, number>();
      for (const r of rows) {
        const m = r.manager.trim();
        if (!mgr.has(m)) {
          const x = await ids('managers', 'manager_id', m, { is_current: /^(true|yes|1)$/i.test(r.current_manager ?? '') });
          mgr.set(m, x.id); if (x.created) res.newManagers.push(m);
        }
        const a = blank(r.artist);
        if (a && !art.has(a)) art.set(a, (await ids('artists', 'artist_id', a)).id);
        const c = blank(r.client_name);
        if (c && !cli.has(c)) cli.set(c, (await ids('clients', 'client_id', c, { artist_id: a ? art.get(a) : null, manager_id: mgr.get(m) })).id);
      }
      const upd = LINE_COLS.filter(c => !['tracker_year', 'manager_id', 'source_row'].includes(c)).map(c => `${c} = excluded.${c}`).join(', ');
      for (const r of rows) {
        const a = blank(r.artist), c = blank(r.client_name);
        const vals = LINE_COLS.map(col => col === 'manager_id' ? mgr.get(r.manager.trim())
          : col === 'artist_id' ? (a ? art.get(a) : null) : col === 'client_id' ? (c ? cli.get(c) : null) : col === 'source' && blank(r.source) === null && blank(r.commission_type) === 'Retainer' ? 'Retainer' : col === 'commission_type' ? blank(r[col])?.replace(/^(other|management service|sponsorship)$/i, 'All') ?? null : blank(r[col]));
        const out = await run(
          `insert into revenue_lines(line_id, ${LINE_COLS.join(',')})
           values ((select coalesce(max(line_id),0)+1 from revenue_lines), ${LINE_COLS.map((_, i) => `$${i + 1}`).join(',')})
           on conflict (tracker_year, manager_id, source_row) do update set ${upd}, loaded_at = now()
           returning (xmax = 0) as inserted`, vals);
        out.rows[0].inserted ? res.inserted++ : res.updated++;
      }
      res.ok = true;
      if (dryRun) throw new DryRun(res);
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    res.ok = false; res.errors.push(`Database error, nothing was saved: ${(e as Error).message}`);
  }
  return res;
}
