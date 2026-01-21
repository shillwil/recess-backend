import { db } from '../db';
import {
  workoutTemplates,
  templateExercises,
  exercises,
} from '../db/schema';
import {
  eq,
  and,
  sql,
  desc,
  asc,
  inArray,
  SQL
} from 'drizzle-orm';
import {
  TemplateListQuery,
  TemplateListItem,
  TemplateDetail,
  TemplateExerciseDetail,
  TemplateListResponse,
  TemplateCursorData,
  TemplateSortOption,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateExerciseInput,
} from '../models/template.types';

import { TEMPLATE_LIMITS } from '../utils/validation';

// ============ Constants ============

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 500; // Prevent DoS via extremely long cursor strings

// ============ Internal Types ============

/**
 * Row type returned from template list query
 */
interface TemplateListRow {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  exerciseCount: number;
}

// ============ Cursor Utilities ============

export function encodeCursor(data: TemplateCursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: string): TemplateCursorData | null {
  try {
    // Prevent DoS via extremely long cursor strings
    if (cursor.length > MAX_CURSOR_LENGTH) {
      return null;
    }

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
function isValidCursorData(data: unknown): data is TemplateCursorData {
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
  const validSortFields: TemplateSortOption[] = ['name', 'createdAt', 'updatedAt'];
  if (typeof cursor.sortField !== 'string' || !validSortFields.includes(cursor.sortField as TemplateSortOption)) {
    return false;
  }

  return true;
}

// ============ Helper Functions ============

/**
 * Verifies that a template belongs to the specified user
 * Returns the template if found and owned by user, null otherwise
 */
export async function verifyTemplateOwnership(
  templateId: string,
  userId: string
): Promise<typeof workoutTemplates.$inferSelect | null> {
  const result = await db
    .select()
    .from(workoutTemplates)
    .where(and(
      eq(workoutTemplates.id, templateId),
      eq(workoutTemplates.userId, userId)
    ))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Validates that all exercise IDs exist in the exercises table
 */
async function validateExerciseIds(exerciseIds: string[]): Promise<string[]> {
  const uniqueIds = [...new Set(exerciseIds)];

  const existingExercises = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(inArray(exercises.id, uniqueIds));

  const existingIds = new Set(existingExercises.map(e => e.id));
  const missingIds = uniqueIds.filter(id => !existingIds.has(id));

  return missingIds;
}

// ============ Main Service Functions ============

/**
 * Get paginated list of templates for a user
 */
export async function getTemplates(
  userId: string,
  query: TemplateListQuery
): Promise<TemplateListResponse> {
  const limit = Math.min(query.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const sort = query.sort || 'createdAt';
  const order = query.order || 'desc';

  // Build conditions array
  const conditions: SQL[] = [eq(workoutTemplates.userId, userId)];

  // Handle cursor pagination
  // Note: Cursor is only valid if sortField matches the requested sort
  if (query.cursor) {
    const cursorData = decodeCursor(query.cursor);
    if (cursorData && cursorData.sortField === sort) {
      const cursorCondition = buildCursorCondition(cursorData, order);
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }
    // If sortField doesn't match, cursor is ignored (pagination restarts)
  }

  // Build the query with exercise count subquery and apply sorting
  const orderByColumns = getOrderByColumns(sort, order);

  const results = await db
    .select({
      id: workoutTemplates.id,
      name: workoutTemplates.name,
      description: workoutTemplates.description,
      isPublic: workoutTemplates.isPublic,
      createdAt: workoutTemplates.createdAt,
      updatedAt: workoutTemplates.updatedAt,
      exerciseCount: sql<number>`(
        SELECT COUNT(*)::int FROM template_exercises
        WHERE template_id = ${workoutTemplates.id}
      )`.as('exercise_count')
    })
    .from(workoutTemplates)
    .where(and(...conditions))
    .orderBy(...orderByColumns)
    .limit(limit + 1); // Fetch one extra to determine hasMore

  // Determine if there are more results
  const hasMore = results.length > limit;
  const templateList = hasMore ? results.slice(0, limit) : results;

  // Build next cursor
  let nextCursor: string | null = null;
  if (hasMore && templateList.length > 0) {
    const lastTemplate = templateList[templateList.length - 1];
    const sortValue = getSortValue(lastTemplate, sort);
    nextCursor = encodeCursor({
      id: lastTemplate.id,
      sortValue,
      sortField: sort
    });
  }

  // Transform to response format
  const templates: TemplateListItem[] = templateList.map((t: TemplateListRow) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    exerciseCount: t.exerciseCount,
    isPublic: t.isPublic ?? false,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString()
  }));

  return {
    templates,
    pagination: {
      nextCursor,
      hasMore
    }
  };
}

/**
 * Get a single template with all exercises
 */
export async function getTemplateById(
  templateId: string,
  userId: string
): Promise<TemplateDetail | null> {
  // Get the template
  const template = await verifyTemplateOwnership(templateId, userId);
  if (!template) {
    return null;
  }

  // Get exercises with exercise details
  const templateExerciseResults = await db
    .select({
      id: templateExercises.id,
      exerciseId: templateExercises.exerciseId,
      orderIndex: templateExercises.orderIndex,
      warmupSets: templateExercises.warmupSets,
      workingSets: templateExercises.workingSets,
      targetReps: templateExercises.targetReps,
      restSeconds: templateExercises.restSeconds,
      notes: templateExercises.notes,
      exercise: {
        id: exercises.id,
        name: exercises.name,
        primaryMuscles: exercises.primaryMuscles,
        equipment: exercises.equipment,
        thumbnailUrl: exercises.thumbnailUrl
      }
    })
    .from(templateExercises)
    .innerJoin(exercises, eq(templateExercises.exerciseId, exercises.id))
    .where(eq(templateExercises.templateId, templateId))
    .orderBy(asc(templateExercises.orderIndex));

  // Transform to response format
  const exerciseDetails: TemplateExerciseDetail[] = templateExerciseResults.map((te) => ({
    id: te.id,
    exerciseId: te.exerciseId,
    orderIndex: te.orderIndex,
    warmupSets: te.warmupSets ?? 0,
    workingSets: te.workingSets,
    targetReps: te.targetReps,
    restSeconds: te.restSeconds,
    notes: te.notes,
    exercise: {
      id: te.exercise.id,
      name: te.exercise.name,
      primaryMuscles: (te.exercise.primaryMuscles as string[]) || [],
      equipment: te.exercise.equipment,
      thumbnailUrl: te.exercise.thumbnailUrl
    }
  }));

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    isPublic: template.isPublic ?? false,
    isAiGenerated: template.isAiGenerated ?? false,
    exercises: exerciseDetails,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

/**
 * Create a new template with exercises
 */
export async function createTemplate(
  userId: string,
  input: CreateTemplateInput
): Promise<TemplateDetail> {
  // Validate exercise IDs exist
  const exerciseIds = input.exercises.map(e => e.exerciseId);
  const missingIds = await validateExerciseIds(exerciseIds);
  if (missingIds.length > 0) {
    throw new Error(`Exercises not found: ${missingIds.join(', ')}`);
  }

  // Use transaction to insert template and exercises atomically
  const result = await db.transaction(async (tx) => {
    // Insert the template
    const [template] = await tx
      .insert(workoutTemplates)
      .values({
        userId,
        name: input.name,
        description: input.description || null,
      })
      .returning();

    // Insert template exercises
    if (input.exercises.length > 0) {
      await tx.insert(templateExercises).values(
        input.exercises.map((e, index) => ({
          templateId: template.id,
          exerciseId: e.exerciseId,
          orderIndex: e.orderIndex ?? index,
          workingSets: e.workingSets,
          warmupSets: e.warmupSets ?? 0,
          targetReps: e.targetReps || null,
          restSeconds: e.restSeconds || null,
          notes: e.notes || null,
        }))
      );
    }

    return template;
  });

  // Fetch and return the complete template
  const created = await getTemplateById(result.id, userId);
  if (!created) {
    throw new Error('Failed to fetch created template');
  }

  return created;
}

/**
 * Update template metadata (name, description)
 */
export async function updateTemplate(
  templateId: string,
  userId: string,
  updates: UpdateTemplateInput
): Promise<TemplateDetail | null> {
  // Verify ownership
  const existing = await verifyTemplateOwnership(templateId, userId);
  if (!existing) {
    return null;
  }

  // Build update object
  const updateData: Partial<typeof workoutTemplates.$inferInsert> = {
    updatedAt: new Date()
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name;
  }
  if (updates.description !== undefined) {
    updateData.description = updates.description || null;
  }

  // Update the template
  await db
    .update(workoutTemplates)
    .set(updateData)
    .where(eq(workoutTemplates.id, templateId));

  // Return updated template
  return getTemplateById(templateId, userId);
}

/**
 * Delete a template (exercises cascade automatically)
 * Throws error if template is used in any program
 */
export async function deleteTemplate(
  templateId: string,
  userId: string
): Promise<boolean> {
  // Verify ownership
  const existing = await verifyTemplateOwnership(templateId, userId);
  if (!existing) {
    return false;
  }

  // Check if template is used in any programs
  const { isTemplateUsedInPrograms } = await import('./programService');
  const isUsed = await isTemplateUsedInPrograms(templateId);
  if (isUsed) {
    throw new Error('Cannot delete template: it is used in one or more programs');
  }

  // Delete the template (cascade will delete exercises)
  await db
    .delete(workoutTemplates)
    .where(eq(workoutTemplates.id, templateId));

  return true;
}

/**
 * Clone a template (creates a copy with all exercises)
 */
export async function cloneTemplate(
  templateId: string,
  userId: string,
  newName?: string
): Promise<TemplateDetail | null> {
  // Verify ownership and get source template metadata (lightweight query)
  const sourceTemplate = await verifyTemplateOwnership(templateId, userId);
  if (!sourceTemplate) {
    return null;
  }

  // Get source exercises (only fields needed for cloning)
  const sourceExercises = await db
    .select({
      exerciseId: templateExercises.exerciseId,
      orderIndex: templateExercises.orderIndex,
      workingSets: templateExercises.workingSets,
      warmupSets: templateExercises.warmupSets,
      targetReps: templateExercises.targetReps,
      restSeconds: templateExercises.restSeconds,
      notes: templateExercises.notes,
    })
    .from(templateExercises)
    .where(eq(templateExercises.templateId, templateId))
    .orderBy(asc(templateExercises.orderIndex));

  // Generate clone name with length validation
  let cloneName: string;
  if (newName) {
    cloneName = newName;
  } else {
    const copySuffix = ' (Copy)';
    const maxBaseLength = TEMPLATE_LIMITS.MAX_NAME_LENGTH - copySuffix.length;
    const baseName = sourceTemplate.name.length > maxBaseLength
      ? sourceTemplate.name.substring(0, maxBaseLength)
      : sourceTemplate.name;
    cloneName = `${baseName}${copySuffix}`;
  }

  // Create the clone
  const result = await db.transaction(async (tx) => {
    // Insert the new template
    const [template] = await tx
      .insert(workoutTemplates)
      .values({
        userId,
        name: cloneName,
        description: sourceTemplate.description,
      })
      .returning();

    // Clone exercises
    if (sourceExercises.length > 0) {
      await tx.insert(templateExercises).values(
        sourceExercises.map((e) => ({
          templateId: template.id,
          exerciseId: e.exerciseId,
          orderIndex: e.orderIndex,
          workingSets: e.workingSets,
          warmupSets: e.warmupSets ?? 0,
          targetReps: e.targetReps,
          restSeconds: e.restSeconds,
          notes: e.notes,
        }))
      );
    }

    return template;
  });

  // Return the cloned template with full details
  return getTemplateById(result.id, userId);
}

/**
 * Bulk replace template exercises
 */
export async function updateTemplateExercises(
  templateId: string,
  userId: string,
  exercisesInput: TemplateExerciseInput[]
): Promise<TemplateDetail | null> {
  // Verify ownership
  const existing = await verifyTemplateOwnership(templateId, userId);
  if (!existing) {
    return null;
  }

  // Validate exercise IDs exist
  const exerciseIds = exercisesInput.map(e => e.exerciseId);
  const missingIds = await validateExerciseIds(exerciseIds);
  if (missingIds.length > 0) {
    throw new Error(`Exercises not found: ${missingIds.join(', ')}`);
  }

  // Use transaction to delete old and insert new exercises
  await db.transaction(async (tx) => {
    // Delete existing exercises
    await tx
      .delete(templateExercises)
      .where(eq(templateExercises.templateId, templateId));

    // Insert new exercises
    if (exercisesInput.length > 0) {
      await tx.insert(templateExercises).values(
        exercisesInput.map((e, index) => ({
          templateId,
          exerciseId: e.exerciseId,
          orderIndex: e.orderIndex ?? index,
          workingSets: e.workingSets,
          warmupSets: e.warmupSets ?? 0,
          targetReps: e.targetReps || null,
          restSeconds: e.restSeconds || null,
          notes: e.notes || null,
        }))
      );
    }

    // Update template's updatedAt
    await tx
      .update(workoutTemplates)
      .set({ updatedAt: new Date() })
      .where(eq(workoutTemplates.id, templateId));
  });

  // Return updated template
  return getTemplateById(templateId, userId);
}

// ============ Sorting Helpers ============

/**
 * Get order by columns for sorting templates
 */
function getOrderByColumns(sort: TemplateSortOption, order: 'asc' | 'desc'): SQL[] {
  const sortFn = order === 'asc' ? asc : desc;
  const idSort = asc(workoutTemplates.id); // Secondary sort for consistent pagination

  switch (sort) {
    case 'name':
      return [sortFn(workoutTemplates.name), idSort];
    case 'createdAt':
      return [sortFn(workoutTemplates.createdAt), idSort];
    case 'updatedAt':
      return [sortFn(workoutTemplates.updatedAt), idSort];
    default:
      return [desc(workoutTemplates.createdAt), idSort];
  }
}

/**
 * Build cursor condition for pagination
 */
function buildCursorCondition(
  cursor: TemplateCursorData,
  order: 'asc' | 'desc'
): SQL | null {
  const { id, sortValue, sortField } = cursor;

  switch (sortField) {
    case 'name':
      if (order === 'asc') {
        return sql`(${workoutTemplates.name} > ${sortValue} OR (${workoutTemplates.name} = ${sortValue} AND ${workoutTemplates.id} > ${id}))`;
      } else {
        return sql`(${workoutTemplates.name} < ${sortValue} OR (${workoutTemplates.name} = ${sortValue} AND ${workoutTemplates.id} > ${id}))`;
      }

    case 'createdAt':
      if (order === 'asc') {
        return sql`(${workoutTemplates.createdAt} > ${sortValue}::timestamp OR (${workoutTemplates.createdAt} = ${sortValue}::timestamp AND ${workoutTemplates.id} > ${id}))`;
      } else {
        return sql`(${workoutTemplates.createdAt} < ${sortValue}::timestamp OR (${workoutTemplates.createdAt} = ${sortValue}::timestamp AND ${workoutTemplates.id} > ${id}))`;
      }

    case 'updatedAt':
      if (order === 'asc') {
        return sql`(${workoutTemplates.updatedAt} > ${sortValue}::timestamp OR (${workoutTemplates.updatedAt} = ${sortValue}::timestamp AND ${workoutTemplates.id} > ${id}))`;
      } else {
        return sql`(${workoutTemplates.updatedAt} < ${sortValue}::timestamp OR (${workoutTemplates.updatedAt} = ${sortValue}::timestamp AND ${workoutTemplates.id} > ${id}))`;
      }

    default:
      return sql`${workoutTemplates.id} > ${id}`;
  }
}

/**
 * Get sort value from a template for cursor generation
 */
interface TemplateSortData {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function getSortValue(
  template: TemplateSortData,
  sort: TemplateSortOption
): string | number | null {
  switch (sort) {
    case 'name':
      return template.name;
    case 'createdAt':
      return template.createdAt.toISOString();
    case 'updatedAt':
      return template.updatedAt.toISOString();
    default:
      return template.createdAt.toISOString();
  }
}
