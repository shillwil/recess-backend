-- One-off data migration: rename predefined exercise "Lat Pulldown" -> "Lat Pulldown Machine".
--
-- WHY a manual UPDATE (not just re-seeding): the seed (scripts/seed-exercises.ts) upserts on
-- exercises.name. It therefore CANNOT rename — re-seeding with the new name would INSERT a fresh
-- "Lat Pulldown Machine" row and leave the old "Lat Pulldown" row orphaned. This UPDATE renames the
-- existing row IN PLACE, preserving its id (and every workout/template/set row that references it
-- via exercise_id). It is idempotent and safe to run before seeding:
--   * no-op if there is no "Lat Pulldown" row (already migrated, or fresh DB)
--   * skips if a "Lat Pulldown Machine" row somehow already exists (avoids unique-name collision)
--   * only touches the predefined row (is_custom = false), never a user's custom exercise

UPDATE exercises
SET name = 'Lat Pulldown Machine'
WHERE name = 'Lat Pulldown'
  AND is_custom = false
  AND NOT EXISTS (SELECT 1 FROM exercises e2 WHERE e2.name = 'Lat Pulldown Machine');

-- Verify (expect: Lat Pulldown Machine + Lat Cable Pulldown present, no bare "Lat Pulldown"):
-- SELECT name, is_custom FROM exercises WHERE name ILIKE '%lat%pulldown%' ORDER BY name;
