import { db } from '../db';
import { workouts, workoutExercises, sets, exercises } from '../db/schema';
import { eq, and, gte, sql, desc } from 'drizzle-orm';

interface MuscleVolumeMap {
  [muscle: string]: number;
}

interface CompoundEstimate {
  exerciseName: string;
  weight: number;
  reps: number;
}

/**
 * Fetches and summarizes the user's recent training data (last 30 days)
 * into a text block suitable for inclusion in the Gemini prompt.
 *
 * Returns null if fewer than 5 workouts found (insufficient data).
 */
export async function getTrainingHistorySummary(userId: string): Promise<string | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Fetch completed workouts from the last 30 days
  const recentWorkouts = await db
    .select({
      id: workouts.id,
      date: workouts.date,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        gte(workouts.date, thirtyDaysAgo),
        eq(workouts.isCompleted, true)
      )
    )
    .orderBy(desc(workouts.date));

  if (recentWorkouts.length < 5) {
    return null;
  }

  const workoutIds = recentWorkouts.map(w => w.id);

  // Fetch all workout exercises and their sets for these workouts
  const exerciseData = await db
    .select({
      workoutId: workoutExercises.workoutId,
      exerciseId: workoutExercises.exerciseId,
      exerciseName: workoutExercises.exerciseName,
      primaryMuscles: workoutExercises.primaryMuscles,
      setId: sets.id,
      reps: sets.reps,
      weightLbs: sets.weightLbs,
      setType: sets.setType,
    })
    .from(workoutExercises)
    .innerJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(
      sql`${workoutExercises.workoutId} IN (${sql.join(workoutIds.map(id => sql`${id}`), sql`, `)})`
    );

  if (exerciseData.length === 0) {
    return null;
  }

  // 1. Frequency: average workouts per week
  const daySpan = Math.max(1, Math.ceil((Date.now() - thirtyDaysAgo.getTime()) / (1000 * 60 * 60 * 24 * 7)));
  const frequency = (recentWorkouts.length / daySpan).toFixed(1);

  // 2. Count working sets per exercise
  const exerciseSetCounts: Map<string, { name: string; sets: number }> = new Map();
  const muscleVolume: MuscleVolumeMap = {};
  let totalSets = 0;

  for (const row of exerciseData) {
    if (row.setType !== 'working') continue;

    totalSets++;

    // Track per-exercise volume
    const existing = exerciseSetCounts.get(row.exerciseId);
    if (existing) {
      existing.sets++;
    } else {
      exerciseSetCounts.set(row.exerciseId, { name: row.exerciseName, sets: 1 });
    }

    // Track per-muscle volume
    const muscles = row.primaryMuscles || [];
    for (const muscle of muscles) {
      muscleVolume[muscle] = (muscleVolume[muscle] || 0) + 1;
    }
  }

  // 3. Top exercises by volume (top 10)
  const topExercises = Array.from(exerciseSetCounts.entries())
    .sort((a, b) => b[1].sets - a[1].sets)
    .slice(0, 10);

  const weeksInPeriod = Math.max(1, daySpan);
  const topExercisesStr = topExercises
    .map(([, data]) => `${data.name} (${(data.sets / weeksInPeriod).toFixed(0)} sets/week)`)
    .join(', ');

  // 4. Estimated working weights for major compounds
  const majorCompounds = ['bench press', 'squat', 'deadlift', 'overhead press', 'barbell row'];
  const compoundEstimates: CompoundEstimate[] = [];

  for (const compound of majorCompounds) {
    // Find the heaviest weight used for 5+ reps
    const matching = exerciseData.filter(
      row =>
        row.exerciseName.toLowerCase().includes(compound) &&
        row.setType === 'working' &&
        row.reps >= 5
    );

    if (matching.length > 0) {
      const heaviest = matching.reduce((best, row) => {
        const weight = parseFloat(String(row.weightLbs));
        return weight > best.weight ? { exerciseName: row.exerciseName, weight, reps: row.reps } : best;
      }, { exerciseName: '', weight: 0, reps: 0 });

      if (heaviest.weight > 0) {
        compoundEstimates.push(heaviest);
      }
    }
  }

  const compoundStr = compoundEstimates.length > 0
    ? compoundEstimates.map(e => `${e.exerciseName} ${e.weight}lb x${e.reps}`).join(', ')
    : 'No major compound data available';

  // 5. Volume distribution by muscle group
  const volumeDistribution: string[] = [];
  const sortedMuscles = Object.entries(muscleVolume).sort((a, b) => b[1] - a[1]);

  for (const [muscle, count] of sortedMuscles) {
    const pct = totalSets > 0 ? Math.round((count / totalSets) * 100) : 0;
    volumeDistribution.push(`${capitalize(muscle)} ${pct}%`);
  }

  // 6. Weak points: muscle groups with <10% of total volume
  const weakPoints = sortedMuscles
    .filter(([, count]) => totalSets > 0 && (count / totalSets) < 0.10)
    .map(([muscle]) => capitalize(muscle));

  // Build summary
  const lines = [
    `USER TRAINING HISTORY (Last 30 days):`,
    `- Frequency: ${frequency} workouts/week`,
    `- Estimated working weights: ${compoundStr}`,
    `- Volume distribution: ${volumeDistribution.join(', ')}`,
  ];

  if (weakPoints.length > 0) {
    lines.push(`- Weak points (low volume): ${weakPoints.join(', ')}`);
  }

  lines.push(`- Most used exercises: ${topExercisesStr}`);

  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
