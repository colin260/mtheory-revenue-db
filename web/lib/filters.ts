import { query } from './db';
export type SP = Record<string, string | string[] | undefined>;
export const FILTER_KEYS = ['q', 'artist', 'manager', 'mgr', 'type', 'source', 'year', 'basis', 'from', 'to', 'legacy', 'co', 'aq', 'hasartist', 'sign'] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

// Default basis is CASH: the year the money was deposited. basis=statement uses the statement year the manager reported it under.
// Years before MIN_YEAR are not offered (2022 and earlier was removed; late-reported 2022 statements were deposited in 2023).
export const MIN_YEAR = 2023;
export const yearExpr = (basis?: string, alias = '') =>
  basis === 'statement' ? `${alias}statement_year` : `${alias}tracker_year`;
// SQL fragment for the same rule on other queries ('' = include legacy managers).
export const onlyCurrent = (legacy?: string, alias = '') => (legacy ? '' : ` and ${alias}is_current`);
// Commission-type groups used by the summary cards and their drill-downs (Touring*, Royalties*, All* = the group below).
export const TYPE_GROUP = `case when commission_type in ('Touring', 'Touring - VIP') then 'Touring'
  when commission_type in ('Royalties', 'Residuals') then 'Royalties'
  when commission_type is null or commission_type in ('All', 'Other', 'Brand', 'Deduction') then 'All'
  else commission_type end`;
export const groupType = (k: string) => (['Touring', 'Royalties', 'All'].includes(k) ? `${k}*` : k);
export const basisLabel = (basis?: string) => (basis === 'statement' ? 'Statement year' : 'Cash year');
export const yearOptions = (rel: string, basis?: string) =>
  `select distinct y v from (select ${yearExpr(basis)} y from ${rel}) t where y >= ${MIN_YEAR} order by 1`;

// Database tab sort: ?sort=amount (ascending) or ?sort=-amount (descending); default newest deposit first.
const SORT_COLS = ['deposit_date', 'show_date', 'artist', 'manager', 'commission_type', 'source', 'memo', 'amount', 'rate', 'commission'];
export function orderBy(sort: string | undefined, money: boolean, alias = '') {
  const desc = !!sort?.startsWith('-'), col = (sort ?? '').replace(/^-/, '');
  const ok = SORT_COLS.includes(col) && (money || !['rate', 'commission'].includes(col));
  const [c, d] = ok ? [col, desc ? 'desc' : 'asc'] : ['deposit_date', 'desc'];
  return `${alias}${c} ${d} nulls last, ${alias}line_id desc`;
}

export function filtersFrom(sp: SP) {
  return Object.fromEntries(FILTER_KEYS.map(k => [k, one(sp[k])])) as Record<(typeof FILTER_KEYS)[number], string>;
}

// Builds a parameterised WHERE clause against v_revenue.
export function where(f: ReturnType<typeof filtersFrom>) {
  const c: string[] = [], p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); c.push(sql.replace('?', `$${p.length}`)); };
  // Search: every word must match (AND). "quoted phrases" stay together. A 4-digit year also matches the selected year basis.
  for (const raw of f.q.match(/"[^"]+"|\S+/g) ?? []) {
    const t = raw.replace(/^"|"$/g, '');
    p.push(`%${t}%`);
    const n = p.length, text = `memo ilike $${n} or source ilike $${n} or artist ilike $${n} or client_name ilike $${n} or commission_type ilike $${n} or manager ilike $${n} or mgr_names ilike $${n}`;
    if (/^(19|20)\d{2}$/.test(t)) { p.push(Number(t)); c.push(`(${yearExpr(f.basis)} = $${p.length} or ${text})`); }
    else c.push(`(${text})`);
  }
  if (f.artist) add('artist = ?', f.artist);
  if (f.manager) add('manager = ?', f.manager);
  if (f.mgr) add('exists (select 1 from artist_managers am where am.artist_name = artist and am.manager_name = ?)', f.mgr);
  if (f.type === 'Touring*') c.push("commission_type like 'Touring%'");   // Touring including Touring - VIP
  else if (f.type === 'Royalties*') c.push("commission_type in ('Royalties', 'Residuals')");
  else if (f.type === 'All*' || f.type === 'Other*') c.push("(commission_type is null or commission_type in ('All', 'Other', 'Brand', 'Deduction'))");
  else if (f.type) f.type === '(none)' ? c.push('commission_type is null') : add('commission_type = ?', f.type);
  if (f.aq) add('artist ilike ?', `%${f.aq}%`);            // artist-name search (dashboard drill-downs)
  if (f.hasartist) c.push('artist is not null');          // dashboard totals only count lines that have an artist
  if (f.source) f.source === '(none)' ? c.push('source is null') : add('source = ?', f.source);
  if (f.year === '(none)') c.push(`${yearExpr(f.basis)} is null`);
  else if (/^\d{4}$/.test(f.year)) add(`${yearExpr(f.basis)} = ?`, Number(f.year));
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) add('deposit_date >= ?', f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) add('deposit_date <= ?', f.to);
  if (f.sign === 'neg') c.push('amount < 0'); else if (f.sign === 'pos') c.push('amount >= 0');    // expenses vs. income (used by Touring drill-downs)
  if (!f.legacy) c.push('is_current');                    // default: current managers only; legacy=1 includes former managers
  return { sql: c.length ? 'where ' + c.join(' and ') : '', params: p };
}

// People who manage artists (dropdown for the Manager filter): names for artists that have lines in view.
export const managerNames = (rel: string, legacy?: string) =>
  query<{ v: string }>(`select distinct am.manager_name v from artist_managers am where am.artist_name in (select artist from ${rel} where artist is not null${onlyCurrent(legacy)}) order by 1`).then(r => r.map(x => x.v));
