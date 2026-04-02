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

// ============ Progress Trends (1-6 months) ============

interface ExerciseProgression {
  exerciseName: string;
  exerciseId: string;
  earliestWeight: number;
  latestWeight: number;
  percentChange: number;
  weeksStalled: number;
  isStalled: boolean;
}

interface WeeklyVolume {
  weekLabel: string;
  totalSets: number;
  totalVolumeLoad: number;
}

export interface ProgressTrendSummary {
  periodMonths: number;
  totalWorkouts: number;
  exerciseProgressions: ExerciseProgression[];
  stalledExercises: ExerciseProgression[];
  weeklyVolumeTrend: WeeklyVolume[];
}

/**
 * Assigns a workout date to an ISO week label like "2026-W14".
 * Used for grouping sets into weekly buckets for trend analysis.
 */
function getISOWeekLabel(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday of current week determines the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Computes training progress trends over a configurable time range (1-6 months).
 *
 * Unlike getTrainingHistorySummary() which gives a snapshot of the last 30 days,
 * this function looks at trends: is weight going up, stalling, or declining?
 * How is overall volume changing over time?
 *
 * Returns null if fewer than 8 workouts found in the period (insufficient data
 * to identify meaningful trends).
 */
export async function getProgressTrends(
  userId: string,
  months: number = 3
): Promise<ProgressTrendSummary | null> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (months * 30));

  // Same two-query pattern as getTrainingHistorySummary:
  // 1. Fetch workout IDs by date range (uses workouts_user_date_idx)
  // 2. Batch-fetch all exercise/set data for those workouts
  const periodWorkouts = await db
    .select({
      id: workouts.id,
      date: workouts.date,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        gte(workouts.date, startDate),
        eq(workouts.isCompleted, true)
      )
    )
    .orderBy(desc(workouts.date));

  if (periodWorkouts.length < 8) {
    return null;
  }

  const workoutIds = periodWorkouts.map(w => w.id);

  const exerciseData = await db
    .select({
      workoutId: workoutExercises.workoutId,
      exerciseId: workoutExercises.exerciseId,
      exerciseName: workoutExercises.exerciseName,
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

  // Build a lookup: workoutId → date
  const workoutDateMap = new Map(periodWorkouts.map(w => [w.id, w.date]));

  // ---- Per-exercise weight progression & stall detection ----
  // For each exercise, track max working weight per week
  const exerciseWeeklyMax: Map<string, {
    name: string;
    weeks: Map<string, number>; // weekLabel → max weight
  }> = new Map();

  // ---- Weekly volume aggregation ----
  const weeklyVolume: Map<string, { sets: number; volumeLoad: number }> = new Map();

  for (const row of exerciseData) {
    if (row.setType !== 'working') continue;

    const workoutDate = workoutDateMap.get(row.workoutId);
    if (!workoutDate) continue;

    const weekLabel = getISOWeekLabel(workoutDate);
    const weight = parseFloat(String(row.weightLbs)) || 0;
    const reps = row.reps || 0;

    // Per-exercise weekly max weight
    let exerciseEntry = exerciseWeeklyMax.get(row.exerciseId);
    if (!exerciseEntry) {
      exerciseEntry = { name: row.exerciseName, weeks: new Map() };
      exerciseWeeklyMax.set(row.exerciseId, exerciseEntry);
    }
    const currentMax = exerciseEntry.weeks.get(weekLabel) || 0;
    if (weight > currentMax) {
      exerciseEntry.weeks.set(weekLabel, weight);
    }

    // Weekly volume totals
    let weekVol = weeklyVolume.get(weekLabel);
    if (!weekVol) {
      weekVol = { sets: 0, volumeLoad: 0 };
      weeklyVolume.set(weekLabel, weekVol);
    }
    weekVol.sets++;
    weekVol.volumeLoad += weight * reps;
  }

  // ---- Compute exercise progressions ----
  const STALL_TOLERANCE = 0.025; // 2.5% — weights within this range count as "same"
  const STALL_WEEKS_THRESHOLD = 3;

  const exerciseProgressions: ExerciseProgression[] = [];

  for (const [exerciseId, data] of exerciseWeeklyMax) {
    if (data.weeks.size < 2) continue; // Need at least 2 weeks of data

    const sortedWeeks = Array.from(data.weeks.entries())
      .sort((a, b) => a[0].localeCompare(b[0])); // Sort chronologically

    const earliestWeight = sortedWeeks[0][1];
    const latestWeight = sortedWeeks[sortedWeeks.length - 1][1];
    const percentChange = earliestWeight > 0
      ? ((latestWeight - earliestWeight) / earliestWeight) * 100
      : 0;

    // Stall detection: count consecutive recent weeks with ~same weight
    let weeksStalled = 0;
    if (sortedWeeks.length >= STALL_WEEKS_THRESHOLD) {
      const recentWeight = sortedWeeks[sortedWeeks.length - 1][1];
      for (let i = sortedWeeks.length - 2; i >= 0; i--) {
        const weekWeight = sortedWeeks[i][1];
        if (recentWeight === 0 || Math.abs(weekWeight - recentWeight) / recentWeight <= STALL_TOLERANCE) {
          weeksStalled++;
        } else {
          break;
        }
      }
    }

    exerciseProgressions.push({
      exerciseName: data.name,
      exerciseId,
      earliestWeight,
      latestWeight,
      percentChange: Math.round(percentChange * 10) / 10,
      weeksStalled,
      isStalled: weeksStalled >= STALL_WEEKS_THRESHOLD,
    });
  }

  // Sort by total volume (most-used exercises first)
  exerciseProgressions.sort((a, b) => {
    const aWeeks = exerciseWeeklyMax.get(a.exerciseId)?.weeks.size || 0;
    const bWeeks = exerciseWeeklyMax.get(b.exerciseId)?.weeks.size || 0;
    return bWeeks - aWeeks;
  });

  // ---- Build weekly volume trend ----
  const weeklyVolumeTrend = Array.from(weeklyVolume.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekLabel, vol]) => ({
      weekLabel,
      totalSets: vol.sets,
      totalVolumeLoad: Math.round(vol.volumeLoad),
    }));

  return {
    periodMonths: months,
    totalWorkouts: periodWorkouts.length,
    exerciseProgressions: exerciseProgressions.slice(0, 15), // Top 15 most-trained
    stalledExercises: exerciseProgressions.filter(e => e.isStalled),
    weeklyVolumeTrend,
  };
}

/**
 * Converts a ProgressTrendSummary into a compact text block for the Gemini prompt.
 * Keeps it concise — Gemini doesn't need raw weekly data, just the highlights.
 */
export function formatProgressTrendsForPrompt(trends: ProgressTrendSummary): string {
  const lines: string[] = [
    `USER PROGRESS TRENDS (Last ${trends.periodMonths} months, ${trends.totalWorkouts} workouts):`,
  ];

  // Exercise progressions (top 10)
  const topProgressions = trends.exerciseProgressions.slice(0, 10);
  if (topProgressions.length > 0) {
    lines.push('');
    lines.push('Exercise weight trends:');
    for (const ex of topProgressions) {
      const sign = ex.percentChange >= 0 ? '+' : '';
      const status = ex.isStalled
        ? ` — STALLED ${ex.weeksStalled} weeks`
        : ex.percentChange > 5
          ? ' — steady progress'
          : '';
      lines.push(`- ${ex.exerciseName}: ${ex.earliestWeight}lb → ${ex.latestWeight}lb (${sign}${ex.percentChange}%)${status}`);
    }
  }

  // Stalled exercises (if any not already shown above)
  const additionalStalls = trends.stalledExercises.filter(
    e => !topProgressions.some(p => p.exerciseId === e.exerciseId)
  );
  if (additionalStalls.length > 0) {
    lines.push('');
    lines.push('Additional stalled exercises:');
    for (const ex of additionalStalls) {
      lines.push(`- ${ex.exerciseName}: ${ex.latestWeight}lb — STALLED ${ex.weeksStalled} weeks`);
    }
  }

  // Overall volume trends (first week vs last week)
  if (trends.weeklyVolumeTrend.length >= 2) {
    const first = trends.weeklyVolumeTrend[0];
    const last = trends.weeklyVolumeTrend[trends.weeklyVolumeTrend.length - 1];
    const setsChange = first.totalSets > 0
      ? Math.round(((last.totalSets - first.totalSets) / first.totalSets) * 100)
      : 0;
    const loadChange = first.totalVolumeLoad > 0
      ? Math.round(((last.totalVolumeLoad - first.totalVolumeLoad) / first.totalVolumeLoad) * 100)
      : 0;

    lines.push('');
    lines.push(`Weekly volume trend: ${first.totalSets} sets/week → ${last.totalSets} sets/week (${setsChange >= 0 ? '+' : ''}${setsChange}%)`);
    lines.push(`Weekly load trend: ${first.totalVolumeLoad.toLocaleString()}lb → ${last.totalVolumeLoad.toLocaleString()}lb (${loadChange >= 0 ? '+' : ''}${loadChange}%)`);
  }

  return lines.join('\n');
}
