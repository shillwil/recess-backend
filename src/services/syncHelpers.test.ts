import {
  normalizeExerciseData,
  normalizeSetData,
  usesDeprecatedMuscleGroups,
  usesDeprecatedExerciseTypeMuscleGroups,
} from './syncHelpers';
import { ExerciseSyncData, SetSyncData } from './syncService';

describe('syncHelpers', () => {
  describe('normalizeExerciseData', () => {
    const baseExercise: Omit<ExerciseSyncData, 'primaryMuscles' | 'muscleGroups'> = {
      clientId: 'test-client-id',
      exerciseName: 'Bench Press',
      sets: [],
      updatedAt: '2026-01-18T10:00:00Z',
    };

    it('should use primaryMuscles when provided', () => {
      const exerciseData: ExerciseSyncData = {
        ...baseExercise,
        primaryMuscles: ['chest', 'triceps'],
      };

      const result = normalizeExerciseData(exerciseData);

      expect(result.normalizedPrimaryMuscles).toEqual(['chest', 'triceps']);
    });

    it('should fall back to muscleGroups when primaryMuscles is not provided (backwards compatibility)', () => {
      const exerciseData: ExerciseSyncData = {
        ...baseExercise,
        primaryMuscles: undefined as unknown as string[],
        muscleGroups: ['chest', 'shoulders'],
      };

      const result = normalizeExerciseData(exerciseData);

      expect(result.normalizedPrimaryMuscles).toEqual(['chest', 'shoulders']);
    });

    it('should prefer primaryMuscles over muscleGroups when both are provided', () => {
      const exerciseData: ExerciseSyncData = {
        ...baseExercise,
        primaryMuscles: ['chest', 'triceps'],
        muscleGroups: ['back', 'biceps'],
      };

      const result = normalizeExerciseData(exerciseData);

      expect(result.normalizedPrimaryMuscles).toEqual(['chest', 'triceps']);
    });

    it('should return empty array when neither primaryMuscles nor muscleGroups is provided', () => {
      const exerciseData: ExerciseSyncData = {
        ...baseExercise,
        primaryMuscles: undefined as unknown as string[],
        muscleGroups: undefined,
      };

      const result = normalizeExerciseData(exerciseData);

      expect(result.normalizedPrimaryMuscles).toEqual([]);
    });

    it('should preserve all original exercise data properties', () => {
      const exerciseData: ExerciseSyncData = {
        ...baseExercise,
        primaryMuscles: ['chest'],
      };

      const result = normalizeExerciseData(exerciseData);

      expect(result.clientId).toBe('test-client-id');
      expect(result.exerciseName).toBe('Bench Press');
      expect(result.updatedAt).toBe('2026-01-18T10:00:00Z');
    });
  });

  describe('normalizeSetData', () => {
    const baseSet: Omit<SetSyncData, 'exerciseTypePrimaryMuscles' | 'exerciseTypeMuscleGroups'> = {
      clientId: 'test-set-id',
      reps: 10,
      weight: 135,
      setType: 'working',
      exerciseTypeName: 'Bench Press',
      updatedAt: '2026-01-18T10:00:00Z',
    };

    it('should use exerciseTypePrimaryMuscles when provided', () => {
      const setData: SetSyncData = {
        ...baseSet,
        exerciseTypePrimaryMuscles: ['chest', 'triceps'],
      };

      const result = normalizeSetData(setData);

      expect(result.normalizedExerciseTypePrimaryMuscles).toEqual(['chest', 'triceps']);
    });

    it('should fall back to exerciseTypeMuscleGroups when exerciseTypePrimaryMuscles is not provided', () => {
      const setData: SetSyncData = {
        ...baseSet,
        exerciseTypePrimaryMuscles: undefined as unknown as string[],
        exerciseTypeMuscleGroups: ['chest', 'shoulders'],
      };

      const result = normalizeSetData(setData);

      expect(result.normalizedExerciseTypePrimaryMuscles).toEqual(['chest', 'shoulders']);
    });

    it('should prefer exerciseTypePrimaryMuscles over exerciseTypeMuscleGroups when both are provided', () => {
      const setData: SetSyncData = {
        ...baseSet,
        exerciseTypePrimaryMuscles: ['chest', 'triceps'],
        exerciseTypeMuscleGroups: ['back', 'biceps'],
      };

      const result = normalizeSetData(setData);

      expect(result.normalizedExerciseTypePrimaryMuscles).toEqual(['chest', 'triceps']);
    });

    it('should return empty array when neither field is provided', () => {
      const setData: SetSyncData = {
        ...baseSet,
        exerciseTypePrimaryMuscles: undefined as unknown as string[],
        exerciseTypeMuscleGroups: undefined,
      };

      const result = normalizeSetData(setData);

      expect(result.normalizedExerciseTypePrimaryMuscles).toEqual([]);
    });
  });

  describe('usesDeprecatedMuscleGroups', () => {
    it('should return true when only muscleGroups is provided', () => {
      const exerciseData: ExerciseSyncData = {
        clientId: 'test',
        exerciseName: 'Test',
        primaryMuscles: undefined as unknown as string[],
        muscleGroups: ['chest'],
        sets: [],
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(usesDeprecatedMuscleGroups(exerciseData)).toBe(true);
    });

    it('should return false when primaryMuscles is provided', () => {
      const exerciseData: ExerciseSyncData = {
        clientId: 'test',
        exerciseName: 'Test',
        primaryMuscles: ['chest'],
        sets: [],
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(usesDeprecatedMuscleGroups(exerciseData)).toBe(false);
    });

    it('should return false when both are provided (primaryMuscles takes precedence)', () => {
      const exerciseData: ExerciseSyncData = {
        clientId: 'test',
        exerciseName: 'Test',
        primaryMuscles: ['chest'],
        muscleGroups: ['back'],
        sets: [],
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(usesDeprecatedMuscleGroups(exerciseData)).toBe(false);
    });
  });

  describe('usesDeprecatedExerciseTypeMuscleGroups', () => {
    it('should return true when only exerciseTypeMuscleGroups is provided', () => {
      const setData: SetSyncData = {
        clientId: 'test',
        reps: 10,
        weight: 100,
        setType: 'working',
        exerciseTypeName: 'Test',
        exerciseTypePrimaryMuscles: undefined as unknown as string[],
        exerciseTypeMuscleGroups: ['chest'],
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(usesDeprecatedExerciseTypeMuscleGroups(setData)).toBe(true);
    });

    it('should return false when exerciseTypePrimaryMuscles is provided', () => {
      const setData: SetSyncData = {
        clientId: 'test',
        reps: 10,
        weight: 100,
        setType: 'working',
        exerciseTypeName: 'Test',
        exerciseTypePrimaryMuscles: ['chest'],
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(usesDeprecatedExerciseTypeMuscleGroups(setData)).toBe(false);
    });
  });
});
