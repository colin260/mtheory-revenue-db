import type { Viewer } from './session';

// The ONLY relation the app should read revenue from. Hidden columns come back as NULL and rows outside
// a staff member's artists are never returned, so no page or export can leak them by accident.
//   finance -> everything
//   senior  -> everything except rate, commission, actual_commission, support_file
//   staff   -> same columns as senior, only their assigned artists
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

export function scoped(v: Viewer): string {
  const money = v.sees.money;
  const hidden = (name: string, type: string) => (money ? name : `null::${type} as ${name}`);
  const rows = v.artists === null ? '' : v.artists.length ? `where artist = any(array[${v.artists.map(lit).join(',')}]::text[])` : 'where false';
  return `(select line_id, tracker_year, manager, is_current, artist, client_name, commission_type, source,
            statement_year, statement_month, statement_month_num, deposit_date, memo, amount,
            ${hidden('rate', 'numeric')}, ${hidden('commission', 'numeric')}, ${hidden('actual_commission', 'numeric')},
            ${hidden('support_file', 'text')}, show_date, sheet_url,
            (select string_agg(am.manager_name, ', ' order by am.manager_name) from artist_managers am where am.artist_name = v_revenue.artist) as mgr_names
          from v_revenue ${rows}) rv`;
}

// Columns a viewer may export (hidden ones are dropped rather than exported blank).
export const EXPORT_COLS = ['tracker_year', 'manager', 'mgr_names', 'artist', 'client_name', 'commission_type', 'source', 'statement_year', 'statement_month',
  'deposit_date', 'show_date', 'memo', 'amount', 'rate', 'commission', 'actual_commission', 'support_file', 'sheet_url'];
export const exportCols = (v: Viewer) =>
  v.sees.money ? EXPORT_COLS : EXPORT_COLS.filter(c => !['rate', 'commission', 'actual_commission', 'support_file'].includes(c));
