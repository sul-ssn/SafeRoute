CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE incident_rehash_work ON COMMIT DROP AS
WITH normalized AS (
  SELECT i.id,
    encode(digest(convert_to(
      CASE WHEN i.external_id IS NOT NULL THEN
        'id:' || octet_length(i.external_id)::text || '|' || i.external_id
      ELSE
        'type:' || octet_length(i.event_type)::text || '|' || i.event_type ||
        '|category:' || octet_length(i.category_code)::text || '|' || i.category_code ||
        '|' || COALESCE(i.occurred_at::text,'') ||
        '|' || to_char(round(ST_Y(i.geom)::numeric,6),'FM999990.000000') ||
        '|' || to_char(round(ST_X(i.geom)::numeric,6),'FM999990.000000')
      END, 'UTF8'), 'sha256'), 'hex') AS new_hash,
    row_number() OVER (PARTITION BY i.source_id, encode(digest(convert_to(
      CASE WHEN i.external_id IS NOT NULL THEN
        'id:' || octet_length(i.external_id)::text || '|' || i.external_id
      ELSE
        'type:' || octet_length(i.event_type)::text || '|' || i.event_type ||
        '|category:' || octet_length(i.category_code)::text || '|' || i.category_code ||
        '|' || COALESCE(i.occurred_at::text,'') ||
        '|' || to_char(round(ST_Y(i.geom)::numeric,6),'FM999990.000000') ||
        '|' || to_char(round(ST_X(i.geom)::numeric,6),'FM999990.000000')
      END, 'UTF8'), 'sha256'), 'hex')
      ORDER BY (i.classification_code IS NOT NULL) DESC, i.created_at DESC, i.id) AS row_number,
    first_value(i.classification_code) OVER (PARTITION BY i.source_id, encode(digest(convert_to(
      CASE WHEN i.external_id IS NOT NULL THEN
        'id:' || octet_length(i.external_id)::text || '|' || i.external_id
      ELSE
        'type:' || octet_length(i.event_type)::text || '|' || i.event_type ||
        '|category:' || octet_length(i.category_code)::text || '|' || i.category_code ||
        '|' || COALESCE(i.occurred_at::text,'') ||
        '|' || to_char(round(ST_Y(i.geom)::numeric,6),'FM999990.000000') ||
        '|' || to_char(round(ST_X(i.geom)::numeric,6),'FM999990.000000')
      END, 'UTF8'), 'sha256'), 'hex')
      ORDER BY (i.classification_code IS NOT NULL) DESC, i.created_at DESC, i.id) AS classification_code,
    first_value(i.source_attribution) OVER (PARTITION BY i.source_id, encode(digest(convert_to(
      CASE WHEN i.external_id IS NOT NULL THEN
        'id:' || octet_length(i.external_id)::text || '|' || i.external_id
      ELSE
        'type:' || octet_length(i.event_type)::text || '|' || i.event_type ||
        '|category:' || octet_length(i.category_code)::text || '|' || i.category_code ||
        '|' || COALESCE(i.occurred_at::text,'') ||
        '|' || to_char(round(ST_Y(i.geom)::numeric,6),'FM999990.000000') ||
        '|' || to_char(round(ST_X(i.geom)::numeric,6),'FM999990.000000')
      END, 'UTF8'), 'sha256'), 'hex')
      ORDER BY (i.source_attribution IS NOT NULL) DESC, i.created_at DESC, i.id) AS source_attribution
  FROM incidents i WHERE i.geom IS NOT NULL
)
SELECT * FROM normalized;

DELETE FROM incidents i USING incident_rehash_work w
WHERE i.id=w.id AND w.row_number>1;

UPDATE incidents i SET record_hash=w.new_hash,
  classification_code=COALESCE(w.classification_code,i.classification_code),
  source_attribution=COALESCE(w.source_attribution,i.source_attribution)
FROM incident_rehash_work w WHERE i.id=w.id AND w.row_number=1;

DROP TABLE incident_rehash_work;
