# Mtheory Revenue Database

Project brief for Claude Code. Owner: Colin (Controller, Mtheory — music management, ~25 people).

## Goal
A real database with a visually friendly front end, so senior staff can search revenue and
commission by **artist** (not just manager), commission type, source, date or memo, and open
the support behind any line.

## Where the data comes from
- Yearly revenue tracker Google Sheets (2022–2026), one tab per manager. **2022 was removed from the database in Oct 2026**
  (archived in `data/archive/2022/`); only 2023–2026 are loaded. These stay the place
  where data is entered. The database is loaded from them and refreshed.
  - 2022 `18CXJc4PIM_6nooSvAuojaYQDEoEptS5o9dJDAuMGNLU`
  - 2023 `192HOqkrCdk1Ga0aa1tFztYozOLw0w-lPp6b7HGJYnYc`
  - 2024 `1hPNLHBLy1Cc0w3PCTDmzXxC0FvGoPStnPmRreD5fBEo`
  - 2025 `1tuPS8a2t5xfKPeH3tvY_QTYJGSXmItDaWWfsFWL07Io`
  - 2026 `1ZhK3EMsZ99OeSMAToWnQbCDhaG0mgHqpp_4hWxUjzww`
- Tab layout (all manager tabs): Client Name | Artist | Commission Type | Source | Statement Year |
  Statement Month | Deposit Date | Memo/Description | Amount | Rate | Commission | Support | (Show Date on
  WhizzBang) | Total. Columns to the right of **Total** are pivot tables; ignore them.
  Variants: Biz Wash adds `FX Rate`; Good Cop Bad Cop adds `Actual Commission` (+ `Difference`);
  Supernormal adds `Commission USD`. Map columns by header name, never by position.
- Non-revenue tabs to skip: Summary, Expectations, Retainers, Sheet25.
- Weekly cross-check source: "MT MS 2025/2026 Income tracking" Google Sheets (manager-level monthly income).
- Support files (PDF/images) live in Google Drive; the `Support` column holds a file name or Drive link.

## Starting data (this folder)
- `revenue_lines.csv` — 5,313 lines, all managers, 2023–2026, cleaned (one row per tracker line,
  subtotal rows removed). `sheet_url` deep-links to the original row.
- `manager_settlements.csv` — Good Cop Bad Cop monthly "Total" rows (fixed $5,000/month actually paid).
- `reconciliation.csv` — export commission vs each tab's Total cell: 66 tie, 5 explained, 6 tabs have no Total cell (77 tabs).
- `load.mjs` — loads the CSVs (`--reset` to reload; stop the dev server first for the local copy; access tables are kept).
- `schema.sql` — proposed Postgres schema (managers, artists, clients, revenue_lines, manager_settlements, v_revenue view).

## Requirements
1. Load the CSVs into Postgres (Supabase is a fine default: managed Postgres + Google sign-in).
2. Front end (e.g. Next.js): global search box; filters for artist, manager, commission type, source,
   year, deposit-date range, current managers only; artist page with totals by type/year and charts;
   line table with links to the tracker row and support file; CSV export of any filtered view.
3. Access: sign in with Google, restricted to the company's Google Workspace domain, plus an allow-list
   (`app_users`). Read-only for everyone; only finance can trigger refreshes or upload data. Roles are below.
4. Refresh job: re-pull the trackers (Google Sheets API, service account with read access), upsert on
   `(tracker_year, manager, source_row)`, then rerun reconciliation and flag anything that doesn't tie.
5. Weekly reconcile against the MT MS income tracking sheet and report differences.
6. Later: an agent that reads support files and checks each line against them, and a Show Date column
   for touring lines beyond WhizzBang.

## Data conventions (decided with Colin — keep them)
- Artist column was added to every tab. Backforty artists are only Shakey Graves, Futurebirds,
  Langhorne Slim, Nick Shoulders (Daniel Nunnelee and Hardwood Redwood left as-is, former acts).
  WhizzBang = Tyler Childers; Grey Slate = Blackberry Smoke; TOP Financials = 21 Pilots.
- Keep `Breland` and `Daniel Breland` distinct; keep `Touring` and `Touring - VIP` distinct.
- All Live Performance lines are Touring.
- Statement month can differ from the period in the memo (statement = when the manager reported it).
- Do Write Music pays quarterly; Orchard pays a month in arrears; Live Nation ~1 month lag.
- Former managers (no longer worked with, as of Oct 2026): Alison Krauss, Jelly Roll, Stern. Keep all their history; they are
  `is_current = false` (`current_manager = False` in `revenue_lines.csv`), so every view excludes them by default. A tab merely
  existing in the 2026 tracker does NOT make a manager current; the refresh job must not reset this. Finance can toggle it on the Users page.
  **Every view (Dashboard, Database, Artist pages, Touring, Royalties, exports, drill links, dropdown lists) shows current managers only by default; the
  "Include legacy managers" checkbox (`legacy=1`, `onlyCurrent()`/`where()` in `web/lib/filters.ts`) adds former managers.** An artist page whose lines are all with former managers
  (e.g. Jelly Roll) falls back to showing them with a notice.
- Works / Home Free lines formerly typed "Production" are all Royalties (decided 15 Oct 2026).
- Residuals stay a genuine commission type where entered (currently only Mickey Guyton); don't merge into Royalties.
- Trace Adkins' 2026 "Residuals:" lines were re-typed Royalties in the tracker (Oct 2026); the tracker is the source of truth.
- The 158 lines in the 2023 tracker with statement year 2021/2022 (all deposited in 2023; $6.5M revenue, $385K commission) stay: they are real 2023 income.
  Only the 2022 tracker was removed. Year views DEFAULT TO CASH YEAR = the tracker sheet a line sits on (`tracker_year`, changed Oct 28 2026 so lines with no deposit date yet still land in their year; 22 lines were deposited in a different year than their sheet), so no 2022 appears; `basis=statement` switches to the statement year, and
  years before 2023 are never offered in year selectors (`MIN_YEAR` in `web/lib/filters.ts`). Every tab (Dashboard, Touring, Royalties, Database) has the Year basis + Year selectors.

## Company vs. Manager (Nov 2026)
- "Manager" in the data and in the Google Sheets is really the management COMPANY (the tab). In the app it is now labelled **Company** (filters, tables, exports); the database column and the `manager=` URL filter keep the old name.
- **Manager** (new, database only, NOT in the Google Sheets or the rec format) = the people who manage an artist, several allowed. Table `artist_managers (artist_name, manager_name)` (in `auth.sql`, kept across `--reset`, created on first use by `web/lib/db.ts`), edited by finance on the Users page ("Who manages each artist"). `scoped()` exposes it as `mgr_names`; filter `mgr=`; searched by the global search; exported as `manager` (company exports as `company`). Active artists only for now. Sam Ryder = Derek Gridley, Lewis Allen (seeded while the table is empty).

- **Show company** checkbox (`co=1`, Dashboard and Database): the Company column and Company filter are hidden by default; ticking it shows them. The Manager (people) column is always shown.

## Projected shows (`projected_shows`, `web/lib/projections.ts`, seed `web/lib/seed/projected_shows.json`)
- Shows not yet paid, from the booking system (Gigwell) or the Add data import, shown on the Touring tab under "Projected shows (not yet paid)" for that artist: month by month with subtotals, status (Confirmed / Not confirmed / Expired), guarantee, and finance-only rate + projected commission.
  Commission = fee x the artist's most common touring rate (Corey Smith 15%). Not revenue: kept apart from the tracker lines and never mixed into actuals. $0 fees (no fee set yet) and expired holds are listed but not counted. Past dates are KEPT (Colin, Nov 9 2026: played but not yet paid is still income to receive; marked "played, awaiting payment"; remove paid ones with a Replace upload), and only the current calendar year is shown for now (Colin, Nov 2 2026; 2027 rows stay in the table).
- **Logan Crosby (Nov 17 2026):** added as an artist with no tracker lines yet; his 9 Sep-Oct 2026 support dates on the Lily Rose tour came from an itinerary export (seed `web/lib/seed/logan_crosby_shows.json`, flag `logan_crosby_2026_11_17`). Artists with no touring lines get their projection rate from `PROJECTION_RATES` in `web/lib/projections.ts` (Logan 15%). Artists with projected shows but no lines appear in the Touring tab's artist list and get a projected-only artist page.
- **Commission edit (Nov 9 2026):** finance can click a projected commission on the Touring tab / artist page and type an amount for that show (`commission_override` column, `/api/projections/commission`, `web/lib/CommissionEdit.tsx`); Rate shows "custom"; blank = back to fee x usual rate. Uploads never overwrite it. Colin keeps these figures out of Claude's memory: don't read or repeat them unless asked.
- **Import (Nov 9 2026):** Add data > "Upcoming shows (projections)" (`web/lib/importProjections.ts`, `/api/projections`, finance only). Excel/CSV (e.g. Gigwell export), columns by header name (date, artist, venue, city, state, contact/buyer, fee/guarantee, status). Each row goes to the artist on it (must match an artist in the database), else the Artist box. Upsert on (artist, show_date, venue); past dates kept; optional "Replace" removes that artist's saved shows (any date) not in the file. Status: confirmed/contracted/booked => Confirmed; cancelled/released/expired => Expired; anything else Not confirmed. Preview first, then Import.
- Table is created on first use (RLS on) and seeded from the JSON only while empty, so to replace the data, change the rows in the table or empty it and redeploy with a new seed. Nov 2 2026: Corey Smith, 29 of Gigwell's 52 matches (the PDF only held the first 30; one duplicate $0 Buckhead Feb 6 row dropped).

## Touring by show (`/touring`, `web/lib/touring.ts`)
- Underoath-style tabs: a `Live Performance - Guarantees` line is a show; the `Live Performance - Expense` lines below it (by tracker
  row order) belong to it. Net = guarantee + (negative) expenses; commission is 5% of net. Keep the Guarantees line first in each block.
- Commission types "Various" and "Commissions" were retyped "All" in the trackers and database (Oct 28 2026: GCBC 2025 rows 49/52/55, GCBC 2026 rows 2/8, One Spark 2023 rows 2/3). Dashboard/artist "by type" cards fold Touring - VIP into Touring and list every type (retainers have commission but no revenue, so they sort last).
- `Touring - VIP` lines (currently one Home Free line) stay a distinct commission type in the database but show on the Touring tab as a "VIP" subsection included in the totals; Touring drill-downs use type `Touring*` (Touring + VIP).
- Touring lines with no amount (commission-only adjustments) are grouped as "Adjustments".
- Other artists (e.g. Trace Adkins, Corey Smith): each Touring line is its own show row (not grouped by memo: Corey Smith's generic "Corey Smith Touring Inc." memos merged distinct shows).
  Put the venue and date in the memo so shows are distinguishable.
- For other artists any Touring line with a NEGATIVE amount is an expense (Wyatt Flores production, 21 Pilots agent commissions, Home Free OVP, etc.): it shows in the Expenses column, not as negative revenue; net = revenue - expenses.
  Drill-downs use `sign=neg|pos` (Database filter) since those artists have no separate Expense source.
- Show date (`show_date`, the tracker's Show Date column) is shown on the Touring tab (first column, default sort), as a column in line tables whenever any line has one, and in CSV exports. Lines without one just show a deposit date.
- Guarantee/expense/net use `amount`, so senior and staff see them; commission is finance-only like everywhere else.

## Royalties tab (`/royalties`, `web/app/royalties/page.tsx`)
- Royalty lines (commission type `Royalties`) by source (payer) for one artist or all artists: revenue, share, commission (finance), lines, first/last deposit.
  Click a source to see its lines. Same scoping/permission rules as everywhere (`scoped()`). Dashboard and artist pages also show "royalties by source" cards.

## Sources and averages (`/sources/[name]`, `web/lib/stats.ts`)
- Every source name links to its history page: totals, avg per payment, avg per month, by year / artist / type, month by month, all lines. `?artist=` scopes it to one artist (artist pages and the Royalties tab link that way); `legacy=1` includes former managers.
- Averages: commission for finance, revenue for senior/staff. A "month" = a deposit month (else statement month) with at least one payment (`PERIOD`). Royalties tab: per source and per artist; artist pages: avg per show and per royalty payment/month; Touring tab: avg guarantee/revenue, net and commission per show (a show = a row with revenue; expense-only and adjustment rows are not shows).

## Add data from an Excel rec (`web/lib/importXlsx.ts`) — the main workflow
- Colin gets Excel recs from Claude in chat (11-column rec, or the ledger variant) and uploads them on Add data. Columns are matched by header name.
  Payment, total, notes and blank rows are skipped; `=H*I` commission formulas with no saved value are evaluated as amount × rate.
- Finance picks the manager tab and tracker year. New lines get `source_row` after that tab's last row and the preview says which tracker row to paste at,
  so the tracker and database stay aligned. Lines already present (same date, memo, amount, commission, source) are skipped, so re-uploading is safe.
- Artist comes from the file's Artist column, else the known client's artist, else the optional Artist box.
- Recs Claude builds for Colin put **Artist as the 2nd column** (Client Name | Artist | Commission Type | Source | Statement Year | Statement Month | Deposit Date | Show Date | Memo/Description | Amount | Rate | Commission | Support, the same order as the Google Sheet tabs; ledgers add Check # | Check Date | Payment Amount | Balance Due before Support). **Show Date** (the performance date, for Touring lines; blank otherwise) sits right after Deposit Date and is part of every rec from now on.
- Year-to-date LEDGERS (with PAYMENT RECEIVED rows, e.g. Kash's May/June YTD statements) restate lines that are already in the tracker, so they must not be imported as-is; the importer warns when it sees payment rows. Import only the new months.

## PDF to Excel rec (OPTIONAL, off by default: it only appears once ANTHROPIC_API_KEY is set; costs a few cents per PDF) (Add data > From a PDF; `web/lib/pdfRec/`)
- Finance uploads a commission PDF (see `commission-rec-spec.md` for the PDF types and the Excel formats). The server sends it to the Claude API
  (`claude-opus-5-5`, structured output, `ANTHROPIC_API_KEY`), then CODE (not the model) checks it: total vs the PDF's printed totals (±$0.015),
  each line's amount × rate vs the printed commission, and each rate vs the artist rate rules in `rates.ts`. The PDF's printed figure always wins; differences are flagged.
- Output is the Excel rec (Format A, 11 columns; ledger variant with payment rows). Nothing is written to the database from the PDF screen:
  the tracker stays the single source of truth and the database picks the lines up when the tracker is loaded.
- Rate rules (Kash, HTG, Underoath, Sam Ryder) live in `web/lib/pdfRec/rates.ts`; change them there. Foreign = 0%, Canada = normal rate.
- Statement contents go to Anthropic's API. PDFs over 4 MB are refused (Vercel request limit). Source PDFs are not stored.
- Not built yet: multi-PDF comparison (Format C), storing PDFs, saving extracted lines to the database. `PDF_REC_DEMO=1` (local only) returns made-up sample data.

## Access rules (decided with Colin Oct 2026 — keep them)
- **finance** (finance team and CEO): everything; can add data (Add data page) and manage users.
- **senior** (senior team): every line, but rate, commission, actual_commission and support are hidden.
- **staff** (everyone else): only lines for the artists they directly work with (`user_artists`, keyed by artist
  name), same hidden fields as senior. Staff with no artists see nothing.
- Enforced in the database queries, not the UI: all revenue reads go through `scoped()` in `web/lib/scope.ts`
  (hidden columns come back NULL, out-of-scope rows are never selected). Never query `v_revenue` directly
  from a page, export or API route. Search suggestions are built from the same scoped rows.
- `auth.sql` holds `app_users` / `user_artists`; it is not dropped by `load.mjs --reset`.
- Open question: staff currently get the same fields as senior. Revisit if they should see less.

## Full refresh from the Google Sheets (`tools/tracker_all.py`)
- Download the 2023-2026 trackers as xlsx with the Drive connector, then `python3 -I tools/tracker_all.py <four downloads> [--hold='2023|Jelly Roll'] [--apply]`. Report-only without `--apply`.
  It compares EVERY revenue tab by (year, tab, row), adds/updates lines, removes lines the sheet no longer has, drops lines with a statement year before 2023 (archived in
  `data/archive/refresh/removed_lines.csv`), and rewrites `data/reconciliation.csv`. Then `node load.mjs --reset` (stop the dev server first; against Supabase use DATABASE_URL).
- Header rule: only columns up to **Total** are read, first match wins. Pivot tables to the right repeat headers (Jo Dee's tab has a second "Deposit Date"), and reading the LAST match blanked 38 Jo Dee deposit dates and set Hooligan's statement month to "Grand Total" (fixed Oct 28 2026).
- A data row = has a client name OR an amount OR a commission (payroll offsets, beginning balances and unlabeled Stern rows have no client). GCBC "Total <Month>" rows are settlements, not lines.
  Text that isn't a date in a date cell is blanked. Always read the report before `--apply`: a tab that was rewritten (Jelly Roll 2023, Oct 2026) looks like mass deletion; use `--hold` until confirmed.
- Oct 28 2026 refresh: 60 new lines (Kash), 2,506 updated (Show Date column, retyped commission types, source/memo cleanup, Backforty artist Langhorne Slim -> Shakey Graves), 143 removed (statement year before 2023).
  RESOLVED (Oct 28): the 2023 Jelly Roll tab was replaced in the sheet; Colin confirmed following the sheet. Old 229 lines archived in `data/archive/refresh/removed_lines_jelly_roll_2023.csv`
  (the earlier 143 are in `removed_lines_2022_statement_period.csv`). Artist alias: the sheet's "Twenty One Pilots" is always read as "21 Pilots" (`ARTIST_ALIASES` in `tools/tracker_tab.py`).

## Refreshing a tab from the Google Sheet (`tools/tracker_tab.py`)
- Download the year's tracker as xlsx via the Drive connector, then `python3 -I tools/tracker_tab.py <download.json> "<Tab>" <year> --out uploads/<tab>_update.csv --apply-data`.
  It matches columns by header name, reports rows added / removed / changed, updates `data/revenue_lines.csv`, and writes an upsert CSV (same `tracker_year + manager + row` keys)
  to upload on Add data > CSV for any running database (re-uploading is safe). It never deletes; removals are only reported. Text dates like 10/21/2026 are handled.

## Decisions 4-9 Nov 2026 (Colin) — keep them
- **Commission types:** Other, Management Service, Sponsorship, Brand, Deduction and no type all fold into `All` (`TYPE_GROUP` in `web/lib/filters.ts`; `TYPE_ALIASES` in `tools/tracker_tab.py`; importers). Dashboard/artist "by type" cards show Touring, Royalties, All and the other real types.
- **Sources:** no line has a blank/`(none)` source. Stern = `All`; One Spark with no source = `All`; Kayleigh payroll offsets = `Offset`; KKR Deal Payout = `KKR`; "More Than We Ever Imagined Expenses" = Touring / Live Performance;
  beginning balances = `Beginning Balance`; adjustments = `Adjustment`; any other blank = `All`. Merch is never typed Royalties (source containing "merch" => `Merch`). Same rules live in `tracker_tab.py` so a refresh keeps them. "Top sources" cards leave out `All`.
- **Unsupported lines** (deposits in the "MT MS 2026 Income tracking" workbook with no tracker line): commission type/source `Unsupported`, amount in the Commission column, dated by the payment, `source_row` 9001+ per tab, database only (`web/lib/seed/unsupported_2026.json`). `tracker_all.py` ignores rows >= 9000 for removals.
  Jo Dee has a -$30,000 retainer adjustment line (9/22); Grey Slate's unsupported payment is the 6/1 $10,258.61. Florence + The Machine's four payments were retyped Retainer / Retainer (5 Nov).
- **Retainers live in "MT MS 2026 Income tracking", not the revenue trackers** (Colin, 17 Nov 2026). The 2026 revenue tracker has no Retainers, Florence + The Machine, Stern or Truth tabs; their database lines (Retainer / Unsupported) are database-only and kept. `tracker_all.py` lists such companies as "income-tracking only", not missing.
- **Held out of refreshes** (`--hold`): `2023|Jelly Roll` (tab rewritten in the sheet, not yet followed), `2026|Jo Dee Messina` and `2026|Here There and Gone` (database has retainer lines the sheet doesn't). Pass all three every time.
- **UI rules:** Tabs remember the last artist picked (artist page, Touring or Royalties; per browser, `lib/Tabs.tsx`): Artist dashboard opens that artist's page, Touring and Royalties open on that artist; picking "All artists" on Royalties forgets it; a dashboard search that lands on one artist (exact name or only match) also sets it. Royalties filters: Artist first, then Search sources. Top artists card = top 5 + "Other" (full list further down). Touring hides Net / avg net when there are no expenses, hides the Lines column unless some show has more than one line, and each show row links to its Google Sheet row (Tracker column).
  Royalties: every column sorts (`sort`/`dir`), "Search sources" box (`sq=`), artist filter; source pages (`/sources/<name>`) have an Artist dropdown.
- **Jo Dee show dates** (rows 4-24 of the 2026 tab, from "Copy of JDM Commissionable shows") are in the tracker's Show Date column and the database, except the two Nashville rows (no matching date).
- **Managers (people):** loaded from Rostr on 2 Nov (`ROSTR_MANAGERS` in `web/lib/db.ts`, one-time flag `managers_rostr_2026_11`); later edits on the Users page exist only in the live database.
- **One-time database changes** are flagged seeds in `ensureManagers` (`web/lib/db.ts`, table `seed_flags`); `seedLines(db, flag, csv, update)` upserts on `(tracker_year, manager_id, source_row)`. After a refresh, put the changed rows in a new `web/lib/seed/sheet_refresh_*.json` (`{csv}`), add a flagged `seedLines(..., true)` call, deploy.
- **Deploy:** from `web/`: `npx tsc --noEmit` then `npx vercel --prod --yes` (project `mtheory-revenue`, https://mtheory-revenue.vercel.app, Vercel team `mtheory1`). Deploys take several minutes; run in the background.
- Requested files (Excel/CSV) go to `~/Downloads`.
- Not done: Sam Ryder Q3 rec FX rate (GBP to USD) was never given; the Vercel MCP server needs `/mcp` authorization.

## Known data gaps (from the export)
- 274 lines with no commission type (mostly former managers' tabs), 139 with no amount, 40 with no artist
  (carve-outs, payroll offsets, unlabeled Stern 2025 rows).
- 16 Statement Year cells that aren't a year; 5 Deposit Date cells that aren't a date.
- 2025 Stern Total formula is `=SUM(K2:K54)` and misses rows 55–57.

## Working with two people (Nov 17 2026)
- The project is a git repository shared through a private GitHub repo. More than one person's Claude may change it, so:
  1. **Before any change:** `git pull`. If there are uncommitted local changes or the pull conflicts, stop and tell the user.
  2. **After a change:** typecheck, commit with a plain message saying what changed on the site, `git push`, then deploy. Never deploy changes that aren't pushed:
     a deploy from a stale copy erases the other person's work on the live site.
  3. Live-database-only edits (Users page, managers, commission overrides) are not in git; that's expected.
- Kept out of git: secrets (`.env*`), `uploads/` (rec files), `pgdata/` (local database). Each person makes their own `web/.env.local`
  with `npx vercel link` (project `mtheory-revenue`, team `mtheory1`) then `npx vercel env pull web/.env.local`.
- Setup for a new teammate is in `TEAMMATE_SETUP.md`.
