CREATE INDEX IF NOT EXISTS incidents_geom_geography_gix
  ON incidents USING gist ((geom::geography));
