# CLAUDE.md - Recess Backend

This file provides context for AI agents working on the recess-backend codebase.

## Project Overview

Node.js/Express backend for the Recess fitness app. Uses Drizzle ORM with PostgreSQL.

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Tests:** `npm test`
- **DB migrate:** `npm run db:migrate`
- **DB seed exercises:** `npm run db:seed`
- **Type check:** `npx tsc --noEmit`

## Architecture

- **Routes:** `src/routes/` - Express routers
- **Services:** `src/services/` - Business logic (exerciseService, templateService, programService, etc.)
- **Schema:** `src/db/schema.ts` - Drizzle ORM schema definitions
- **Validation:** `src/utils/validation.ts` - Request input validation
- **Middleware:** `src/middleware/` - Auth middleware (Firebase-based)
- **Migrations:** `drizzle/` - SQL migration files

## Known Pitfalls

### SQL NULL Equality Trap (Critical)

When filtering boolean columns that may contain NULL values, **never use `eq(column, false)`**. In SQL, `NULL = false` evaluates to `NULL` (falsy), silently excluding rows where the column is NULL.

**Bad:** `eq(exercises.isCustom, false)` -- misses rows where `is_custom IS NULL`
**Good:** `` sql`${exercises.isCustom} IS NOT TRUE` `` -- matches both `false` and `NULL`

This caused a production bug where GET /api/exercises returned 200 OK with zero exercises despite exercises existing in the database. The `is_custom` column had NULL values (not `false`), and `eq(exercises.isCustom, false)` silently filtered out every row.

**Rule:** Any time you filter a nullable boolean for "not true", use `IS NOT TRUE`. Any time you filter for "not false", use `IS NOT FALSE`.

### Seed Data

The exercise seed script (`scripts/seed-exercises.ts`) uses `onConflictDoUpdate` but does NOT update `isCustom` on conflict. If you need to fix `is_custom` values in the database, you'll need a separate migration or manual UPDATE statement:
```sql
UPDATE exercises SET is_custom = false WHERE is_custom IS NULL;
```

### pg_trgm Extension

Fuzzy search on exercises uses PostgreSQL's `pg_trgm` extension with `similarity()`. The extension is created in migration `0005_opposite_wraith.sql`. The similarity threshold is `0.3` (defined in `exerciseService.ts`).

## Testing

- Tests are in `src/**/*.test.ts` files alongside source
- Uses Jest with `ts-jest` preset
- DB and schema are mocked in tests (no real DB connection needed)
- Run `npm test` to execute all 136 tests
