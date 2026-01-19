import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { exercises } from '../src/db/schema';
import { exerciseSeedData, buildVideoUrl } from '../seed-data/exercises';
import { sql } from 'drizzle-orm';

// Load env for local dev only
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  config({ path: '.env.development' });
}

function getDirectDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing—set in .env.development locally or link in Railway');
  const parsed = new URL(url);
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV) {
    parsed.searchParams.set('sslmode', 'require');
  }
  return parsed.toString();
}

async function seedExercises(): Promise<void> {
  console.log('🌱 Starting exercise seeding...');
  console.log(`📦 Preparing to seed ${exerciseSeedData.length} exercises`);

  const pool = new Pool({
    connectionString: getDirectDbUrl(),
    max: 1,
  });
  const db = drizzle(pool);

  try {
    let inserted = 0;
    let updated = 0;

    for (const exercise of exerciseSeedData) {
      const videoUrl = buildVideoUrl(exercise.videoFilename);

      const result = await db
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
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: exercises.id, name: exercises.name });

      // Check if this was an insert or update by checking if createdAt === updatedAt
      // For simplicity, we'll count all as processed
      console.log(`  ✓ ${exercise.name}`);
      inserted++;
    }

    console.log(`\n✅ Seeding complete!`);
    console.log(`   Total exercises processed: ${inserted}`);

    // Verify count
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(exercises).where(sql`video_url IS NOT NULL`);
    console.log(`   Exercises with videos in DB: ${countResult[0].count}`);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
seedExercises();
