import type { Statement } from './schema';
import { expectedRate, ruleFor } from './rates';

export type Check = { level: 'ok' | 'warn' | 'fail'; message: string; line?: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Never trust the extraction blindly: recompute and compare against what the PDF itself prints.
export function runChecks(s: Statement): { checks: Check[]; totals: { amount: number; commission: number; paid: number } } {
  const checks: Check[] = [];
  const amount = r2(s.lines.reduce((a, l) => a + (l.amount ?? 0), 0));
  const commission = r2(s.lines.reduce((a, l) => a + (l.commission ?? 0), 0));
  const paid = r2(s.payments.reduce((a, p) => a + (p.amount ?? 0), 0));

  if (!s.lines.length) checks.push({ level: 'fail', message: 'No lines were extracted from this PDF.' });

  const tot = (label: string, got: number, stated: number | null) => {
    if (stated == null) return checks.push({ level: 'warn', message: `The PDF doesn't state a total ${label}, so it can't be tied out. Extracted: ${money(got)}.` });
    if (Math.abs(got - stated) < 0.015) checks.push({ level: 'ok', message: `Total ${label} ties to the PDF: ${money(got)}.` });
    else checks.push({ level: 'fail', message: `Total ${label} does NOT tie: extracted ${money(got)} vs PDF ${money(stated)} (difference ${money(r2(got - stated))}).` });
  };
  tot('commissionable income', amount, s.stated_total_amount);
  tot('commission', commission, s.stated_total_commission);
  if (s.stated_total_paid != null) tot('payments', paid, s.stated_total_paid);

  const rule = ruleFor(s.client_name);
  if (!rule) checks.push({ level: 'warn', message: `No rate rule on file for "${s.client_name}", so rates weren't checked.` });
  s.lines.forEach((l, i) => {
    const n = i + 1;
    if (l.amount != null && l.rate != null && l.commission != null && Math.abs(l.amount * l.rate - l.commission) > 0.015 && !l.is_zero_row)
      checks.push({ level: 'warn', message: `Line ${n}: ${money(l.amount)} x ${(l.rate * 100).toFixed(3)}% = ${money(r2(l.amount * l.rate))}, but the PDF shows ${money(l.commission)}. The PDF's figure is used.`, line: n });
    const exp = rule ? expectedRate(s.client_name, l.date, l.region) : null;
    if (exp != null && l.rate != null && !l.is_zero_row && Math.abs(exp - l.rate) > 0.0001)
      checks.push({ level: 'warn', message: `Line ${n} (${l.date ?? 'no date'}${l.region ? ', ' + l.region : ''}): rate on the PDF is ${(l.rate * 100).toFixed(2)}% but the rate rule says ${(exp * 100).toFixed(2)}%.`, line: n });
    if (l.amount == null && l.commission == null) checks.push({ level: 'warn', message: `Line ${n} has no amount or commission.`, line: n });
  });
  if (!checks.some(c => c.level !== 'ok')) checks.push({ level: 'ok', message: 'Every line recomputes and every rate matches the rate rules.' });
  return { checks, totals: { amount, commission, paid } };
}
