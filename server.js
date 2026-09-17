'use strict';
// ScootHero Back Office — app entry. Minimal on purpose: health check, sessions, static, and a holding page.
// Claude Code builds the modules on top of this (docs/claude-code-playbook.md).
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');

const required = ['DATABASE_URL', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = express();

app.set('trust proxy', 1); // behind Nginx
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'src/styles'), { maxAge: '7d' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  name: 'sh.sid',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
}));

app.get('/healthz', async (req, res) => {
  try {
    const r = await pool.query('SELECT (SELECT count(*) FROM schema_migrations) AS migrations');
    res.json({ ok: true, migrations: Number(r.rows[0].migrations), version: process.env.APP_VERSION || 'dev' });
  } catch (e) {
    res.status(503).json({ ok: false });
  }
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScootHero Back Office</title><link rel="stylesheet" href="/static/typography.css">
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#F5F7F6;color:#18212A}main{padding:24px;max-width:480px}</style></head>
<body><main><h1>ScootHero Back Office</h1><p class="t-body">Property module is being built. Version ${process.env.APP_VERSION || 'dev'}.</p></main></body></html>`);
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, '127.0.0.1', () => console.log(`Back office listening on 127.0.0.1:${port}`));

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
