import { UploadForm } from '@/lib/UploadForm';
import { PdfRecForm } from '@/lib/PdfRecForm';
import { ProjectionsForm } from '@/lib/ProjectionsForm';
import { query } from '@/lib/db';
import { requireFinance } from '@/lib/session';
import { demoEnabled, extractionConfigured } from '@/lib/pdfRec/extract';

export const dynamic = 'force-dynamic';

export default async function Upload() {
  await requireFinance();
  const managers = (await query<{ name: string }>('select name from managers order by is_current desc, name')).map(m => m.name);
  const artists = (await query<{ name: string }>('select name from artists order by name')).map(a => a.name);
  const pdf = extractionConfigured(); // the PDF reader only appears once someone adds an Anthropic API key
  return (
    <>
      <h1 style={{ margin: '4px 0 6px' }}>Add data</h1>
      <h2 style={{ marginTop: 18 }}>From an Excel rec</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        Upload the Excel rec exactly as you get it (the 11-column rec, or the ledger version). Columns are matched by name; payment, total and notes rows are skipped.
        Choose the manager tab and tracker year. New lines are added after that tab&apos;s last row, and the preview tells you which tracker row to paste them at.
        Uploading the same file twice won&apos;t duplicate anything. Preview first.
      </p>
      <UploadForm managers={managers} />

      <h2 style={{ marginTop: 32 }}>From a CSV</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        Same upload box, for a CSV in the app&apos;s own format: lines are matched on tracker year + manager + tracker row, so existing lines update and new ones are added. Nothing is deleted.{' '}
        <a href="/revenue_lines_template.csv" download>Download the template</a>. Required columns: <code>tracker_year</code>, <code>manager</code>, <code>source_row</code>.
        Optional: <code>current_manager, client_name, artist, commission_type, source, statement_year, statement_month, statement_month_num, deposit_date, memo, amount, rate,
        commission, actual_commission, fx_rate, commission_usd, support_file, show_date, sheet_url</code>. Dates must be YYYY-MM-DD.
      </p>

      <h2 style={{ marginTop: 32 }}>Projected shows</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        Upload shows not yet paid as Excel or CSV (e.g. a Gigwell export). Each show is added to the artist named on its row; if the file has no Artist column, type the artist below.
        Columns are matched by name: date, venue, city, state, contact/buyer, fee/guarantee, status. Past dates are kept (a show that has been played but not paid is still income to receive). Uploading an updated file updates the fee and status of shows
        already saved (same artist, date and venue) instead of adding them twice. These are projections only: they show on the Touring tab and are never mixed into revenue.
      </p>
      <ProjectionsForm artists={artists} />

      {pdf && (
        <>
          <h2 style={{ marginTop: 32 }}>From a PDF</h2>
          <p className="muted" style={{ maxWidth: 760 }}>Upload a commission PDF. It is read by Claude, checked against the PDF&apos;s totals and your rate rules, and returned as an Excel rec to download.</p>
          <PdfRecForm configured={pdf} demo={demoEnabled()} />
        </>
      )}
    </>
  );
}
