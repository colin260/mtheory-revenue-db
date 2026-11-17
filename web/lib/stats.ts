// Month a payment belongs to: the deposit month, else the statement month. Used for "per month" averages.
export const PERIOD = `coalesce(to_char(deposit_date, 'YYYY-MM'),
  case when statement_year is not null and statement_month_num is not null then statement_year::text || '-' || lpad(statement_month_num::text, 2, '0') end)`;

// Average over a total, safe for zero / missing divisors.
export const avg = (total: number | null | undefined, n: number | null | undefined) => (total == null || !n ? null : total / n);
