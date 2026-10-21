import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const { persistImport } = await import('../src/imports.ts');
const directory = join(process.cwd(), 'data', 'imports');
const sources = [
  ['qamqor_astana_crime_2026-01-01_2026-10-12.geojson', 'qamqor-crime-astana-2026'],
  ['qamqor_astana_dtp_2026-01-01_2026-10-12.geojson', 'qamqor-dtp-astana-2026'],
];
for (const [filename, sourceId] of sources) {
  const bytes = await readFile(join(directory, filename));
  const result = await persistImport(filename, bytes, { sourceId });
  const job = result.job;
  console.log(`${sourceId}: total=${job.total_rows} accepted=${job.accepted_rows} rejected=${job.rejected_rows} duplicates=${job.duplicate_rows}`);
  if (job.status !== 'completed') throw new Error(`Import ${sourceId} did not complete cleanly; inspect import_jobs.errors`);
}
