CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS data_sources (
  id text PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  source_url text,
  license_notes text NOT NULL DEFAULT 'Не подтверждено',
  data_mode text NOT NULL DEFAULT 'unverified' CHECK (data_mode IN ('demo','real','aggregate','unverified')),
  coverage_start date,
  coverage_end date,
  coverage_completeness numeric(4,3) CHECK (coverage_completeness BETWEEN 0 AND 1),
  spatial_precision_m numeric(10,2) CHECK (spatial_precision_m IS NULL OR spatial_precision_m >= 0),
  retrieved_at timestamptz,
  last_import_at timestamptz,
  sync_enabled boolean NOT NULL DEFAULT false,
  sync_adapter text,
  sync_url text,
  sync_interval_minutes integer CHECK (sync_interval_minutes IS NULL OR sync_interval_minutes >= 15),
  next_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_start IS NULL OR coverage_end IS NULL OR coverage_start <= coverage_end),
  CHECK (NOT sync_enabled OR (data_mode = 'real' AND sync_adapter IS NOT NULL AND sync_url IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  external_id text,
  record_hash text NOT NULL,
  category text NOT NULL,
  occurred_at date,
  geom geometry(Point, 4326),
  spatial_precision_m numeric(10,2) CHECK (spatial_precision_m IS NULL OR spatial_precision_m >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (geom IS NULL OR ST_IsValid(geom)),
  UNIQUE (source_id, record_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_source_external_id_uq
  ON incidents (source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS incidents_geom_gix ON incidents USING gist (geom);
CREATE INDEX IF NOT EXISTS incidents_occurred_at_idx ON incidents (occurred_at);
CREATE INDEX IF NOT EXISTS incidents_category_date_idx ON incidents (category, occurred_at);
CREATE INDEX IF NOT EXISTS incidents_source_idx ON incidents (source_id);

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  filename text NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','completed_with_errors','failed')),
  total_rows integer NOT NULL DEFAULT 0,
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
);
CREATE INDEX IF NOT EXISTS import_jobs_created_at_idx ON import_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_source_idx ON import_jobs (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS source_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('running','completed','failed','adapter_unconfigured')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  fetched_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  message text
);
CREATE INDEX IF NOT EXISTS source_sync_due_idx ON data_sources (next_sync_at) WHERE sync_enabled;

INSERT INTO data_sources (id, source_key, name, description, license_notes, data_mode, coverage_start, coverage_end, retrieved_at, last_import_at)
VALUES ('demo-astana-2026','demo-astana-2026','SafeRoute DEMO — учебный набор','Синтетические события для проверки интерфейса. Не отражают реальную безопасность города.','Тестовые данные, только для демонстрации.','demo','2026-01-01','2026-09-30','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO incidents (source_id, external_id, record_hash, category, occurred_at, geom, spatial_precision_m)
VALUES
('demo-astana-2026','demo-001','demo-001','ДТП','2026-09-24',ST_SetSRID(ST_MakePoint(71.431,51.128),4326),1000),
('demo-astana-2026','demo-002','demo-002','Освещение','2026-09-18',ST_SetSRID(ST_MakePoint(71.438,51.124),4326),1000),
('demo-astana-2026','demo-003','demo-003','ДТП','2026-09-11',ST_SetSRID(ST_MakePoint(71.426,51.119),4326),1000),
('demo-astana-2026','demo-004','demo-004','Прочее','2026-08-28',ST_SetSRID(ST_MakePoint(71.444,51.116),4326),1000),
('demo-astana-2026','demo-005','demo-005','ДТП','2026-08-19',ST_SetSRID(ST_MakePoint(71.432,51.112),4326),1000),
('demo-astana-2026','demo-006','demo-006','Освещение','2026-08-07',ST_SetSRID(ST_MakePoint(71.447,51.108),4326),1000),
('demo-astana-2026','demo-007','demo-007','ДТП','2026-07-30',ST_SetSRID(ST_MakePoint(71.422,51.104),4326),1000),
('demo-astana-2026','demo-008','demo-008','Прочее','2026-07-16',ST_SetSRID(ST_MakePoint(71.437,51.101),4326),1000),
('demo-astana-2026','demo-009','demo-009','ДТП','2026-07-02',ST_SetSRID(ST_MakePoint(71.450,51.097),4326),1000),
('demo-astana-2026','demo-010','demo-010','Освещение','2026-06-21',ST_SetSRID(ST_MakePoint(71.435,51.092),4326),1000),
('demo-astana-2026','demo-011','demo-011','ДТП','2026-06-09',ST_SetSRID(ST_MakePoint(71.446,51.087),4326),1000),
('demo-astana-2026','demo-012','demo-012','Прочее','2026-05-23',ST_SetSRID(ST_MakePoint(71.428,51.081),4326),1000),
('demo-astana-2026','demo-013','demo-013','ДТП','2026-05-11',ST_SetSRID(ST_MakePoint(71.415,51.125),4326),1000),
('demo-astana-2026','demo-014','demo-014','Освещение','2026-04-29',ST_SetSRID(ST_MakePoint(71.411,51.117),4326),1000),
('demo-astana-2026','demo-015','demo-015','ДТП','2026-04-13',ST_SetSRID(ST_MakePoint(71.414,51.109),4326),1000),
('demo-astana-2026','demo-016','demo-016','Прочее','2026-03-26',ST_SetSRID(ST_MakePoint(71.410,51.102),4326),1000),
('demo-astana-2026','demo-017','demo-017','ДТП','2026-03-08',ST_SetSRID(ST_MakePoint(71.419,51.095),4326),1000),
('demo-astana-2026','demo-018','demo-018','Освещение','2026-02-18',ST_SetSRID(ST_MakePoint(71.413,51.089),4326),1000),
('demo-astana-2026','demo-019','demo-019','ДТП','2026-01-22',ST_SetSRID(ST_MakePoint(71.420,51.083),4326),1000),
('demo-astana-2026','demo-020','demo-020','Прочее','2026-01-12',ST_SetSRID(ST_MakePoint(71.434,51.078),4326),1000),
('demo-astana-2026','demo-021','demo-021','ДТП','2026-09-03',ST_SetSRID(ST_MakePoint(71.452,51.121),4326),1000),
('demo-astana-2026','demo-022','demo-022','ДТП','2026-08-14',ST_SetSRID(ST_MakePoint(71.457,51.113),4326),1000),
('demo-astana-2026','demo-023','demo-023','Освещение','2026-07-18',ST_SetSRID(ST_MakePoint(71.458,51.106),4326),1000),
('demo-astana-2026','demo-024','demo-024','ДТП','2026-06-12',ST_SetSRID(ST_MakePoint(71.459,51.099),4326),1000)
ON CONFLICT DO NOTHING;
