ALTER TABLE incidents ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;
UPDATE incidents i SET is_synthetic=true
  FROM data_sources s
  WHERE s.id=i.source_id AND s.data_mode='demo' AND i.is_synthetic=false;
CREATE INDEX IF NOT EXISTS incidents_real_risk_idx
  ON incidents (occurred_at, category) WHERE is_synthetic=false;
