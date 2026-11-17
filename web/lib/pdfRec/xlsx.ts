import ExcelJS from 'exceljs';
import type { Statement } from './schema';
import { runChecks } from './checks';

// Formats follow the commission rec spec: A = standard 11-column rec, B = touring/royalties ledger with payment rows.
const NAVY = 'FF1F4E79', AMT = '#,##0.00;(#,##0.00);"-"', PCT = '0.000%;(0.000%);"-"';
const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...o });
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const mdy = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : iso ?? '');

export const isLedger = (s: Statement) => s.statement_type === 'touring_ledger' || s.statement_type === 'royalties_ytd' || s.payments.length > 0;

export async function buildRec(s: Statement): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Commissions', { properties: { tabColor: { argb: NAVY } }, views: [{ state: 'frozen', ySplit: 1 }] });
  const ledger = isLedger(s);
  const heads = ['Client Name', 'Commission Type', 'Source', 'Statement Year', 'Statement Month', 'Date', 'Memo / Description', 'Amount', 'Rate', 'Commission',
    ...(ledger ? ['Check #', 'Check Date', 'Payment Amount', 'Balance Due'] : ['Support'])];
  const hr = ws.addRow(heads);
  hr.eachCell(c => { c.font = font({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = fill(NAVY); c.alignment = { vertical: 'middle', wrapText: true }; });
  [26, 16, 22, 10, 12, 11, 44, 16, 10, 16, ...(ledger ? [12, 12, 16, 16] : [20])].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const style = (row: ExcelJS.Row, f: Partial<ExcelJS.Font>, bg?: string) => row.eachCell({ includeEmpty: true }, (c, n) => {
    if (n > heads.length) return; c.font = { ...f }; if (bg) c.fill = fill(bg);
  });
  const first = 2;
  for (const l of s.lines) {
    const r = ws.addRow([s.client_name, l.commission_type, l.source ?? '', s.statement_year ?? '', s.statement_month ?? '', mdy(l.date), l.description ?? '', l.amount, l.rate, null,
      ...(ledger ? ['', '', null, null] : [l.support ?? ''])]);
    const n = r.number;
    // Formula when it ties to the printed figure; otherwise hardcode the PDF's number (avoids $0.01 drift).
    const clean = !l.is_zero_row && l.amount != null && l.rate != null && l.commission != null && Math.abs(l.amount * l.rate - l.commission) < 0.005;
    r.getCell(10).value = clean ? { formula: `H${n}*I${n}`, result: l.commission! } : l.commission;
    style(r, l.is_zero_row ? font({ italic: true, color: { argb: 'FF595959' } }) : font({ color: { argb: 'FF0000FF' } }), l.is_zero_row ? 'FFF5F5F5' : undefined);
    r.getCell(10).font = l.is_zero_row ? font({ italic: true, color: { argb: 'FF595959' } }) : font();
  }
  for (const p of s.payments) {
    const r = ws.addRow([s.client_name, '', '', s.statement_year ?? '', s.statement_month ?? '', '', 'PAYMENT RECEIVED', null, null, null, p.check_number ?? '', mdy(p.date), p.amount, p.balance_after]);
    style(r, font({ bold: true, color: { argb: 'FF375623' } }), 'FFE2EFDA');
  }
  const last = ws.rowCount;
  ws.eachRow((row, n) => { if (n > 1) { row.getCell(8).numFmt = AMT; row.getCell(9).numFmt = PCT; row.getCell(10).numFmt = AMT; if (ledger) { row.getCell(13).numFmt = AMT; row.getCell(14).numFmt = AMT; } } });

  const { totals } = runChecks(s);
  const t = ws.addRow(['Total', '', '', '', '', '', '', { formula: `SUM(H${first}:H${s.lines.length + first - 1})`, result: totals.amount }, '',
    { formula: `SUM(J${first}:J${s.lines.length + first - 1})`, result: totals.commission }, ...(ledger ? ['', '', s.stated_total_paid ?? (totals.paid || null), s.stated_balance_due] : [''])]);
  t.eachCell({ includeEmpty: true }, (c, n) => { if (n > heads.length) return; c.font = font({ bold: true }); c.border = { top: { style: 'double', color: { argb: 'FF000000' } } }; });
  t.getCell(8).numFmt = AMT; t.getCell(10).numFmt = AMT; if (ledger) { t.getCell(13).numFmt = AMT; t.getCell(14).numFmt = AMT; }

  if (s.notes.length) {
    ws.addRow([]);
    ws.addRow(['STATEMENT NOTES:']).getCell(1).font = font({ bold: true });
    for (const n of s.notes) ws.addRow([n]).getCell(1).font = font();
  }
  void last;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = (x: string) => x.replace(/[^\w .-]+/g, '').trim();
  return { buffer: buf, filename: `${safe(s.client_name)} - ${safe([s.statement_month, s.statement_year].filter(Boolean).join(' ')) || 'Commissions'} Commissions.xlsx` };
}
