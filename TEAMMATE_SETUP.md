# Setting up as a second editor of the Mtheory Revenue Database

## Colin does (access can only be granted by Colin)
1. GitHub: add the teammate as a collaborator on the private repo.
2. Vercel: invite them to team `mtheory1` (Team Settings > Members).
3. Google Drive: share the 2023-2026 Revenue Tracker sheets and "MT MS 2026 Income tracking" with them (IDs in HANDOFF.md).
4. App: add them on the Users page (`/admin/users`) with the right role (finance to see commission).

## The teammate does
1. Install Claude Code (desktop app), Node.js, and git; sign in to GitHub.
2. Clone the repo, open the folder in Claude Code. CLAUDE.md and HANDOFF.md give Claude the full history and rules.
3. In Claude, connect Google Drive and Google Sheets.
4. Paste this as the first message:
   > This is the Mtheory revenue database. Read CLAUDE.md, HANDOFF.md and TEAMMATE_SETUP.md. Then run `npm install` in the project root and in `web/`,
   > `cd web && npx vercel login && npx vercel link` (project mtheory-revenue, team mtheory1) and `npx vercel env pull .env.local`,
   > confirm `npx tsc --noEmit` passes and that you can read the 2026 Revenue Tracker. Tell me what's missing.
5. Always let Claude `git pull` before a change and push before deploying (rules in CLAUDE.md, "Working with two people").
