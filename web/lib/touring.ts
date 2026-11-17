import { scoped } from './scope';
import { yearExpr } from './filters';
import type { Viewer } from './session';

// Touring lines for one artist, each tagged with the show/tour it belongs to (k).
//  * Underoath-style tabs: a "… - Guarantees" line starts a block and the "… - Expense" lines below it
//    (by tracker row order) belong to it. The block key is the guarantee's tracker year + row.
//  * Any other line with a negative amount is an expense (e.g. Wyatt Flores production, 21 Pilots agent commission): it counts under Expenses, not as negative revenue.
//  * 'Touring - VIP' lines are a subsection of Touring: each is its own row, flagged vip (the type itself stays distinct in the database).
//  * Lines with no amount (commission-only adjustments) are collected under 'adj'.
//  * Everything else (e.g. Trace Adkins, Corey Smith): one line = one show. (Grouping by memo merged different shows that share wording,
//    like Corey Smith's "Corey Smith Touring Inc." lines.)
export const BLOCK = `source ~ ' - (Guarantees|Expense)$'`;
export const yearCond = (basis: string | undefined, year: string) => (/^\d{4}$/.test(year) ? ` and ${yearExpr(basis, 'v.')} = ${Number(year)}` : '');
export function touringLines(v: Viewer, yc = '') {
  return `(select v.*, l.source_row,
     case
       when v.commission_type = 'Touring - VIP' then 'v:' || v.line_id
       when v.amount is null then 'adj'
       when v.source ~ ' - (Guarantees|Expense)$' then 'b' || v.tracker_year || '-' ||
         max(l.source_row) filter (where v.source ~ ' - Guarantees$') over (partition by v.manager, v.tracker_year order by l.source_row)
       else 'l:' || v.line_id
     end k
   from (select * from ${scoped(v)}) v join revenue_lines l using (line_id)
   where v.artist = $1 and v.commission_type in ('Touring', 'Touring - VIP')${yc}) t`;
}

export function showsSql(v: Viewer, yc = '') {
  return `select k,
      coalesce(max(memo) filter (where source ~ ' - Guarantees$'),
               max(memo) filter (where k like 'l:%' or k like 'v:%'),
               'Adjustments (no amount)') label,
      bool_or(commission_type = 'Touring - VIP') vip,
      min(deposit_date) first_deposit,
      min(show_date) show_date,
      count(*)::int n,
      (array_agg(sheet_url order by source_row))[1] sheet_url,
      min(source_row)::int sheet_row,
      coalesce(sum(case when source ~ ' - Expense$' or amount < 0 then 0 else amount end), 0)::float8 gross,
      coalesce(sum(case when source ~ ' - Expense$' or amount < 0 then -amount else 0 end), 0)::float8 expenses,
      coalesce(sum(amount), 0)::float8 net,
      sum(commission)::float8 commission,
      max(rate) filter (where source ~ ' - Guarantees$')::float8 rate
    from ${touringLines(v, yc)} group by k`;
}
