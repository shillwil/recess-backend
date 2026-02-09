import { db } from '../db';
import {
  exercises,
  userExerciseHistory,
  difficultyLevelEnum,
  movementPatternEnum,
  exerciseTypeEnum,
  muscleGroupEnum
} from '../db/schema';
import {
  eq,
  and,
  or,
  sql,
  desc,
  asc,
  inArray,
  isNotNull,
  SQL
} from 'drizzle-orm';
import {
  ExerciseListQuery,
  ExerciseListItem,
  ExerciseDetail,
  ExerciseListResponse,
  FilterMetadata,
  FilterOption,
  CursorData,
  ExerciseSortOption
} from '../models/exercise.types';

// ============ Constants ============

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const WORD_SIMILARITY_THRESHOLD = 0.3;

// Difficulty order for sorting
const DIFFICULTY_ORDER: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3
};

// ============ Cursor Utilities ============

export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);

    // Validate cursor structure
    if (!isValidCursorData(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Validates that parsed cursor data has the expected structure
 */
function isValidCursorData(data: unknown): data is CursorData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const cursor = data as Record<string, unknown>;

  // id must be a non-empty string
  if (typeof cursor.id !== 'string' || cursor.id.length === 0) {
    return false;
  }

  // sortValue must be string, number, or null
  if (cursor.sortValue !== null &&
      typeof cursor.sortValue !== 'string' &&
      typeof cursor.sortValue !== 'number') {
    return false;
  }

  // sortField must be a valid sort option
  const validSortFields: ExerciseSortOption[] = ['name', 'popularity', 'recently_used', 'difficulty'];
  if (typeof cursor.sortField !== 'string' || !validSortFields.includes(cursor.sortField as ExerciseSortOption)) {
    return false;
  }

  return true;
}

// ============ Main Service Functions ============

export async function getExercises(
  query: ExerciseListQuery,
  userId?: string
): Promise<ExerciseListResponse> {
  const limit = Math.min(query.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const sort = query.sort || 'name';
  const order = query.order || 'asc';
  const page = query.page; // For offset-based pagination (iOS compatibility)

  // Validate recently_used sort requires authentication
  if (sort === 'recently_used' && !userId) {
    throw new Error('Authentication required for "recently_used" sort');
  }

  // Build conditions array
  const conditions: SQL[] = [eq(exercises.isCustom, false)];

  // Add filter conditions
  addFilterConditions(conditions, query);

  // Handle search using word_similarity() for fuzzy matching with an ILIKE
  // prefix fallback for short queries. word_similarity() finds the best match
  // between the search term and any substring of the target, handling both
  // partial ("Smith" -> "Smith Machine") and misspelled queries well.
  // For very short terms (< 3 chars), trigram matching can't produce useful
  // scores, so we fall back to a prefix ILIKE match instead.
  if (query.search && query.search.trim()) {
    const searchTerm = query.search.trim();
    const escapedTerm = searchTerm.replace(/[%_\\]/g, '\\$&');
    const prefixPattern = `${escapedTerm}%`;

    if (searchTerm.length < 3) {
      // Too short for trigrams — use prefix match only
      conditions.push(sql`(
        ${exercises.name} ILIKE ${prefixPattern}
        OR EXISTS (
          SELECT 1 FROM exercise_aliases ea
          WHERE ea.exercise_id = ${exercises.id}
          AND ea.alias ILIKE ${prefixPattern}
        )
      )`);
    } else {
      // Use word_similarity for fuzzy + prefix ILIKE as a safety net
      conditions.push(sql`(
        ${exercises.name} ILIKE ${prefixPattern}
        OR word_similarity(${searchTerm}, ${exercises.name}) > ${WORD_SIMILARITY_THRESHOLD}
        OR EXISTS (
          SELECT 1 FROM exercise_aliases ea
          WHERE ea.exercise_id = ${exercises.id}
          AND (
            ea.alias ILIKE ${prefixPattern}
            OR word_similarity(${searchTerm}, ea.alias) > ${WORD_SIMILARITY_THRESHOLD}
          )
        )
      )`);
    }
  }

  // Use offset-based pagination if page is provided, otherwise use cursor
  const useOffsetPagination = page !== undefined;

  // Handle cursor pagination (only if not using offset pagination)
  if (!useOffsetPagination && query.cursor) {
    const cursorData = decodeCursor(query.cursor);
    if (cursorData) {
      const cursorCondition = buildCursorCondition(cursorData, order, userId);
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }
  }

  // For offset pagination, get total count
  let totalCount: number | undefined;
  if (useOffsetPagination) {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(exercises)
      .where(and(...conditions));
    totalCount = Number(countResult[0]?.count || 0);
  }

  // Build the query
  let baseQuery = db
    .select({
      id: exercises.id,
      name: exercises.name,
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
      equipment: exercises.equipment,
      difficulty: exercises.difficulty,
      movementPattern: exercises.movementPattern,
      exerciseType: exercises.exerciseType,
      thumbnailUrl: exercises.thumbnailUrl,
      videoUrl: exercises.videoUrl,
      popularityScore: exercises.popularityScore
    })
    .from(exercises)
    .where(and(...conditions))
    .limit(useOffsetPagination ? limit : limit + 1); // Fetch one extra for cursor pagination to determine hasMore

  // Apply offset for page-based pagination
  if (useOffsetPagination && page && page > 1) {
    baseQuery = baseQuery.offset((page - 1) * limit) as typeof baseQuery;
  }

  // Apply sorting
  const sortedQuery = applySorting(baseQuery, sort, order, userId);

  const results: typeof baseQuery extends Promise<infer T> ? T : never = await sortedQuery;

  // Determine if there are more results
  let hasMore: boolean;
  let exerciseList: typeof results;

  if (useOffsetPagination) {
    // For offset pagination, calculate hasMore from total count
    const currentPage = page || 1;
    hasMore = totalCount !== undefined && currentPage * limit < totalCount;
    exerciseList = results;
  } else {
    // For cursor pagination, check if we got more than limit
    hasMore = results.length > limit;
    exerciseList = hasMore ? results.slice(0, limit) : results;
  }

  // Build next cursor (only for cursor-based pagination)
  let nextCursor: string | null = null;
  if (!useOffsetPagination && hasMore && exerciseList.length > 0) {
    const lastExercise = exerciseList[exerciseList.length - 1];

    // Pre-fetch user exercise history for recently_used sort to avoid N+1 query
    let historyMap: Map<string, Date> | undefined;
    if (sort === 'recently_used' && userId) {
      const exerciseIds = exerciseList.map(e => e.id);
      historyMap = await prefetchUserExerciseHistory(userId, exerciseIds);
    }

    const sortValue = getSortValue(lastExercise, sort, historyMap);
    nextCursor = encodeCursor({
      id: lastExercise.id,
      sortValue,
      sortField: sort
    });
  }

  // Transform to response format
  const exerciseItems: ExerciseListItem[] = exerciseList.map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscles: (e.primaryMuscles as string[]) || [],
    secondaryMuscles: (e.secondaryMuscles as string[]) || [],
    equipment: e.equipment,
    difficulty: e.difficulty,
    movementPattern: e.movementPattern,
    exerciseType: e.exerciseType,
    thumbnailUrl: e.thumbnailUrl,
    videoUrl: e.videoUrl,
    popularityScore: parseFloat(e.popularityScore?.toString() || '0')
  }));

  // Build pagination response
  const pagination: ExerciseListResponse['pagination'] = {
    nextCursor,
    hasMore
  };

  // Include offset pagination info when using page-based pagination
  if (useOffsetPagination && totalCount !== undefined) {
    pagination.page = page || 1;
    pagination.perPage = limit;
    pagination.total = totalCount;
    pagination.totalPages = Math.ceil(totalCount / limit);
  }

  return {
    exercises: exerciseItems,
    pagination,
    meta: {
      searchApplied: !!query.search,
      filtersApplied: getAppliedFilters(query)
    }
  };
}

export async function getExerciseById(id: string): Promise<ExerciseDetail | null> {
  const result = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);

  if (result.length === 0) return null;

  const e = result[0];
  return {
    id: e.id,
    name: e.name,
    primaryMuscles: (e.primaryMuscles as string[]) || [],
    secondaryMuscles: (e.secondaryMuscles as string[]) || [],
    equipment: e.equipment,
    difficulty: e.difficulty,
    movementPattern: e.movementPattern,
    exerciseType: e.exerciseType,
    thumbnailUrl: e.thumbnailUrl,
    popularityScore: parseFloat(e.popularityScore?.toString() || '0'),
    instructions: e.instructions,
    videoUrl: e.videoUrl,
    totalTimesUsed: e.totalTimesUsed || 0,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString()
  };
}

export async function getFilterMetadata(): Promise<FilterMetadata> {
  // Get all enum values with counts using parallel queries
  const [
    muscleGroupCounts,
    difficultyCounts,
    equipmentCounts,
    movementPatternCounts,
    exerciseTypeCounts
  ] = await Promise.all([
    getMuscleGroupCounts(),
    getDifficultyCounts(),
    getEquipmentCounts(),
    getMovementPatternCounts(),
    getExerciseTypeCounts()
  ]);

  return {
    muscleGroups: muscleGroupCounts,
    difficulties: difficultyCounts,
    equipment: equipmentCounts,
    movementPatterns: movementPatternCounts,
    exerciseTypes: exerciseTypeCounts
  };
}

// ============ User History Functions ============

export async function recordExerciseUsage(
  userId: string,
  exerciseId: string
): Promise<void> {
  await db
    .insert(userExerciseHistory)
    .values({
      userId,
      exerciseId,
      lastUsedAt: new Date(),
      useCount: 1
    })
    .onConflictDoUpdate({
      target: [userExerciseHistory.userId, userExerciseHistory.exerciseId],
      set: {
        lastUsedAt: new Date(),
        useCount: sql`${userExerciseHistory.useCount} + 1`,
        updatedAt: new Date()
      }
    });
}

// ============ Helper Functions ============

function addFilterConditions(conditions: SQL[], query: ExerciseListQuery): void {
  // Muscle group filter (checks both primary and secondary)
  if (query.muscleGroup) {
    const muscles = Array.isArray(query.muscleGroup)
      ? query.muscleGroup
      : [query.muscleGroup];

    conditions.push(
      or(
        sql`${exercises.primaryMuscles} ?| array[${sql.join(
          muscles.map((m) => sql`${m}`),
          sql`, `
        )}]::text[]`,
        sql`${exercises.secondaryMuscles} ?| array[${sql.join(
          muscles.map((m) => sql`${m}`),
          sql`, `
        )}]::text[]`
      )!
    );
  }

  // Difficulty filter
  if (query.difficulty) {
    const difficulties = Array.isArray(query.difficulty)
      ? query.difficulty
      : [query.difficulty];
    conditions.push(inArray(exercises.difficulty, difficulties));
  }

  // Equipment filter
  if (query.equipment) {
    const equipmentList = Array.isArray(query.equipment)
      ? query.equipment
      : [query.equipment];
    conditions.push(inArray(exercises.equipment, equipmentList));
  }

  // Movement pattern filter
  if (query.movementPattern) {
    const patterns = Array.isArray(query.movementPattern)
      ? query.movementPattern
      : [query.movementPattern];
    conditions.push(inArray(exercises.movementPattern, patterns));
  }

  // Exercise type filter
  if (query.exerciseType) {
    const types = Array.isArray(query.exerciseType)
      ? query.exerciseType
      : [query.exerciseType];
    conditions.push(inArray(exercises.exerciseType, types));
  }
}

function buildCursorCondition(
  cursor: CursorData,
  order: 'asc' | 'desc',
  userId?: string
): SQL | null {
  const { id, sortValue, sortField } = cursor;

  switch (sortField) {
    case 'name':
      if (order === 'asc') {
        return sql`(${exercises.name} > ${sortValue} OR (${exercises.name} = ${sortValue} AND ${exercises.id} > ${id}))`;
      } else {
        return sql`(${exercises.name} < ${sortValue} OR (${exercises.name} = ${sortValue} AND ${exercises.id} > ${id}))`;
      }

    case 'popularity':
      if (order === 'asc') {
        return sql`(${exercises.popularityScore} > ${sortValue} OR (${exercises.popularityScore} = ${sortValue} AND ${exercises.id} > ${id}))`;
      } else {
        return sql`(${exercises.popularityScore} < ${sortValue} OR (${exercises.popularityScore} = ${sortValue} AND ${exercises.id} > ${id}))`;
      }

    case 'difficulty':
      const diffOrder = DIFFICULTY_ORDER[sortValue as string] || 0;
      if (order === 'asc') {
        return sql`(
          (CASE ${exercises.difficulty}
            WHEN 'beginner' THEN 1
            WHEN 'intermediate' THEN 2
            WHEN 'advanced' THEN 3
            ELSE 0
          END) > ${diffOrder}
          OR (
            ${exercises.difficulty} = ${sortValue}
            AND ${exercises.id} > ${id}
          )
        )`;
      } else {
        return sql`(
          (CASE ${exercises.difficulty}
            WHEN 'beginner' THEN 1
            WHEN 'intermediate' THEN 2
            WHEN 'advanced' THEN 3
            ELSE 0
          END) < ${diffOrder}
          OR (
            ${exercises.difficulty} = ${sortValue}
            AND ${exercises.id} > ${id}
          )
        )`;
      }

    case 'recently_used':
      if (!userId) return null;
      if (order === 'desc') {
        return sql`(
          COALESCE((
            SELECT last_used_at FROM user_exercise_history
            WHERE user_id = ${userId} AND exercise_id = ${exercises.id}
          ), '1970-01-01'::timestamp) < ${sortValue}::timestamp
          OR (
            COALESCE((
              SELECT last_used_at FROM user_exercise_history
              WHERE user_id = ${userId} AND exercise_id = ${exercises.id}
            ), '1970-01-01'::timestamp) = ${sortValue}::timestamp
            AND ${exercises.id} > ${id}
          )
        )`;
      } else {
        return sql`(
          COALESCE((
            SELECT last_used_at FROM user_exercise_history
            WHERE user_id = ${userId} AND exercise_id = ${exercises.id}
          ), '1970-01-01'::timestamp) > ${sortValue}::timestamp
          OR (
            COALESCE((
              SELECT last_used_at FROM user_exercise_history
              WHERE user_id = ${userId} AND exercise_id = ${exercises.id}
            ), '1970-01-01'::timestamp) = ${sortValue}::timestamp
            AND ${exercises.id} > ${id}
          )
        )`;
      }

    default:
      return sql`${exercises.id} > ${id}`;
  }
}

/**
 * Type alias for Drizzle query builder with orderBy capability.
 * Due to Drizzle's complex generic system, precise typing of query builders
 * that support chained orderBy operations is impractical. This type alias
 * documents the expected interface while allowing TypeScript compilation.
 *
 * Expected interface:
 * - Must have orderBy(...columns: SQL[]) method that returns the same type
 * - Typically a PgSelectBase or similar Drizzle select query builder
 *
 * @see https://orm.drizzle.team/docs/select#orderby
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleQueryBuilderWithOrderBy = any;

/**
 * Apply sorting to a Drizzle query builder.
 *
 * This function modifies a Drizzle select query by applying the appropriate
 * ORDER BY clause based on the sort option and direction.
 *
 * @param queryBuilder - A Drizzle query builder (select statement)
 * @param sort - The field to sort by
 * @param order - Sort direction ('asc' or 'desc')
 * @param userId - Optional user ID required for 'recently_used' sort
 * @returns The query builder with ORDER BY applied
 *
 * Note: Uses 'any' type due to Drizzle's complex query builder generics.
 * The function is tested via integration tests that verify correct SQL generation.
 */
function applySorting(
  queryBuilder: DrizzleQueryBuilderWithOrderBy,
  sort: ExerciseSortOption,
  order: 'asc' | 'desc',
  userId?: string
): DrizzleQueryBuilderWithOrderBy {
  switch (sort) {
    case 'name':
      return order === 'asc'
        ? queryBuilder.orderBy(asc(exercises.name), asc(exercises.id))
        : queryBuilder.orderBy(desc(exercises.name), asc(exercises.id));

    case 'popularity':
      return order === 'asc'
        ? queryBuilder.orderBy(asc(exercises.popularityScore), asc(exercises.id))
        : queryBuilder.orderBy(desc(exercises.popularityScore), asc(exercises.id));

    case 'difficulty':
      const difficultyOrder = sql`CASE ${exercises.difficulty}
        WHEN 'beginner' THEN 1
        WHEN 'intermediate' THEN 2
        WHEN 'advanced' THEN 3
        ELSE 0
      END`;
      return order === 'asc'
        ? queryBuilder.orderBy(asc(difficultyOrder), asc(exercises.id))
        : queryBuilder.orderBy(desc(difficultyOrder), asc(exercises.id));

    case 'recently_used':
      if (!userId) {
        // Fallback to name sorting if no user
        return queryBuilder.orderBy(asc(exercises.name), asc(exercises.id));
      }
      const recentlyUsedOrder = sql`COALESCE((
        SELECT last_used_at FROM user_exercise_history
        WHERE user_id = ${userId} AND exercise_id = ${exercises.id}
      ), '1970-01-01'::timestamp)`;
      return order === 'asc'
        ? queryBuilder.orderBy(asc(recentlyUsedOrder), asc(exercises.id))
        : queryBuilder.orderBy(desc(recentlyUsedOrder), asc(exercises.id));

    default:
      return queryBuilder.orderBy(asc(exercises.name), asc(exercises.id));
  }
}

// Type for exercise data used in sorting
interface ExerciseSortData {
  id: string;
  name: string;
  popularityScore: string | null;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
}

/**
 * Pre-fetch user exercise history for multiple exercises in a single query.
 * This avoids N+1 queries when building cursors for recently_used sort.
 */
async function prefetchUserExerciseHistory(
  userId: string,
  exerciseIds: string[]
): Promise<Map<string, Date>> {
  if (exerciseIds.length === 0) {
    return new Map();
  }

  const historyRecords = await db
    .select({
      exerciseId: userExerciseHistory.exerciseId,
      lastUsedAt: userExerciseHistory.lastUsedAt
    })
    .from(userExerciseHistory)
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        inArray(userExerciseHistory.exerciseId, exerciseIds)
      )
    );

  const map = new Map<string, Date>();
  for (const record of historyRecords) {
    map.set(record.exerciseId, record.lastUsedAt);
  }
  return map;
}

/**
 * Get the sort value for an exercise synchronously using pre-fetched data.
 * For recently_used sort, uses the provided historyMap instead of querying.
 */
function getSortValue(
  exercise: ExerciseSortData,
  sort: ExerciseSortOption,
  historyMap?: Map<string, Date>
): string | number | null {
  switch (sort) {
    case 'name':
      return exercise.name;
    case 'popularity':
      return exercise.popularityScore?.toString() || '0';
    case 'difficulty':
      return exercise.difficulty;
    case 'recently_used':
      // Use pre-fetched history data
      if (!historyMap) return '1970-01-01T00:00:00.000Z';
      const lastUsedAt = historyMap.get(exercise.id);
      return lastUsedAt
        ? lastUsedAt.toISOString()
        : '1970-01-01T00:00:00.000Z';
    default:
      return exercise.name;
  }
}

function getAppliedFilters(query: ExerciseListQuery): string[] {
  const filters: string[] = [];
  if (query.muscleGroup) filters.push('muscleGroup');
  if (query.difficulty) filters.push('difficulty');
  if (query.equipment) filters.push('equipment');
  if (query.movementPattern) filters.push('movementPattern');
  if (query.exerciseType) filters.push('exerciseType');
  return filters;
}

// ============ Filter Count Functions ============

async function getMuscleGroupCounts(): Promise<FilterOption[]> {
  const enumValues = muscleGroupEnum.enumValues;

  // Count exercises for each muscle (in primary or secondary)
  const counts = await db.execute(sql`
    SELECT
      muscle,
      COUNT(DISTINCT e.id) as count
    FROM unnest(ARRAY[${sql.join(
      enumValues.map((v) => sql`${v}`),
      sql`, `
    )}]::text[]) as muscle
    LEFT JOIN exercises e ON (
      e.is_custom = false
      AND (e.primary_muscles ? muscle OR e.secondary_muscles ? muscle)
    )
    GROUP BY muscle
    ORDER BY muscle
  `);

  const countMap = new Map<string, number>();
  // Handle both array result and object with rows property
  const rows = Array.isArray(counts) ? counts : (counts as unknown as { rows: unknown[] }).rows;
  for (const row of rows as { muscle: string; count: string }[]) {
    countMap.set(row.muscle, parseInt(row.count || '0'));
  }

  return enumValues.map((value) => ({
    value,
    label: formatEnumLabel(value),
    count: countMap.get(value) || 0
  }));
}

async function getDifficultyCounts(): Promise<FilterOption[]> {
  const enumValues = difficultyLevelEnum.enumValues;

  const counts = await db
    .select({
      difficulty: exercises.difficulty,
      count: sql<number>`count(*)`
    })
    .from(exercises)
    .where(eq(exercises.isCustom, false))
    .groupBy(exercises.difficulty);

  const countMap = new Map(
    counts.map((c) => [c.difficulty, Number(c.count)])
  );

  return enumValues.map((value) => ({
    value,
    label: formatEnumLabel(value),
    count: countMap.get(value) || 0
  }));
}

async function getEquipmentCounts(): Promise<FilterOption[]> {
  const counts = await db
    .select({
      equipment: exercises.equipment,
      count: sql<number>`count(*)`
    })
    .from(exercises)
    .where(and(eq(exercises.isCustom, false), isNotNull(exercises.equipment)))
    .groupBy(exercises.equipment);

  return counts
    .map((c) => ({
      value: c.equipment!,
      label: formatEnumLabel(c.equipment!),
      count: Number(c.count)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getMovementPatternCounts(): Promise<FilterOption[]> {
  const enumValues = movementPatternEnum.enumValues;

  const counts = await db
    .select({
      movementPattern: exercises.movementPattern,
      count: sql<number>`count(*)`
    })
    .from(exercises)
    .where(eq(exercises.isCustom, false))
    .groupBy(exercises.movementPattern);

  const countMap = new Map(
    counts.map((c) => [c.movementPattern, Number(c.count)])
  );

  return enumValues.map((value) => ({
    value,
    label: formatEnumLabel(value),
    count: countMap.get(value) || 0
  }));
}

async function getExerciseTypeCounts(): Promise<FilterOption[]> {
  const enumValues = exerciseTypeEnum.enumValues;

  const counts = await db
    .select({
      exerciseType: exercises.exerciseType,
      count: sql<number>`count(*)`
    })
    .from(exercises)
    .where(eq(exercises.isCustom, false))
    .groupBy(exercises.exerciseType);

  const countMap = new Map(
    counts.map((c) => [c.exerciseType, Number(c.count)])
  );

  return enumValues.map((value) => ({
    value,
    label: formatEnumLabel(value),
    count: countMap.get(value) || 0
  }));
}

function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
