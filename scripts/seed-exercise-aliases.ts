/**
 * Seed script for exercise aliases
 *
 * This script populates the exercise_aliases table with common gym slang,
 * abbreviations, and alternative names for exercises.
 *
 * Run with: npx tsx scripts/seed-exercise-aliases.ts
 */

import { config } from 'dotenv';

// Load environment variables
const env = process.env.NODE_ENV || 'development';
config({ path: `./.env.${env}` });

import { db } from '../src/db';
import { exercises, exerciseAliases } from '../src/db/schema';
import { eq } from 'drizzle-orm';

// Common exercise aliases mapping
// Format: { "Official Exercise Name": ["alias1", "alias2", ...] }
const EXERCISE_ALIASES: Record<string, string[]> = {
  // Chest exercises
  'Bench Press': [
    'bench',
    'flat bench',
    'barbell bench',
    'bb bench',
    'chest press'
  ],
  'Incline Bench Press': [
    'incline bench',
    'incline press',
    'incline barbell bench'
  ],
  'Decline Bench Press': [
    'decline bench',
    'decline press'
  ],
  'Dumbbell Bench Press': [
    'db bench',
    'dumbbell bench',
    'db chest press'
  ],
  'Dumbbell Fly': [
    'db fly',
    'db flys',
    'chest fly',
    'chest flys',
    'dumbbell flyes',
    'pec fly'
  ],
  'Cable Fly': [
    'cable flys',
    'cable crossover',
    'cable cross',
    'crossovers'
  ],
  'Push-Up': [
    'pushup',
    'push up',
    'pushups',
    'push-ups'
  ],
  'Dips': [
    'chest dips',
    'tricep dips',
    'parallel bar dips',
    'dip'
  ],

  // Back exercises
  'Deadlift': [
    'conventional deadlift',
    'deads',
    'dl'
  ],
  'Sumo Deadlift': [
    'sumo deads',
    'sumo dl'
  ],
  'Romanian Deadlift': [
    'rdl',
    'rdls',
    'stiff leg deadlift',
    'stiff legged deadlift'
  ],
  'Barbell Row': [
    'bent over row',
    'bb row',
    'barbell bent over row',
    'pendlay row'
  ],
  'Dumbbell Row': [
    'db row',
    'one arm row',
    'single arm row',
    'one arm dumbbell row'
  ],
  'Pull-Up': [
    'pullup',
    'pull up',
    'pullups',
    'pull-ups',
    'chin up',
    'chinup',
    'chin-up'
  ],
  'Lat Pulldown': [
    'lat pull down',
    'pulldown',
    'pull down',
    'cable pulldown'
  ],
  'Seated Cable Row': [
    'cable row',
    'seated row',
    'low row'
  ],
  'T-Bar Row': [
    't bar row',
    'tbar row',
    'landmine row'
  ],

  // Shoulder exercises
  'Overhead Press': [
    'ohp',
    'shoulder press',
    'military press',
    'barbell overhead press',
    'standing press'
  ],
  'Dumbbell Shoulder Press': [
    'db shoulder press',
    'db ohp',
    'seated dumbbell press',
    'arnold press'
  ],
  'Lateral Raise': [
    'lat raise',
    'side raise',
    'side lateral raise',
    'lateral raises',
    'db lateral raise'
  ],
  'Front Raise': [
    'front raises',
    'front delt raise',
    'db front raise'
  ],
  'Rear Delt Fly': [
    'reverse fly',
    'rear delt flys',
    'reverse flys',
    'rear delts',
    'bent over lateral raise'
  ],
  'Face Pull': [
    'face pulls',
    'cable face pull'
  ],
  'Upright Row': [
    'upright rows',
    'barbell upright row'
  ],
  'Shrugs': [
    'shrug',
    'barbell shrug',
    'dumbbell shrug',
    'db shrug',
    'trap shrug'
  ],

  // Arm exercises - Biceps
  'Barbell Curl': [
    'bb curl',
    'bicep curl',
    'standing curl',
    'barbell bicep curl'
  ],
  'Dumbbell Curl': [
    'db curl',
    'dumbbell bicep curl',
    'standing db curl'
  ],
  'Hammer Curl': [
    'hammer curls',
    'db hammer curl',
    'neutral grip curl'
  ],
  'Preacher Curl': [
    'preacher curls',
    'ez bar preacher curl',
    'scott curl'
  ],
  'Concentration Curl': [
    'concentration curls',
    'seated concentration curl'
  ],
  'Cable Curl': [
    'cable curls',
    'cable bicep curl'
  ],
  'Incline Dumbbell Curl': [
    'incline curl',
    'incline db curl'
  ],

  // Arm exercises - Triceps
  'Tricep Pushdown': [
    'tricep push down',
    'pushdown',
    'cable pushdown',
    'rope pushdown',
    'tricep pressdown'
  ],
  'Skull Crusher': [
    'skull crushers',
    'skullcrushers',
    'lying tricep extension',
    'ez bar skull crusher',
    'french press'
  ],
  'Overhead Tricep Extension': [
    'tricep extension',
    'overhead extension',
    'french press',
    'db tricep extension'
  ],
  'Close Grip Bench Press': [
    'close grip bench',
    'cgbp',
    'narrow grip bench'
  ],
  'Tricep Kickback': [
    'kickback',
    'kickbacks',
    'db kickback'
  ],

  // Leg exercises
  'Squat': [
    'back squat',
    'barbell squat',
    'bb squat',
    'squats'
  ],
  'Front Squat': [
    'front squats',
    'barbell front squat'
  ],
  'Goblet Squat': [
    'goblet squats',
    'db goblet squat'
  ],
  'Leg Press': [
    'leg press machine',
    '45 degree leg press',
    'seated leg press'
  ],
  'Hack Squat': [
    'hack squats',
    'machine hack squat'
  ],
  'Lunge': [
    'lunges',
    'walking lunge',
    'walking lunges',
    'forward lunge',
    'db lunge'
  ],
  'Bulgarian Split Squat': [
    'bss',
    'split squat',
    'rear foot elevated split squat',
    'rfess'
  ],
  'Leg Extension': [
    'leg extensions',
    'quad extension',
    'machine leg extension'
  ],
  'Leg Curl': [
    'leg curls',
    'hamstring curl',
    'lying leg curl',
    'seated leg curl'
  ],
  'Hip Thrust': [
    'hip thrusts',
    'barbell hip thrust',
    'glute bridge',
    'bb hip thrust'
  ],
  'Glute Kickback': [
    'glute kickbacks',
    'cable glute kickback',
    'donkey kick'
  ],
  'Calf Raise': [
    'calf raises',
    'standing calf raise',
    'seated calf raise',
    'calf press'
  ],

  // Core exercises
  'Plank': [
    'planks',
    'front plank',
    'forearm plank'
  ],
  'Crunch': [
    'crunches',
    'ab crunch',
    'abdominal crunch'
  ],
  'Sit-Up': [
    'situp',
    'sit up',
    'situps',
    'sit-ups'
  ],
  'Hanging Leg Raise': [
    'leg raise',
    'hanging leg raises',
    'hanging knee raise'
  ],
  'Cable Crunch': [
    'cable crunches',
    'kneeling cable crunch'
  ],
  'Russian Twist': [
    'russian twists',
    'seated twist'
  ],
  'Ab Wheel Rollout': [
    'ab wheel',
    'ab roller',
    'rollout',
    'rollouts'
  ],
  'Dead Bug': [
    'dead bugs',
    'deadbug'
  ],
  'Mountain Climber': [
    'mountain climbers'
  ],

  // Olympic lifts
  'Clean and Jerk': [
    'clean & jerk',
    'c&j',
    'cnj'
  ],
  'Power Clean': [
    'power cleans',
    'clean'
  ],
  'Snatch': [
    'power snatch'
  ],
  'Clean Pull': [
    'clean pulls'
  ],

  // Compound movements
  'Farmer Walk': [
    'farmer walks',
    'farmers walk',
    'farmers carry',
    'farmer carry'
  ],
  'Kettlebell Swing': [
    'kb swing',
    'kettlebell swings',
    'kb swings'
  ],
  'Turkish Get-Up': [
    'turkish getup',
    'tgu',
    'get up'
  ],
  'Thruster': [
    'thrusters',
    'barbell thruster'
  ],
  'Burpee': [
    'burpees'
  ],
  'Box Jump': [
    'box jumps',
    'jump box'
  ]
};

async function seedExerciseAliases() {
  console.log('Starting exercise alias seeding...\n');

  let totalAliasesAdded = 0;
  let exercisesNotFound = 0;

  for (const [exerciseName, aliases] of Object.entries(EXERCISE_ALIASES)) {
    // Find the exercise in the database
    const exercise = await db
      .select()
      .from(exercises)
      .where(eq(exercises.name, exerciseName))
      .limit(1);

    if (exercise.length === 0) {
      console.log(`  [SKIP] Exercise not found: "${exerciseName}"`);
      exercisesNotFound++;
      continue;
    }

    const exerciseId = exercise[0].id;

    // Insert aliases for this exercise
    for (const alias of aliases) {
      try {
        await db.insert(exerciseAliases).values({
          exerciseId,
          alias: alias.toLowerCase() // Store aliases in lowercase for consistent matching
        });
        totalAliasesAdded++;
      } catch (error: any) {
        // Skip duplicates silently (unique constraint violation)
        if (error.code !== '23505') {
          console.error(`  [ERROR] Failed to add alias "${alias}" for "${exerciseName}":`, error.message);
        }
      }
    }

    console.log(`  [OK] Added ${aliases.length} aliases for "${exerciseName}"`);
  }

  console.log('\n--- Seeding Complete ---');
  console.log(`Total aliases added: ${totalAliasesAdded}`);
  console.log(`Exercises not found: ${exercisesNotFound}`);
  console.log('\nNote: Exercises not found need to be added to the exercises table first.');

  process.exit(0);
}

// Run the seed function
seedExerciseAliases().catch((error) => {
  console.error('Failed to seed exercise aliases:', error);
  process.exit(1);
});
