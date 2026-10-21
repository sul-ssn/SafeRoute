ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS category_code text,
  ADD COLUMN IF NOT EXISTS classification_code text,
  ADD COLUMN IF NOT EXISTS source_attribution text;

ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS attribution text;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_event_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_event_type_check
  CHECK (event_type IN ('crime','traffic_accident','other'));

UPDATE incidents SET category_code=category WHERE category_code IS NULL;
UPDATE incidents SET event_type='traffic_accident' WHERE category='ДТП' AND event_type='other';

CREATE INDEX IF NOT EXISTS incidents_event_type_date_idx ON incidents (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS incidents_type_category_date_idx ON incidents (event_type, category_code, occurred_at);

INSERT INTO data_sources (
  id,source_key,name,description,source_url,license_notes,data_mode,
  coverage_start,coverage_end,coverage_completeness,spatial_precision_m,
  retrieved_at,last_import_at,attribution,sync_enabled,sync_adapter,sync_url,
  sync_interval_minutes,next_sync_at
) VALUES
  ('qamqor-crime-astana-2026','qamqor-crime-astana','Qamqor GIS — преступления Астаны',
   'Публичный точечный слой KPSSU/crime; сохранены дата, коды классификации и координаты. Статистическая полнота и метрическая точность исходником не опубликованы.',
   'https://gis.kgp.kz/arcgis/rest/services/KPSSU/crime/FeatureServer/1',
   'Свободное использование с обязательной атрибуцией: Информация получена с официального интернет-портала qamqor.gov.kz; согласно законодательству РК.',
   'real','2026-01-01','2026-10-12',NULL,NULL,now(),now(),
   'Информация получена с официального интернет-портала qamqor.gov.kz',true,'qamqor-arcgis-v1',
   'https://gis.kgp.kz/arcgis/rest/services/KPSSU/crime/FeatureServer/1',1440,now()+interval '1 day'),
  ('qamqor-dtp-astana-2026','qamqor-dtp-astana','Qamqor GIS — ДТП Астаны',
   'Публичный точечный слой KPSSU/DTP; сохранены дата, коды классификации и координаты. Статистическая полнота и метрическая точность исходником не опубликованы.',
   'https://gis.kgp.kz/arcgis/rest/services/KPSSU/DTP/FeatureServer/0',
   'Свободное использование с обязательной атрибуцией: Информация получена с официального интернет-портала qamqor.gov.kz; согласно законодательству РК.',
   'real','2026-01-01','2026-10-05',NULL,NULL,now(),now(),
   'Информация получена с официального интернет-портала qamqor.gov.kz',true,'qamqor-arcgis-v1',
   'https://gis.kgp.kz/arcgis/rest/services/KPSSU/DTP/FeatureServer/0',1440,now()+interval '1 day')
ON CONFLICT (id) DO UPDATE SET
  source_key=EXCLUDED.source_key,
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  source_url=EXCLUDED.source_url,
  license_notes=EXCLUDED.license_notes,
  attribution=EXCLUDED.attribution,
  data_mode='real',
  sync_adapter=EXCLUDED.sync_adapter,
  sync_url=EXCLUDED.sync_url,
  sync_interval_minutes=COALESCE(data_sources.sync_interval_minutes,EXCLUDED.sync_interval_minutes),
  sync_enabled=true,
  updated_at=now();

UPDATE incidents i SET
  event_type=CASE WHEN i.source_id='qamqor-crime-astana-2026' THEN 'crime'
                  WHEN i.source_id='qamqor-dtp-astana-2026' THEN 'traffic_accident'
                  ELSE i.event_type END,
  category_code=COALESCE(i.category_code,i.category),
  source_attribution=COALESCE(i.source_attribution,s.attribution)
FROM data_sources s WHERE s.id=i.source_id;
