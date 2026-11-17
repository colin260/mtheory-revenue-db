# Handoff: Mtheory Revenue Database (written 9 Nov 2026)

For picking this project up in a different Claude account (work). Read `CLAUDE.md` first: it is the full project brief and every decision made with Colin. This file covers what is NOT in the code: how to get running, what a new session can't see, and what is still open.

## 1. What this is
Revenue and commission database plus web app for Mtheory (music management). Colin is the Controller. Data is entered in Google Sheets (yearly "Revenue Tracker" workbooks, one tab per company); the database is loaded from them and refreshed.
- App: Next.js in `web/`, deployed on Vercel (project `mtheory-revenue`, team `mtheory1`) at https://mtheory-revenue.vercel.app. Data in Postgres (Supabase) in production, PGlite in `pgdata/` locally.
- Roles: finance (everything), senior and staff (commission/rate/support hidden). All reads go through `scoped()` in `web/lib/scope.ts`.

## 2. Set up in the new account (in this order)
1. Unzip, open the folder in Claude Code (CLAUDE.md loads automatically). Work from `web/` for app commands.
2. `npm install` in the project root and in `web/`.
3. **Secrets are NOT in the zip.** Create `web/.env.local` from `web/.env.local.example`: `DATABASE_URL` (Supabase Postgres), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `BOOTSTRAP_FINANCE_EMAIL`; optional `ANTHROPIC_API_KEY` for the PDF-to-rec feature.
   They already exist in Vercel (project settings > Environment Variables) and in Colin's old setup; ask Colin or use `npx vercel env pull web/.env.local` once the work account has access to the `mtheory1` team.
   Without `DATABASE_URL` the app runs on a local PGlite copy (`pgdata/`, rebuilt with `node load.mjs --reset`).
4. Vercel: the work account must be a member of team `mtheory1` (or the project must be transferred) before `npx vercel --prod --yes` works. Earlier a deploy returned 403 "Not authorized" because the logged-in Vercel user was not on that team; `npx vercel login` with the right account fixed it. `web/.vercel/project.json` links the folder to the project.
5. Connectors the work Claude account needs: **Google Drive** and **Google Sheets** (refreshes and writing to the trackers), optionally Gmail. The Drive connector downloads large xlsx files to a tool-results `.txt` (JSON with base64 `content` and a `title`); `tools/tracker_all.py` reads those files directly.
6. Sign-in to the live app is Google, restricted to the company domain plus the `app_users` allow-list (finance manages it on the Users page, `/admin/users`).

## 3. Google file IDs
| Tracker | ID |
|---|---|
| 2023 Revenue Tracker | `192HOqkrCdk1Ga0aa1tFztYozOLw0w-lPp6b7HGJYnYc` |
| 2024 Revenue Tracker | `1hPNLHBLy1Cc0w3PCTDmzXxC0FvGoPStnPmRreD5fBEo` |
| 2025 Revenue Tracker | `1tuPS8a2t5xfKPeH3tvY_QTYJGSXmItDaWWfsFWL07Io` |
| 2026 Revenue Tracker | `1ZhK3EMsZ99OeSMAToWnQbCDhaG0mgHqpp_4hWxUjzww` |
| JDM Commissionable shows (copy) | `1Y7RtW_a-bNIebYQ5u1UCn88HZ_tEtoLkSpDLgUfCaUM` |
| MT MS 2026 Income tracking (reconciliation workbook, Summary tab) | `1QGL4FwQfEQqxxmCvXHei2fKchsQK085AUq95in3a4_U` |
2022 was removed from the database (archived in `data/archive/2022/`).

## 4. The refresh workflow (what Colin asks for as "update sources")
1. Download the 2023-2026 trackers with the Drive connector (`download_file_content`, export type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). Each saves a big JSON file; identify files by their `title`.
2. Report: `python3 -I tools/tracker_all.py <four files> --hold='2023|Jelly Roll' --hold='2026|Jo Dee Messina' --hold='2026|Here There and Gone'`. Pass the four files as a bash array. Read the report before applying.
3. Same command plus `--apply`. It rewrites `data/revenue_lines.csv` and `data/reconciliation.csv`.
4. Put the changed rows in the live database: write the changed lines (rows whose `line_id` differs from the previous CSV) to `web/lib/seed/sheet_refresh_<date><letter>.json` as `{"csv": "<header+rows>"}`, import it in `web/lib/db.ts` and add `await seedLines(db, '<new flag name>', seed.csv, true)` after the other refresh seeds. Then `cd web && npx tsc --noEmit && npx vercel --prod --yes`.
Why held: Jelly Roll 2023 was rewritten in the sheet (Colin has not asked to follow it); Jo Dee 2026 and Here There and Gone 2026 contain retainer lines that only exist in the database.

## 5. Colin's working preferences (the memory that does not transfer)
- Deploy web changes to Vercel production right after typechecking; do not ask first.
- Files he asks for (Excel, CSV) go to `~/Downloads`. For the artist/manager list: active artists only, with managers.
- He wants short plain answers and usually asks for one change at a time ("update sources", "make X part of All"). He is a finance person, not a developer: say what changed on the site, not code detail.
- The tracker Google Sheets are the source of truth for entered data. Database-only data: Unsupported lines (rows 9001+), retainer lines added for Jo Dee/Here There and Gone, managers (people), projected shows.
- Say plainly what was and wasn't verified (e.g. the live site was usually not opened after a deploy).

## 6. Still open
- Sam Ryder Q3 rec: the GBP to USD FX rate was never provided.
- Jelly Roll 2023 tab: decision on following the rewritten sheet is pending (held out of refreshes).
- Manager (people) list: only the 18 artists from the Rostr load (2 Nov) are filled in the code seed; 21 active artists/clients have none. Edits made on the live Users page are not in the repo.
- Michael payout offsets for Alison Krauss and Tyler Childers: Colin asked to remove them and adjust rates, then said "maybe it's not there". No such lines exist in the database; nothing was changed.
- The Jelly Roll Unsupported $1,000,000 (4/14) line should be verified with Colin.
- Remaining Jo Dee shows (8/1 to 11/6) in the commissionable-shows sheet have no tracker lines; only Nashville 11/6 is in the future. Not added to Projected shows.
- Vercel MCP server in the old account needed `/mcp` authorization; not required for deploys with the CLI.

## 7. First message to paste into the new session
> This is the Mtheory revenue database project. Read CLAUDE.md and HANDOFF.md in this folder, then confirm you can (1) run `cd web && npx tsc --noEmit`, (2) read the 2026 Revenue Tracker with the Google Drive connector, and (3) deploy with `npx vercel --prod --yes`. Tell me what is missing before doing anything else.
