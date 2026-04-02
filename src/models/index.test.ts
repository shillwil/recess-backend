import {
  Exercise,
  WorkoutExercise,
  DifficultyLevel,
  MovementPattern,
  ExerciseType,
} from './index';

describe('Model Types', () => {
  describe('Exercise', () => {
    it('should have primaryMuscles as required field', () => {
      const exercise: Exercise = {
        id: 'test-id',
        name: 'Bench Press',
        primaryMuscles: ['chest', 'triceps', 'shoulders'],
        isCustom: false,
        createdAt: '2026-01-18T10:00:00Z',
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(exercise.primaryMuscles).toEqual(['chest', 'triceps', 'shoulders']);
    });

    it('should support optional secondaryMuscles', () => {
      const exercise: Exercise = {
        id: 'test-id',
        name: 'Bench Press',
        primaryMuscles: ['chest'],
        secondaryMuscles: ['triceps', 'shoulders'],
        isCustom: false,
        createdAt: '2026-01-18T10:00:00Z',
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(exercise.secondaryMuscles).toEqual(['triceps', 'shoulders']);
    });

    it('should support all new classification fields', () => {
      const exercise: Exercise = {
        id: 'test-id',
        name: 'Bench Press',
        primaryMuscles: ['chest'],
        secondaryMuscles: ['triceps'],
        difficulty: 'intermediate',
        movementPattern: 'push',
        exerciseType: 'compound',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        totalTimesUsed: 100,
        lastUsedAt: '2026-01-17T10:00:00Z',
        popularityScore: 85.5,
        isCustom: false,
        createdAt: '2026-01-18T10:00:00Z',
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(exercise.difficulty).toBe('intermediate');
      expect(exercise.movementPattern).toBe('push');
      expect(exercise.exerciseType).toBe('compound');
      expect(exercise.thumbnailUrl).toBe('https://example.com/thumb.jpg');
      expect(exercise.totalTimesUsed).toBe(100);
      expect(exercise.popularityScore).toBe(85.5);
    });
  });

  describe('WorkoutExercise', () => {
    it('should have primaryMuscles instead of muscleGroups', () => {
      const workoutExercise: WorkoutExercise = {
        id: 'test-id',
        workoutId: 'workout-id',
        exerciseId: 'exercise-id',
        orderIndex: 0,
        exerciseName: 'Squat',
        primaryMuscles: ['quads', 'glutes', 'hamstrings'],
        createdAt: '2026-01-18T10:00:00Z',
        updatedAt: '2026-01-18T10:00:00Z',
      };

      expect(workoutExercise.primaryMuscles).toEqual(['quads', 'glutes', 'hamstrings']);
      // @ts-expect-error - muscleGroups should not exist on WorkoutExercise
      expect(workoutExercise.muscleGroups).toBeUndefined();
    });
  });

  describe('DifficultyLevel type', () => {
    it('should accept valid difficulty levels', () => {
      const levels: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];

      expect(levels).toContain('beginner');
      expect(levels).toContain('intermediate');
      expect(levels).toContain('advanced');
    });
  });

  describe('MovementPattern type', () => {
    it('should accept valid movement patterns', () => {
      const patterns: MovementPattern[] = [
        'push', 'pull', 'hinge', 'squat', 'lunge', 'carry', 'rotation', 'core'
      ];

      expect(patterns).toHaveLength(8);
      expect(patterns).toContain('push');
      expect(patterns).toContain('pull');
      expect(patterns).toContain('hinge');
      expect(patterns).toContain('squat');
    });
  });

  describe('ExerciseType type', () => {
    it('should accept valid exercise types', () => {
      const types: ExerciseType[] = [
        'compound', 'isolation', 'cardio', 'plyometric', 'stretch'
      ];

      expect(types).toHaveLength(5);
      expect(types).toContain('compound');
      expect(types).toContain('isolation');
    });
  });
});
