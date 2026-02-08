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
import { exerciseSeedData, buildVideoUrl } from '../data/exercises';
import { eq, sql } from 'drizzle-orm';

export async function seedExercisesOnStartup(): Promise<void> {
  try {
    // Quick check: count non-custom exercises already in the DB
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(exercises)
      .where(eq(exercises.isCustom, false));

    const existingCount = Number(countResult[0]?.count || 0);

    // If we already have all expected exercises, skip seeding entirely
    if (existingCount >= exerciseSeedData.length) {
      console.log(`[seed] ${existingCount} library exercises already present. Skipping seed.`);
      return;
    }

    console.log(`[seed] Found ${existingCount}/${exerciseSeedData.length} library exercises. Seeding...`);

    let processed = 0;
    for (const exercise of exerciseSeedData) {
      const videoUrl = buildVideoUrl(exercise.videoFilename);

      await db
        .insert(exercises)
        .values({
          name: exercise.name,
          primaryMuscles: exercise.primaryMuscles,
          secondaryMuscles: exercise.secondaryMuscles ?? [],
          equipment: exercise.equipment,
          difficulty: exercise.difficulty,
          movementPattern: exercise.movementPattern,
          exerciseType: exercise.exerciseType,
          videoUrl: videoUrl,
          thumbnailUrl: null,
          instructions: null,
          isCustom: false,
          createdBy: null,
        })
        .onConflictDoUpdate({
          target: exercises.name,
          set: {
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles ?? [],
            equipment: exercise.equipment,
            difficulty: exercise.difficulty,
            movementPattern: exercise.movementPattern,
            exerciseType: exercise.exerciseType,
            videoUrl: videoUrl,
            isCustom: false,
            updatedAt: sql`now()`,
          },
        });

      processed++;
    }

    console.log(`[seed] Seeded ${processed} library exercises successfully.`);
  } catch (error) {
    // Log but don't crash the server - exercises might already exist
    console.error('[seed] Failed to seed exercises:', error);
  }
}
