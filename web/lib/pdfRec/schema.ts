import { z } from 'zod';

// What the model must return for one commission PDF. Kept to plain types so it works as a structured-output schema.
export const TYPES = ['touring_ledger', 'touring_invoice', 'royalties_invoice', 'other_invoice', 'royalties_ytd', 'bva', 'other'] as const;

export const Line = z.object({
  date: z.string().nullable(),                 // YYYY-MM-DD (deposit / show date)
  commission_type: z.enum(['Touring', 'Royalties', 'Other', 'Brand']),
  source: z.string().nullable(),               // payer: venue, label, SoundExchange, CAA...
  description: z.string().nullable(),          // memo; for touring "City, ST"
  region: z.enum(['US', 'CAN', 'FOREIGN']).nullable(),
  amount: z.number().nullable(),               // commissionable income for the line (BvA: signed, income +, expense -)
  rate: z.number().nullable(),                 // decimal, 0.045 = 4.5%
  commission: z.number().nullable(),           // exactly as printed on the PDF
  is_zero_row: z.boolean(),                    // a $0 row kept because it is a real date
  support: z.string().nullable(),              // invoice # or check #
});

export const Payment = z.object({
  check_number: z.string().nullable(),
  date: z.string().nullable(),
  amount: z.number().nullable(),
  balance_after: z.number().nullable(),
});

export const Statement = z.object({
  statement_type: z.enum(TYPES),
  client_name: z.string(),
  invoice_number: z.string().nullable(),
  statement_year: z.number().nullable(),
  statement_month: z.string().nullable(),
  stated_total_amount: z.number().nullable(),       // the PDF's own total commissionable income, if printed
  stated_total_commission: z.number().nullable(),   // the PDF's own total commission, if printed
  stated_total_paid: z.number().nullable(),
  stated_balance_due: z.number().nullable(),
  lines: z.array(Line),
  payments: z.array(Payment),
  notes: z.array(z.string()),                       // rate changes, TBC items, anything a reviewer should know
});
export type Statement = z.infer<typeof Statement>;
export type Line = z.infer<typeof Line>;
