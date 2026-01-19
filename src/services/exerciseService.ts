import { db } from '../db';
import {
  exercises,
  exerciseAliases,
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
const SIMILARITY_THRESHOLD = 0.3;

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
    return JSON.parse(decoded) as CursorData;
  } catch {
    return null;
  }
}

// ============ Main Service Functions ============

export async function getExercises(
  query: ExerciseListQuery,
  userId?: string
): Promise<ExerciseListResponse> {
  const limit = Math.min(query.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const sort = query.sort || 'name';
  const order = query.order || 'asc';

  // Validate recently_used sort requires authentication
  if (sort === 'recently_used' && !userId) {
    throw new Error('Authentication required for "recently_used" sort');
  }

  // Build conditions array
  const conditions: SQL[] = [eq(exercises.isCustom, false)];

  // Add filter conditions
  addFilterConditions(conditions, query);

  // Handle search
  if (query.search && query.search.trim()) {
    const searchTerm = query.search.trim();
    conditions.push(sql`(
      similarity(${exercises.name}, ${searchTerm}) > ${SIMILARITY_THRESHOLD}
      OR EXISTS (
        SELECT 1 FROM exercise_aliases ea
        WHERE ea.exercise_id = ${exercises.id}
        AND similarity(ea.alias, ${searchTerm}) > ${SIMILARITY_THRESHOLD}
      )
    )`);
  }

  // Handle cursor pagination
  if (query.cursor) {
    const cursorData = decodeCursor(query.cursor);
    if (cursorData) {
      const cursorCondition = buildCursorCondition(cursorData, order, userId);
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }
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
      popularityScore: exercises.popularityScore
    })
    .from(exercises)
    .where(and(...conditions))
    .limit(limit + 1); // Fetch one extra to determine hasMore

  // Apply sorting
  const sortedQuery = applySorting(baseQuery, sort, order, userId);

  const results: typeof baseQuery extends Promise<infer T> ? T : never = await sortedQuery;

  // Determine if there are more results
  const hasMore = results.length > limit;
  const exerciseList: {
    id: string;
    name: string;
    primaryMuscles: string[] | null;
    secondaryMuscles: string[] | null;
    equipment: string | null;
    difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
    movementPattern: 'push' | 'pull' | 'hinge' | 'squat' | 'lunge' | 'carry' | 'rotation' | 'core' | null;
    exerciseType: 'compound' | 'isolation' | 'cardio' | 'plyometric' | 'stretch' | null;
    thumbnailUrl: string | null;
    popularityScore: string | null;
  }[] = hasMore ? results.slice(0, limit) : results;

  // Build next cursor
  let nextCursor: string | null = null;
  if (hasMore && exerciseList.length > 0) {
    const lastExercise = exerciseList[exerciseList.length - 1];
    const sortValue = await getSortValueAsync(lastExercise, sort, userId);
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
    popularityScore: parseFloat(e.popularityScore?.toString() || '0')
  }));

  return {
    exercises: exerciseItems,
    pagination: {
      nextCursor,
      hasMore
    },
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

function applySorting(
  queryBuilder: any,
  sort: ExerciseSortOption,
  order: 'asc' | 'desc',
  userId?: string
): any {
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

async function getSortValueAsync(
  exercise: { id: string; name: string; popularityScore: any; difficulty: any },
  sort: ExerciseSortOption,
  userId?: string
): Promise<string | number | null> {
  switch (sort) {
    case 'name':
      return exercise.name;
    case 'popularity':
      return exercise.popularityScore?.toString() || '0';
    case 'difficulty':
      return exercise.difficulty;
    case 'recently_used':
      // Fetch the actual lastUsedAt from user_exercise_history
      if (!userId) return null;
      const history = await db
        .select({ lastUsedAt: userExerciseHistory.lastUsedAt })
        .from(userExerciseHistory)
        .where(
          and(
            eq(userExerciseHistory.userId, userId),
            eq(userExerciseHistory.exerciseId, exercise.id)
          )
        )
        .limit(1);
      return history.length > 0
        ? history[0].lastUsedAt.toISOString()
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
