/**
 * Helper functions for sync service data normalization
 * Extracted for testability
 */

import { ExerciseSyncData, SetSyncData } from './syncService';

/**
 * Normalize exercise data to handle backwards compatibility with older iOS clients
 * that send muscleGroups instead of primaryMuscles
 */
export function normalizeExerciseData(
  exerciseData: ExerciseSyncData
): ExerciseSyncData & { normalizedPrimaryMuscles: string[] } {
  return {
    ...exerciseData,
    normalizedPrimaryMuscles: exerciseData.primaryMuscles || exerciseData.muscleGroups || [],
  };
}

/**
 * Normalize set data to handle backwards compatibility with older iOS clients
 * that send exerciseTypeMuscleGroups instead of exerciseTypePrimaryMuscles
 */
export function normalizeSetData(
  setData: SetSyncData
): SetSyncData & { normalizedExerciseTypePrimaryMuscles: string[] } {
  return {
    ...setData,
    normalizedExerciseTypePrimaryMuscles:
      setData.exerciseTypePrimaryMuscles || setData.exerciseTypeMuscleGroups || [],
  };
}

/**
 * Check if exercise data uses the deprecated muscleGroups field
 */
export function usesDeprecatedMuscleGroups(exerciseData: ExerciseSyncData): boolean {
  return !exerciseData.primaryMuscles && !!exerciseData.muscleGroups;
}

/**
 * Check if set data uses the deprecated exerciseTypeMuscleGroups field
 */
export function usesDeprecatedExerciseTypeMuscleGroups(setData: SetSyncData): boolean {
  return !setData.exerciseTypePrimaryMuscles && !!setData.exerciseTypeMuscleGroups;
}
