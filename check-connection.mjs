// Tests a Supabase database login several ways and prints only pass/fail (never the password).
//   read -s "PGPW?Database password: "; export PGPW; node check-connection.mjs
import pg from 'pg';

const ref = process.env.SUPABASE_REF || 'tgiesakqdoaogqjsirym';
const region = process.env.SUPABASE_POOLER_HOST || 'aws-0-us-east-1.pooler.supabase.com';
const pw = process.env.PGPW ?? '';
const odd = [...pw].filter(c => !/[A-Za-z0-9]/.test(c)).length;
console.log(`password length: ${pw.length} | non-alphanumeric characters: ${odd} | leading/trailing whitespace: ${pw !== pw.trim()}`);
if (!pw) { console.log('No password received. Run the read -s line first, in the same terminal.'); process.exit(1); }

const targets = [
  ['session pooler (5432)',     { host: region, port: 5432, user: `postgres.${ref}` }],
  ['transaction pooler (6543)', { host: region, port: 6543, user: `postgres.${ref}` }],
  ['direct connection',         { host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres' }],
];
for (const [label, t] of targets) {
  const c = new pg.Client({ ...t, password: pw, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try { await c.connect(); const r = await c.query('select current_user u, version() v'); console.log(`OK    ${label}: connected as ${r.rows[0].u}`); await c.end(); }
  catch (e) { console.log(`FAIL  ${label}: ${e.code || ''} ${e.message}`); }
}
