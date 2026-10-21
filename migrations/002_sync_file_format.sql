ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS sync_file_format text CHECK (sync_file_format IS NULL OR sync_file_format IN ('csv','geojson'));
