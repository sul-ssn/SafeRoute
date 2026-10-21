CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Rebuild deterministic identities before imports start preserving the
-- multiplicity of source rows that share a date/category/location.
WITH ranked AS (
  SELECT i.id, i.external_id,
    row_number() OVER (
      PARTITION BY i.source_id, i.event_type, i.category_code,
        COALESCE(i.classification_code, ''), i.occurred_at,
        round(ST_Y(i.geom)::numeric, 6), round(ST_X(i.geom)::numeric, 6)
      ORDER BY i.id
    ) AS occurrence,
    CASE WHEN i.external_id IS NOT NULL THEN
      'id:' || octet_length(i.external_id)::text || '|' || i.external_id
    ELSE
      'type:' || octet_length(i.event_type)::text || '|' || i.event_type ||
      '|category:' || octet_length(i.category_code)::text || '|' || i.category_code ||
      '|classification:' || octet_length(COALESCE(i.classification_code, ''))::text || '|' || COALESCE(i.classification_code, '') ||
      '|' || COALESCE(i.occurred_at::text, '') ||
      '|' || to_char(round(ST_Y(i.geom)::numeric, 6), 'FM999990.000000') ||
      '|' || to_char(round(ST_X(i.geom)::numeric, 6), 'FM999990.000000')
    END AS base
  FROM incidents i
  WHERE i.external_id IS NOT NULL OR i.geom IS NOT NULL
), hashes AS (
  SELECT id, encode(digest(convert_to(
    CASE WHEN external_id IS NOT NULL THEN base
      ELSE base || '|occurrence:' || occurrence::text
    END, 'UTF8'), 'sha256'), 'hex') AS record_hash
  FROM ranked
)
UPDATE incidents i SET record_hash=h.record_hash
FROM hashes h WHERE i.id=h.id;
