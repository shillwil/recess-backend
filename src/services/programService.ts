import { db } from '../db';
import {
  workoutPrograms,
  programWeeks,
  workoutTemplates,
  templateExercises,
} from '../db/schema';
import {
  eq,
  and,
  sql,
  desc,
  asc,
  inArray,
  SQL,
  ne
} from 'drizzle-orm';
import {
  ProgramListQuery,
  ProgramListItem,
  ProgramDetail,
  ProgramWorkoutDetail,
  ProgramListResponse,
  ProgramCursorData,
  ProgramSortOption,
  CreateProgramInput,
  UpdateProgramInput,
  ProgramWorkoutInput,
  ActiveProgramResponse,
} from '../models/program.types';

// ============ Constants ============

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 500;

// ============ Cursor Utilities ============

export function encodeCursor(data: ProgramCursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: string): ProgramCursorData | null {
  try {
    if (cursor.length > MAX_CURSOR_LENGTH) {
      return null;
    }

    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);

    if (!isValidCursorData(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isValidCursorData(data: unknown): data is ProgramCursorData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const cursor = data as Record<string, unknown>;

  if (typeof cursor.id !== 'string' || cursor.id.length === 0) {
    return false;
  }

  if (cursor.sortValue !== null &&
      typeof cursor.sortValue !== 'string' &&
      typeof cursor.sortValue !== 'number') {
    return false;
  }

  const validSortFields: ProgramSortOption[] = ['name', 'createdAt', 'updatedAt'];
  if (typeof cursor.sortField !== 'string' || !validSortFields.includes(cursor.sortField as ProgramSortOption)) {
    return false;
  }

  return true;
}

// ============ Helper Functions ============

/**
 * Verifies that a program belongs to the specified user
 */
export async function verifyProgramOwnership(
  programId: string,
  userId: string
): Promise<typeof workoutPrograms.$inferSelect | null> {
  const result = await db
    .select()
    .from(workoutPrograms)
    .where(and(
      eq(workoutPrograms.id, programId),
      eq(workoutPrograms.userId, userId)
    ))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Validates that all template IDs exist and belong to the user
 * Returns array of missing/unauthorized template IDs
 */
async function validateTemplateIds(templateIds: string[], userId: string): Promise<string[]> {
  const uniqueIds = [...new Set(templateIds)];

  // Early return for empty array - nothing to validate
  if (uniqueIds.length === 0) {
    return [];
  }

  const existingTemplates = await db
    .select({ id: workoutTemplates.id })
    .from(workoutTemplates)
    .where(and(
      inArray(workoutTemplates.id, uniqueIds),
      eq(workoutTemplates.userId, userId)
    ));

  const existingIds = new Set(existingTemplates.map(t => t.id));
  const missingIds = uniqueIds.filter(id => !existingIds.has(id));

  return missingIds;
}

/**
 * Check if a template is used in any program
 */
export async function isTemplateUsedInPrograms(templateId: string): Promise<boolean> {
  const result = await db
    .select({ id: programWeeks.id })
    .from(programWeeks)
    .where(eq(programWeeks.templateId, templateId))
    .limit(1);

  return result.length > 0;
}

// ============ Main Service Functions ============

/**
 * Get paginated list of programs for a user
 */
export async function getPrograms(
  userId: string,
  query: ProgramListQuery
): Promise<ProgramListResponse> {
  const limit = Math.min(query.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const sort = query.sort || 'createdAt';
  const order = query.order || 'desc';

  const conditions: SQL[] = [eq(workoutPrograms.userId, userId)];

  if (query.cursor) {
    const cursorData = decodeCursor(query.cursor);
    if (cursorData && cursorData.sortField === sort) {
      const cursorCondition = buildCursorCondition(cursorData, order);
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }
  }

  const orderByColumns = getOrderByColumns(sort, order);

  const results = await db
    .select({
      id: workoutPrograms.id,
      name: workoutPrograms.name,
      description: workoutPrograms.description,
      daysPerWeek: workoutPrograms.daysPerWeek,
      durationWeeks: workoutPrograms.durationWeeks,
      isActive: workoutPrograms.isActive,
      currentDayIndex: workoutPrograms.currentDayIndex,
      timesCompleted: workoutPrograms.timesCompleted,
      createdAt: workoutPrograms.createdAt,
      updatedAt: workoutPrograms.updatedAt,
      workoutCount: sql<number>`(
        SELECT COUNT(*)::int FROM program_weeks
        WHERE program_id = ${workoutPrograms.id}
      )`.as('workout_count')
    })
    .from(workoutPrograms)
    .where(and(...conditions))
    .orderBy(...orderByColumns)
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const programList = hasMore ? results.slice(0, limit) : results;

  let nextCursor: string | null = null;
  if (hasMore && programList.length > 0) {
    const lastProgram = programList[programList.length - 1];
    const sortValue = getSortValue(lastProgram, sort);
    nextCursor = encodeCursor({
      id: lastProgram.id,
      sortValue,
      sortField: sort
    });
  }

  const programs: ProgramListItem[] = programList.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    daysPerWeek: p.daysPerWeek,
    durationWeeks: p.durationWeeks,
    isActive: p.isActive,
    currentDayIndex: p.currentDayIndex,
    timesCompleted: p.timesCompleted,
    workoutCount: p.workoutCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  }));

  return {
    programs,
    pagination: {
      nextCursor,
      hasMore
    }
  };
}

/**
 * Get a single program with all workouts
 */
export async function getProgramById(
  programId: string,
  userId: string
): Promise<ProgramDetail | null> {
  const program = await verifyProgramOwnership(programId, userId);
  if (!program) {
    return null;
  }

  // Get program workouts with template details
  const workoutResults = await db
    .select({
      id: programWeeks.id,
      dayNumber: programWeeks.dayNumber,
      dayLabel: programWeeks.dayLabel,
      templateId: programWeeks.templateId,
      template: {
        id: workoutTemplates.id,
        name: workoutTemplates.name,
        description: workoutTemplates.description,
      }
    })
    .from(programWeeks)
    .innerJoin(workoutTemplates, eq(programWeeks.templateId, workoutTemplates.id))
    .where(eq(programWeeks.programId, programId))
    .orderBy(asc(programWeeks.dayNumber));

  // Get exercise counts for each template
  const templateIds = workoutResults.map(w => w.templateId);
  const exerciseCounts = templateIds.length > 0
    ? await db
        .select({
          templateId: templateExercises.templateId,
          count: sql<number>`COUNT(*)::int`.as('count')
        })
        .from(templateExercises)
        .where(inArray(templateExercises.templateId, templateIds))
        .groupBy(templateExercises.templateId)
    : [];

  const exerciseCountMap = new Map(exerciseCounts.map(e => [e.templateId, e.count]));

  const workouts: ProgramWorkoutDetail[] = workoutResults.map((w) => ({
    id: w.id,
    dayNumber: w.dayNumber,
    dayLabel: w.dayLabel,
    templateId: w.templateId,
    template: {
      id: w.template.id,
      name: w.template.name,
      description: w.template.description,
      exerciseCount: exerciseCountMap.get(w.templateId) || 0
    }
  }));

  return {
    id: program.id,
    name: program.name,
    description: program.description,
    daysPerWeek: program.daysPerWeek,
    durationWeeks: program.durationWeeks,
    isActive: program.isActive,
    currentDayIndex: program.currentDayIndex,
    timesCompleted: program.timesCompleted,
    isPublic: program.isPublic ?? false,
    isAiGenerated: program.isAiGenerated ?? false,
    workouts,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString()
  };
}

/**
 * Get active program with next workout info
 */
export async function getActiveProgram(userId: string): Promise<ActiveProgramResponse | null> {
  // Find the active program
  const activePrograms = await db
    .select()
    .from(workoutPrograms)
    .where(and(
      eq(workoutPrograms.userId, userId),
      eq(workoutPrograms.isActive, true)
    ))
    .limit(1);

  if (activePrograms.length === 0) {
    return null;
  }

  const program = activePrograms[0];
  const programDetail = await getProgramById(program.id, userId);

  if (!programDetail) {
    return null;
  }

  // Check if program is completed (for finite programs)
  const isCompleted = program.durationWeeks !== null &&
                      program.timesCompleted >= program.durationWeeks;

  // Find next workout based on currentDayIndex
  const nextWorkoutData = programDetail.workouts.find(
    w => w.dayNumber === program.currentDayIndex
  );

  const nextWorkout = nextWorkoutData ? {
    dayNumber: nextWorkoutData.dayNumber,
    dayLabel: nextWorkoutData.dayLabel,
    template: nextWorkoutData.template
  } : null;

  return {
    program: programDetail,
    nextWorkout,
    isCompleted
  };
}

/**
 * Create a new program with workouts
 */
export async function createProgram(
  userId: string,
  input: CreateProgramInput
): Promise<ProgramDetail> {
  // Validate template IDs exist and belong to user
  const templateIds = input.workouts.map(w => w.templateId);
  const missingIds = await validateTemplateIds(templateIds, userId);
  if (missingIds.length > 0) {
    throw new Error(`Templates not found or not owned by user: ${missingIds.join(', ')}`);
  }

  // Use transaction to insert program and workouts atomically
  const result = await db.transaction(async (tx) => {
    const [program] = await tx
      .insert(workoutPrograms)
      .values({
        userId,
        name: input.name,
        description: input.description || null,
        daysPerWeek: input.daysPerWeek,
        durationWeeks: input.durationWeeks ?? null,
      })
      .returning();

    // Insert program workouts
    if (input.workouts.length > 0) {
      await tx.insert(programWeeks).values(
        input.workouts.map((w) => ({
          programId: program.id,
          weekNumber: 1, // Always 1 for single-week programs
          dayNumber: w.dayNumber,
          templateId: w.templateId,
          dayLabel: w.dayLabel || null,
        }))
      );
    }

    return program;
  });

  const created = await getProgramById(result.id, userId);
  if (!created) {
    throw new Error('Failed to fetch created program');
  }

  return created;
}

/**
 * Update program metadata
 */
export async function updateProgram(
  programId: string,
  userId: string,
  updates: UpdateProgramInput
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  // If reducing daysPerWeek, check for orphaned workouts
  if (updates.daysPerWeek !== undefined && updates.daysPerWeek < existing.daysPerWeek) {
    const orphanedWorkouts = await db
      .select({ id: programWeeks.id, dayNumber: programWeeks.dayNumber })
      .from(programWeeks)
      .where(and(
        eq(programWeeks.programId, programId),
        sql`${programWeeks.dayNumber} >= ${updates.daysPerWeek}`
      ))
      .limit(1);

    if (orphanedWorkouts.length > 0) {
      throw new Error(
        `Cannot reduce daysPerWeek to ${updates.daysPerWeek}: workouts exist with dayNumber >= ${updates.daysPerWeek}. ` +
        `Remove or reassign those workouts first.`
      );
    }
  }

  const updateData: Partial<typeof workoutPrograms.$inferInsert> = {
    updatedAt: new Date()
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name;
  }
  if (updates.description !== undefined) {
    updateData.description = updates.description || null;
  }
  if (updates.daysPerWeek !== undefined) {
    updateData.daysPerWeek = updates.daysPerWeek;
    // Reset currentDayIndex if it would become invalid
    if (existing.currentDayIndex >= updates.daysPerWeek) {
      updateData.currentDayIndex = 0;
    }
  }
  if (updates.durationWeeks !== undefined) {
    updateData.durationWeeks = updates.durationWeeks;
  }

  await db
    .update(workoutPrograms)
    .set(updateData)
    .where(eq(workoutPrograms.id, programId));

  return getProgramById(programId, userId);
}

/**
 * Delete a program (workouts cascade automatically, templates preserved)
 */
export async function deleteProgram(
  programId: string,
  userId: string
): Promise<boolean> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return false;
  }

  await db
    .delete(workoutPrograms)
    .where(eq(workoutPrograms.id, programId));

  return true;
}

/**
 * Bulk replace program workouts
 */
export async function updateProgramWorkouts(
  programId: string,
  userId: string,
  workoutsInput: ProgramWorkoutInput[]
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  // Validate template IDs
  const templateIds = workoutsInput.map(w => w.templateId);
  const missingIds = await validateTemplateIds(templateIds, userId);
  if (missingIds.length > 0) {
    throw new Error(`Templates not found or not owned by user: ${missingIds.join(', ')}`);
  }

  await db.transaction(async (tx) => {
    // Delete existing workouts
    await tx
      .delete(programWeeks)
      .where(eq(programWeeks.programId, programId));

    // Insert new workouts
    if (workoutsInput.length > 0) {
      await tx.insert(programWeeks).values(
        workoutsInput.map((w) => ({
          programId,
          weekNumber: 1,
          dayNumber: w.dayNumber,
          templateId: w.templateId,
          dayLabel: w.dayLabel || null,
        }))
      );
    }

    // Update program's updatedAt
    await tx
      .update(workoutPrograms)
      .set({ updatedAt: new Date() })
      .where(eq(workoutPrograms.id, programId));
  });

  return getProgramById(programId, userId);
}

/**
 * Activate a program (deactivates all others for the user)
 *
 * Note: Uses application-level enforcement via transaction rather than a database
 * constraint. Concurrent requests could theoretically both succeed, but this is
 * acceptable for this use case since:
 * 1. Users rarely activate programs simultaneously
 * 2. The worst case is two active programs briefly, resolved on next activation
 * 3. A partial unique index would add complexity without meaningful benefit
 */
export async function activateProgram(
  programId: string,
  userId: string
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  await db.transaction(async (tx) => {
    // Deactivate all other programs for this user
    await tx
      .update(workoutPrograms)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(workoutPrograms.userId, userId),
        eq(workoutPrograms.isActive, true),
        ne(workoutPrograms.id, programId)
      ));

    // Activate the requested program
    await tx
      .update(workoutPrograms)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(workoutPrograms.id, programId));
  });

  return getProgramById(programId, userId);
}

/**
 * Deactivate a program
 */
export async function deactivateProgram(
  programId: string,
  userId: string
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  await db
    .update(workoutPrograms)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(workoutPrograms.id, programId));

  return getProgramById(programId, userId);
}

/**
 * Advance to next day in the program rotation
 */
export async function advanceDay(
  programId: string,
  userId: string
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  const nextDayIndex = (existing.currentDayIndex + 1) % existing.daysPerWeek;
  const cycleCompleted = nextDayIndex === 0;

  const updateData: Partial<typeof workoutPrograms.$inferInsert> = {
    currentDayIndex: nextDayIndex,
    updatedAt: new Date()
  };

  if (cycleCompleted) {
    updateData.timesCompleted = existing.timesCompleted + 1;
  }

  await db
    .update(workoutPrograms)
    .set(updateData)
    .where(eq(workoutPrograms.id, programId));

  return getProgramById(programId, userId);
}

/**
 * Reset program progress to day 0
 */
export async function resetProgress(
  programId: string,
  userId: string
): Promise<ProgramDetail | null> {
  const existing = await verifyProgramOwnership(programId, userId);
  if (!existing) {
    return null;
  }

  await db
    .update(workoutPrograms)
    .set({
      currentDayIndex: 0,
      timesCompleted: 0,
      updatedAt: new Date()
    })
    .where(eq(workoutPrograms.id, programId));

  return getProgramById(programId, userId);
}

// ============ Sorting Helpers ============

function getOrderByColumns(sort: ProgramSortOption, order: 'asc' | 'desc'): SQL[] {
  const sortFn = order === 'asc' ? asc : desc;
  const idSort = asc(workoutPrograms.id);

  switch (sort) {
    case 'name':
      return [sortFn(workoutPrograms.name), idSort];
    case 'createdAt':
      return [sortFn(workoutPrograms.createdAt), idSort];
    case 'updatedAt':
      return [sortFn(workoutPrograms.updatedAt), idSort];
    default:
      return [desc(workoutPrograms.createdAt), idSort];
  }
}

function buildCursorCondition(
  cursor: ProgramCursorData,
  order: 'asc' | 'desc'
): SQL | null {
  const { id, sortValue, sortField } = cursor;

  switch (sortField) {
    case 'name':
      if (order === 'asc') {
        return sql`(${workoutPrograms.name} > ${sortValue} OR (${workoutPrograms.name} = ${sortValue} AND ${workoutPrograms.id} > ${id}))`;
      } else {
        return sql`(${workoutPrograms.name} < ${sortValue} OR (${workoutPrograms.name} = ${sortValue} AND ${workoutPrograms.id} > ${id}))`;
      }

    case 'createdAt':
      if (order === 'asc') {
        return sql`(${workoutPrograms.createdAt} > ${sortValue}::timestamp OR (${workoutPrograms.createdAt} = ${sortValue}::timestamp AND ${workoutPrograms.id} > ${id}))`;
      } else {
        return sql`(${workoutPrograms.createdAt} < ${sortValue}::timestamp OR (${workoutPrograms.createdAt} = ${sortValue}::timestamp AND ${workoutPrograms.id} > ${id}))`;
      }

    case 'updatedAt':
      if (order === 'asc') {
        return sql`(${workoutPrograms.updatedAt} > ${sortValue}::timestamp OR (${workoutPrograms.updatedAt} = ${sortValue}::timestamp AND ${workoutPrograms.id} > ${id}))`;
      } else {
        return sql`(${workoutPrograms.updatedAt} < ${sortValue}::timestamp OR (${workoutPrograms.updatedAt} = ${sortValue}::timestamp AND ${workoutPrograms.id} > ${id}))`;
      }

    default:
      return sql`${workoutPrograms.id} > ${id}`;
  }
}

interface ProgramSortData {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function getSortValue(
  program: ProgramSortData,
  sort: ProgramSortOption
): string | number | null {
  switch (sort) {
    case 'name':
      return program.name;
    case 'createdAt':
      return program.createdAt.toISOString();
    case 'updatedAt':
      return program.updatedAt.toISOString();
    default:
      return program.createdAt.toISOString();
  }
}
