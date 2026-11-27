// D1 bills past what the plan includes each month: 50 million rows written and 25 billion read (Workers
// Paid). Every ten minutes the crawler reads the database's own counts, the ones billing counts (Cloudflare's
// GraphQL analytics, through the CF_ANALYTICS_TOKEN secret, read only), over the last 30 days and today, and
// keeps a verdict in meta 'budget':
//   ok
//   slow: past 70% of a month's allowance, or a day past its thirtieth: the crawler, event listing and
//         academy lookups stop
//   stop: past 90%: uploads stop being stored too (the site still reads what it holds)
// A verdict older than an hour (the analytics unanswered) counts as slow for the background work.
export const INCLUDED = { written: 50e6, read: 25e9 };
const DATABASE = '63a2b393-f89d-4642-9ad7-e578cb2638e9';
const ACCOUNT = '4223bb20bcc0a82da474e80ddd02370a';
const STALE = 3600e3;

export function verdict({ written, read, writtenToday, readToday }) {
  if (written >= 0.9 * INCLUDED.written || read >= 0.9 * INCLUDED.read) return 'stop';
  if (written >= 0.7 * INCLUDED.written || read >= 0.7 * INCLUDED.read
    || writtenToday >= INCLUDED.written / 30 || readToday >= INCLUDED.read / 30) return 'slow';
  return 'ok';
}

// Rows D1 may write today: a thirtieth of a month's allowance, or less when the 29 days before leave less
// under the 70% that slows everything (so a steady pace settles at 70% of the month).
export const dayShare = ({ written, writtenToday }) =>
  Math.max(0, Math.min(INCLUDED.written / 30, 0.7 * INCLUDED.written - (written - writtenToday)));

// The last 30 days' and today's rows written and read, from the analytics; the verdict kept in meta.
export async function checkBudget(env, now = Date.now()) {
  if (!env.CF_ANALYTICS_TOKEN) return;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const query = `query($a: String!, $db: String!, $from: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    d1AnalyticsAdaptiveGroups(limit: 40, filter: {databaseId: $db, date_geq: $from}) { sum { rowsWritten rowsRead } dimensions { date } } } } }`;
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: ACCOUNT, db: DATABASE, from: day(now - 29 * 864e5) } }),
  });
  const days = (await response.json())?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(days)) { console.error('budget: analytics unanswered', response.status); return; }
  const today = days.find((d) => d.dimensions.date === day(now))?.sum ?? { rowsWritten: 0, rowsRead: 0 };
  const sums = { written: days.reduce((n, d) => n + d.sum.rowsWritten, 0), read: days.reduce((n, d) => n + d.sum.rowsRead, 0), writtenToday: today.rowsWritten, readToday: today.rowsRead };
  const kept = { ...sums, state: verdict(sums), at: now };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('budget', ?1)").bind(JSON.stringify(kept)).run();
  if (kept.state !== 'ok') console.log('budget', kept);
  return kept;
}

// The verdict kept, read at most once a minute per isolate; one too old counts as slow.
const seen = new WeakMap();
export async function budget(env, now = Date.now(), fresh = false) {
  let got = seen.get(env.DB);
  if (fresh || !got || now - got.read > 60e3) {
    const row = await env.DB.prepare("SELECT (SELECT v FROM meta WHERE k = 'budget') AS v, (SELECT v FROM meta WHERE k = 'pause') AS pause").first().catch(() => null);
    seen.set(env.DB, (got = { read: now, kept: row?.v ? JSON.parse(row.v) : null, pause: row?.pause ?? 0 }));
  }
  // A pause set by hand (meta 'pause' = until, ms) stops all writing, as 'stop' does: for a migration.
  if (got.pause > now) return 'stop';
  const { kept } = got;
  if (!kept || now - kept.at > STALE) return kept?.state === 'stop' ? 'stop' : 'slow';
  return kept.state;
}
