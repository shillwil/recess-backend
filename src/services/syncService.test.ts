// Mock the database module before importing syncService
jest.mock('../db', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  }
}));

// Mock the schema module
jest.mock('../db/schema', () => ({
  workouts: {},
  workoutExercises: {},
  sets: {},
  syncMetadata: {},
  syncConflictLog: {},
  userDevices: {},
  exercises: {}
}));

// Mock drizzle-orm operators so query conditions can be inspected without a real connection
jest.mock('drizzle-orm', () => ({
  eq: jest.fn((column, value) => ({ column, value })),
  and: jest.fn(),
  gt: jest.fn(),
  asc: jest.fn(),
  inArray: jest.fn(),
}));

import { db } from '../db';
import { SyncService, resolveLegacyExerciseName } from './syncService';

const mockDb = db as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
};

describe('syncService', () => {
  describe('resolveLegacyExerciseName', () => {
    it('should map "Lat Pulldown" to "Lat Pulldown Machine"', () => {
      expect(resolveLegacyExerciseName('Lat Pulldown')).toBe('Lat Pulldown Machine');
    });

    it('should return undefined for names with no legacy mapping', () => {
      expect(resolveLegacyExerciseName('Bench Press')).toBeUndefined();
    });

    it('should return undefined for the current (renamed) name itself', () => {
      expect(resolveLegacyExerciseName('Lat Pulldown Machine')).toBeUndefined();
    });

    it('should be case-sensitive to match exact library names', () => {
      expect(resolveLegacyExerciseName('lat pulldown')).toBeUndefined();
    });
  });

  describe('getOrCreateExerciseId', () => {
    // Access the private static method for unit testing
    const getOrCreateExerciseId = (name: string, primaryMuscles: string[]): Promise<string> =>
      (SyncService as unknown as {
        getOrCreateExerciseId: (name: string, primaryMuscles: string[]) => Promise<string>;
      }).getOrCreateExerciseId(name, primaryMuscles);

    let insertedValues: jest.Mock;

    // Configure db.select so lookups return rows keyed by the name passed to eq()
    const mockLibrary = (rowsByName: Record<string, { id: string }[]>) => {
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: (condition: { value: string }) => ({
            limit: () => Promise.resolve(rowsByName[condition.value] ?? []),
          }),
        }),
      }));
    };

    beforeEach(() => {
      jest.clearAllMocks();
      insertedValues = jest.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: insertedValues });
    });

    it('should return the existing exercise id on an exact name match', async () => {
      mockLibrary({ 'Bench Press': [{ id: 'bench-press-id' }] });

      const result = await getOrCreateExerciseId('Bench Press', ['chest']);

      expect(result).toBe('bench-press-id');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should resolve legacy name "Lat Pulldown" to the "Lat Pulldown Machine" row without creating a new exercise', async () => {
      mockLibrary({ 'Lat Pulldown Machine': [{ id: 'lat-pulldown-machine-id' }] });

      const result = await getOrCreateExerciseId('Lat Pulldown', ['back']);

      expect(result).toBe('lat-pulldown-machine-id');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should prefer an exact match over the legacy mapping', async () => {
      mockLibrary({
        'Lat Pulldown': [{ id: 'exact-match-id' }],
        'Lat Pulldown Machine': [{ id: 'lat-pulldown-machine-id' }],
      });

      const result = await getOrCreateExerciseId('Lat Pulldown', ['back']);

      expect(result).toBe('exact-match-id');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should create a custom exercise for unknown names', async () => {
      mockLibrary({});

      const result = await getOrCreateExerciseId('Alexs Special Press', ['shoulders']);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(insertedValues).toHaveBeenCalledWith({
        id: result,
        name: 'Alexs Special Press',
        primaryMuscles: ['shoulders'],
        isCustom: true,
      });
    });

    it('should create a custom exercise when a legacy name maps to a missing library row', async () => {
      mockLibrary({});

      const result = await getOrCreateExerciseId('Lat Pulldown', ['back']);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(insertedValues).toHaveBeenCalledWith({
        id: result,
        name: 'Lat Pulldown',
        primaryMuscles: ['back'],
        isCustom: true,
      });
    });
  });
});
