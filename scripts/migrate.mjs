import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const { Client } = pg;
const connectionString = process.env.DATABASE_URL || 'postgres://saferoute:saferoute@localhost:5432/saferoute';
const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new Client({ connectionString });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(72026012)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
  const files = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(72026012)').catch(() => {});
  await client.end();
}
