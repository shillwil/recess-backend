import { db } from '../db';
import { workouts, workoutExercises, sets, exercises } from '../db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';

export interface TrainingHistorySummary {
  hasHistory: boolean;
  workoutCount: number;
  summaryText: string;
}

export class TrainingHistoryService {
  /**
   * Fetches and summarizes a user's recent training data (last 30 days).
   * Returns null if fewer than 5 completed workouts found.
   */
  static async getUserTrainingSummary(userId: string): Promise<TrainingHistorySummary | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    // Fetch completed workouts in the last 30 days
    const recentWorkouts = await db
      .select({
        workoutId: workouts.id,
        workoutDate: workouts.date,
        workoutName: workouts.name,
        exerciseId: workoutExercises.exerciseId,
        exerciseName: workoutExercises.exerciseName,
        muscleGroups: workoutExercises.muscleGroups,
        setNumber: sets.setNumber,
        reps: sets.reps,
        weightLbs: sets.weightLbs,
        setType: sets.setType,
      })
      .from(workouts)
      .innerJoin(workoutExercises, eq(workouts.id, workoutExercises.workoutId))
      .innerJoin(sets, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workouts.isCompleted, true),
          gte(workouts.date, cutoffDate)
        )
      )
      .orderBy(desc(workouts.date));

    if (recentWorkouts.length === 0) {
      return null;
    }

    // Count unique workouts
    const uniqueWorkoutIds = new Set(recentWorkouts.map(r => r.workoutId));
    const workoutCount = uniqueWorkoutIds.size;

    if (workoutCount < 5) {
      return null;
    }

    // Calculate frequency (workouts per week over the 30-day period)
    const frequency = Math.round((workoutCount / 30) * 7 * 10) / 10;

    // Track exercise volumes and max weights
    const exerciseStats = new Map<string, {
      name: string;
      totalSets: number;
      muscleGroups: string[];
      maxWeight: number;
      maxWeightReps: number;
    }>();

    const muscleGroupSets = new Map<string, number>();
    let totalSets = 0;

    for (const row of recentWorkouts) {
      if (row.setType !== 'working') continue;

      const exId = row.exerciseId;
      const existing = exerciseStats.get(exId);
      const weight = parseFloat(row.weightLbs as string) || 0;

      if (existing) {
        existing.totalSets++;
        if (weight > existing.maxWeight && row.reps >= 5) {
          existing.maxWeight = weight;
          existing.maxWeightReps = row.reps;
        }
      } else {
        exerciseStats.set(exId, {
          name: row.exerciseName,
          totalSets: 1,
          muscleGroups: row.muscleGroups || [],
          maxWeight: row.reps >= 5 ? weight : 0,
          maxWeightReps: row.reps >= 5 ? row.reps : 0,
        });
      }

      // Track muscle group volume
      for (const mg of (row.muscleGroups || [])) {
        muscleGroupSets.set(mg, (muscleGroupSets.get(mg) || 0) + 1);
      }
      totalSets++;
    }

    // Compute weeks for per-week stats
    const weeks = 30 / 7;

    // Top exercises by volume (sets)
    const topExercises = Array.from(exerciseStats.entries())
      .sort((a, b) => b[1].totalSets - a[1].totalSets)
      .slice(0, 10);

    // Estimated working weights for compounds
    const compoundKeywords = ['bench press', 'squat', 'deadlift', 'overhead press', 'row'];
    const estimatedWeights: string[] = [];
    for (const [, stat] of exerciseStats) {
      if (stat.maxWeight > 0) {
        const nameLower = stat.name.toLowerCase();
        if (compoundKeywords.some(kw => nameLower.includes(kw))) {
          estimatedWeights.push(`${stat.name} ${stat.maxWeight}lb x${stat.maxWeightReps}`);
        }
      }
    }

    // Volume distribution by muscle group
    const volumeDistribution: string[] = [];
    const sortedMuscleGroups = Array.from(muscleGroupSets.entries())
      .sort((a, b) => b[1] - a[1]);

    for (const [mg, setCount] of sortedMuscleGroups) {
      const pct = Math.round((setCount / totalSets) * 100);
      volumeDistribution.push(`${mg} ${pct}%`);
    }

    // Weak points: muscle groups with <10% of total volume
    const weakPoints = sortedMuscleGroups
      .filter(([, count]) => (count / totalSets) < 0.10)
      .map(([mg]) => mg);

    // Most used exercises with sets/week
    const mostUsed = topExercises
      .slice(0, 5)
      .map(([, stat]) => `${stat.name} (${Math.round(stat.totalSets / weeks * 10) / 10} sets/week)`);

    // Build summary text
    const lines: string[] = [
      `USER TRAINING HISTORY (Last 30 days):`,
      `- Frequency: ${frequency} workouts/week`,
    ];

    if (estimatedWeights.length > 0) {
      lines.push(`- Estimated working weights: ${estimatedWeights.join(', ')}`);
    }

    if (volumeDistribution.length > 0) {
      lines.push(`- Volume distribution: ${volumeDistribution.join(', ')}`);
    }

    if (weakPoints.length > 0) {
      lines.push(`- Weak points (low volume): ${weakPoints.join(', ')}`);
    }

    if (mostUsed.length > 0) {
      lines.push(`- Most used exercises: ${mostUsed.join(', ')}`);
    }

    return {
      hasHistory: true,
      workoutCount,
      summaryText: lines.join('\n'),
    };
  }

  /**
   * Formats manual strength entries into a text summary for the AI prompt.
   */
  static formatManualStrengthData(entries: Array<{
    exerciseName: string;
    weight: number;
    unit: string;
    reps: number;
    sets: number;
  }>): string {
    const lines = [
      `USER SELF-REPORTED STRENGTH LEVELS:`,
    ];

    for (const entry of entries) {
      lines.push(`- ${entry.exerciseName}: ${entry.weight}${entry.unit} x${entry.reps} for ${entry.sets} sets`);
    }

    lines.push(`\nNote: These are self-reported values. Use them to gauge appropriate training loads.`);

    return lines.join('\n');
  }
}
