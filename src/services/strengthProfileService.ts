import { db } from '../db';
import { userStrengthProfiles, exercises } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export interface StrengthEntry {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  unit: 'lb' | 'kg';
  reps: number;
  sets: number;
}

export interface ManualStrengthInput {
  exerciseName: string;
  weight: number;
  unit: 'lb' | 'kg';
  reps: number;
  sets: number;
}

/**
 * Fuzzy-match an exercise name to an exercise in the library.
 * Uses case-insensitive ILIKE matching, then word_similarity for fuzzy fallback.
 */
async function matchExerciseName(name: string): Promise<{ id: string; name: string } | null> {
  // Try exact case-insensitive match first
  const exact = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(sql`LOWER(${exercises.name}) = LOWER(${name})`)
    .limit(1);

  if (exact.length > 0) return exact[0];

  // Fuzzy match using word_similarity
  const fuzzy = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      similarity: sql<number>`word_similarity(${name}, ${exercises.name})`.as('similarity'),
    })
    .from(exercises)
    .where(sql`word_similarity(${name}, ${exercises.name}) > 0.3`)
    .orderBy(sql`word_similarity(${name}, ${exercises.name}) DESC`)
    .limit(1);

  if (fuzzy.length > 0) return { id: fuzzy[0].id, name: fuzzy[0].name };

  // Fallback: ILIKE contains
  const contains = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(sql`${exercises.name} ILIKE ${'%' + name + '%'}`)
    .limit(1);

  if (contains.length > 0) return contains[0];

  return null;
}

/**
 * Upsert a user's strength profile with matched exercise IDs.
 */
export async function upsertStrengthProfile(
  userId: string,
  entries: ManualStrengthInput[]
): Promise<{ entries: StrengthEntry[]; updatedAt: Date }> {
  const matchedEntries: StrengthEntry[] = [];

  for (const entry of entries) {
    const matched = await matchExerciseName(entry.exerciseName);
    matchedEntries.push({
      exerciseId: matched?.id || '',
      exerciseName: matched?.name || entry.exerciseName,
      weight: entry.weight,
      unit: entry.unit,
      reps: entry.reps,
      sets: entry.sets,
    });
  }

  // Upsert: insert or update on conflict
  const now = new Date();
  const existing = await db
    .select({ id: userStrengthProfiles.id })
    .from(userStrengthProfiles)
    .where(eq(userStrengthProfiles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userStrengthProfiles)
      .set({
        strengthEntries: matchedEntries,
        updatedAt: now,
      })
      .where(eq(userStrengthProfiles.userId, userId));
  } else {
    await db
      .insert(userStrengthProfiles)
      .values({
        userId,
        strengthEntries: matchedEntries,
        updatedAt: now,
        createdAt: now,
      });
  }

  return { entries: matchedEntries, updatedAt: now };
}

/**
 * Get a user's strength profile.
 */
export async function getStrengthProfile(
  userId: string
): Promise<{ entries: StrengthEntry[]; updatedAt: Date } | null> {
  const rows = await db
    .select({
      strengthEntries: userStrengthProfiles.strengthEntries,
      updatedAt: userStrengthProfiles.updatedAt,
    })
    .from(userStrengthProfiles)
    .where(eq(userStrengthProfiles.userId, userId))
    .limit(1);

  if (rows.length === 0) return null;

  return {
    entries: (rows[0].strengthEntries || []) as StrengthEntry[],
    updatedAt: rows[0].updatedAt,
  };
}

/**
 * Format strength profile data as text for the Gemini prompt.
 */
export function formatStrengthDataForPrompt(entries: StrengthEntry[]): string {
  if (entries.length === 0) return '';

  const lines = entries
    .filter(e => e.exerciseId) // Only include matched exercises
    .map(e => `${e.exerciseName}: ${e.weight}${e.unit} x${e.reps} for ${e.sets} sets`);

  return `USER MANUAL STRENGTH PROFILE:\n${lines.join('\n')}`;
}
