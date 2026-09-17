#!/usr/bin/env node
'use strict';
// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... node scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await db.query('SELECT pg_advisory_lock(424242)'); // two deploys can't migrate at once
  try {
    const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      process.stdout.write(`Applying ${f} … `);
      await db.query(fs.readFileSync(path.join(dir, f), 'utf8')); // each file manages its own BEGIN/COMMIT
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      console.log('done');
    }
    console.log('Migrations up to date.');
  } finally {
    await db.query('SELECT pg_advisory_unlock(424242)');
    await db.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
