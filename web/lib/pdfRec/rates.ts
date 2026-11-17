import type { Statement } from './schema';

// Artist rate rules from the commission rec spec. Finance can change these here; they only FLAG differences,
// the PDF's printed commission is always what goes in the rec.
type Region = 'US' | 'CAN' | 'FOREIGN';
type Rule = { name: string; match: RegExp; rate: (date: string | null, region: Region | null) => number | null; note: string };

const before = (d: string | null, cutoff: string) => (d ? d < cutoff : true);

export const RULES: Rule[] = [
  { name: 'Kashus Culpepper / Kash Nation', match: /kash/i,
    rate: (d, r) => (r === 'FOREIGN' ? 0 : before(d, '2026-03-01') ? 0.06 : 0.045),
    note: '6% Jan-Feb 2026 (retro), 4.5% from Mar 1 2026; international 0%; Canada at the normal rate' },
  { name: 'Here There and Gone / Wyatt Culpepper', match: /here there|wyatt|htg/i,
    rate: (d, r) => (r === 'FOREIGN' ? 0 : before(d, '2025-07-01') ? 0.045 : 0.015),
    note: '4.5% through 6/28/25, 1.5% from 7/1/25; international 0%' },
  { name: 'Underoath', match: /underoath/i, rate: () => 0.05,
    note: '5% (MTheory share: one third of 15% management commission)' },
  { name: 'Sam Ryder', match: /sam ryder/i, rate: () => 0.06,
    note: '6% (MTheory 30% of 20% total); net losses = 0 commission' },
];

export const ruleFor = (client: string) => RULES.find(r => r.match.test(client));
export const expectedRate = (client: string, date: string | null, region: Region | null) => ruleFor(client)?.rate(date, region) ?? null;
export type { Statement };
