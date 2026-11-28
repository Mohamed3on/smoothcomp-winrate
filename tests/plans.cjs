// Query plans as D1 would choose them: every statement the server tests run, explained over the schema with production's
// table statistics (fixtures/sqlite_stat1.json, from `SELECT tbl, idx, stat FROM sqlite_stat1` on D1), so SQLite weighs each
// table at its real size; then again with each big table's statistics gone, as a rebuild leaves it until the crawler's restat
// puts them back. A step that walks a big table by site alone, or scans it, fails unless fixtures/walks.json lists it: on
// 2026-11-28 a dropped statistic read ~1B rows overnight, and with people's missing an unpinned join read every account per
// athlete page (33 s). After a change that walks on purpose, or a fresh statistics snapshot, rewrite the list with
// WALKS=write bun run test, and read what it added.
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const STATS = `${__dirname}/fixtures/sqlite_stat1.json`;
const WALKS = `${__dirname}/fixtures/walks.json`;
const BIG = 5e3; // rows: a smaller table is read whole for next to nothing
const seen = new Set();

const record = (sql) => seen.add(sql);

// The schema with production's statistics, less those of `without` (a table name).
function planner(without) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(`${__dirname}/../server/schema.sql`, 'utf8'));
  db.exec('ANALYZE'); // makes sqlite_stat1, replaced by production's
  db.exec('DELETE FROM sqlite_stat1');
  const stats = JSON.parse(fs.readFileSync(STATS, 'utf8'));
  const put = db.prepare('INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)');
  for (const { tbl, idx, stat } of stats) if (tbl !== without) put.run(tbl, idx, stat);
  db.exec('ANALYZE sqlite_schema'); // reloads the statistics
  const rows = {};
  for (const { tbl, stat } of stats) rows[tbl] = Math.max(rows[tbl] ?? 0, parseInt(stat, 10));
  const indexOf = Object.fromEntries(db.prepare("SELECT name, tbl_name FROM sqlite_schema WHERE type = 'index'").all().map((r) => [r.name, r.tbl_name]));
  return { db, rows, indexOf };
}

// Each big-table walk in one statement's plan, as "table: step".
function walks({ db, rows, indexOf }, sql) {
  let plan;
  try { plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(); } catch { return []; }
  // The aliases a statement gives its tables (FROM entries e, JOIN people p ...).
  const alias = {};
  for (const [, table, as] of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(?!ON\b|WHERE\b|USING\b|JOIN\b|CROSS\b|LEFT\b|INNER\b|SET\b|GROUP\b|ORDER\b|LIMIT\b|VALUES\b|SELECT\b|WITH\b|INDEXED\b|DEFAULT\b)(\w+))?/gi)) {
    alias[table] = table;
    if (as) alias[as] = table;
  }
  const out = [];
  for (const { detail } of plan) {
    const step = detail.match(/^(?:SCAN|SEARCH) (\w+)(?: USING (?:COVERING )?(?:INDEX|PRIMARY KEY) ?(\w*))?(?: \((.*)\))?$/);
    if (!step) continue;
    const [, name, index, keys] = step;
    const table = (index && indexOf[index]) || alias[name] || name;
    if (!(rows[table] >= BIG)) continue;
    if (detail.startsWith('SCAN') || keys === 'site=?' || /^ANY\(site\)/.test(keys ?? '')) out.push(`${table}: ${detail}`);
  }
  return out;
}

const shape = (sql) => sql.replace(/\s+/g, ' ').trim();

// Walks not in the list (fail), as [statistics, statement, walk], and list entries no statement walks any more (stale).
function check() {
  const full = planner();
  const found = [];
  for (const without of [null, ...Object.keys(full.rows).filter((t) => full.rows[t] >= BIG)]) {
    const p = without ? planner(without) : full;
    for (const sql of seen) for (const w of walks(p, sql)) found.push([without ? `without ${without} stats` : 'all stats', shape(sql), w]);
  }
  // One entry per statement and walk, whichever statistics show it.
  const key = ([, sql, w]) => `${sql.slice(0, 160)} | ${w}`;
  const keys = [...new Set(found.map(key))].sort();
  if (process.env.WALKS === 'write') fs.writeFileSync(WALKS, `${JSON.stringify(keys, null, 1)}\n`);
  const listed = new Set(fs.existsSync(WALKS) ? JSON.parse(fs.readFileSync(WALKS, 'utf8')) : []);
  const unlisted = [...new Map(found.filter((f) => !listed.has(key(f))).map((f) => [key(f), f])).values()];
  return { unlisted, stale: [...listed].filter((k) => !keys.includes(k)), statements: seen.size };
}

module.exports = { record, check, walks, planner };
