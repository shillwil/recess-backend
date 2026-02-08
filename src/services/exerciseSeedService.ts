/**
 * Exercise auto-seeding service
 *
 * Ensures the exercise library is always populated on server startup.
 * Uses onConflictDoUpdate so it's safe to run on every startup (idempotent).
 * This solves the problem of exercises never being seeded in production
 * because the standalone seed script requires tsx (a devDependency).
 */

import { db } from '../db';
import { exercises } from '../db/schema';
import {
  exerciseSeedData,
  buildExerciseInsertValues,
  buildExerciseConflictSet,
} from '../data/exercises';

export async function seedExercisesOnStartup(): Promise<void> {
  try {
    console.log(`[seed] Upserting ${exerciseSeedData.length} library exercises...`);

    for (const exercise of exerciseSeedData) {
      await db
        .insert(exercises)
        .values(buildExerciseInsertValues(exercise))
        .onConflictDoUpdate({
          target: exercises.name,
          set: buildExerciseConflictSet(exercise),
        });
    }

    console.log(`[seed] Done. ${exerciseSeedData.length} library exercises ready.`);
  } catch (error) {
    // Log but don't crash the server
    console.error('[seed] Failed to seed exercises:', error);
  }
}
