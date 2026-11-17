import type { Statement } from './schema';

// DEMO ONLY (PDF_REC_DEMO=1, never in production): a made-up statement shaped like a Kash royalties invoice, so the review screen,
// checks and Excel download can be tried without an API key. Not real data.
export function demoStatement(kind?: string | null): Statement {
  if (kind === 'ledger') return {
    statement_type: 'touring_ledger', client_name: 'Kashus Culpepper (DEMO DATA)', invoice_number: null, statement_year: 2026, statement_month: 'May',
    stated_total_amount: 100000, stated_total_commission: 4500, stated_total_paid: 3000, stated_balance_due: 1500,
    lines: [
      { date: '2026-03-14', commission_type: 'Touring', source: 'CAA', description: 'Austin, TX', region: 'US', amount: 50000, rate: 0.045, commission: 2250, is_zero_row: false, support: null },
      { date: '2026-03-15', commission_type: 'Touring', source: 'CAA', description: 'Austin, TX (same-day residual)', region: 'US', amount: 0, rate: 0.045, commission: 0, is_zero_row: true, support: null },
      { date: '2026-04-02', commission_type: 'Touring', source: 'CAA', description: 'Toronto, ON', region: 'CAN', amount: 30000, rate: 0.045, commission: 1352.5, is_zero_row: false, support: null },
      { date: '2026-04-20', commission_type: 'Touring', source: 'CAA', description: 'London, UK', region: 'FOREIGN', amount: 20000, rate: 0.045, commission: 900, is_zero_row: false, support: null },
    ],
    payments: [{ check_number: '10442', date: '2026-04-30', amount: 3000, balance_after: 1500 }],
    notes: ['From 6% to 4.5% retro to Mar 1 per Mgmt (demo note)', 'Demo data: not a real statement. London row is at the wrong rate, the Toronto commission does not recompute, and the total does not tie: all deliberate.'],
  };
  return {
    statement_type: 'royalties_invoice', client_name: 'Kashus Culpepper (DEMO DATA)', invoice_number: 'DEMO-0001',
    statement_year: 2026, statement_month: 'September',
    stated_total_amount: 40000.0, stated_total_commission: 1800.0, stated_total_paid: null, stated_balance_due: null,
    lines: [
      { date: '2026-09-15', commission_type: 'Royalties', source: 'SoundExchange', description: 'Q2 2026 digital performance royalties', region: 'US', amount: 25000, rate: 0.045, commission: 1125, is_zero_row: false, support: 'DEMO-0001' },
      { date: '2026-09-15', commission_type: 'Other', source: 'BMI', description: 'Publishing royalties', region: 'US', amount: 15000, rate: 0.045, commission: 675, is_zero_row: false, support: 'DEMO-0001' },
    ],
    payments: [], notes: ['Demo data: not a real statement.'],
  };
}
