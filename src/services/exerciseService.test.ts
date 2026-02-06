// Mock the database module before importing exerciseService
jest.mock('../db', () => ({
  db: {}
}));

// Mock the schema module
jest.mock('../db/schema', () => ({
  exercises: {},
  exerciseAliases: {},
  userExerciseHistory: {},
  difficultyLevelEnum: { enumValues: ['beginner', 'intermediate', 'advanced'] },
  movementPatternEnum: { enumValues: ['push', 'pull', 'hinge', 'squat', 'lunge', 'carry', 'rotation', 'core'] },
  exerciseTypeEnum: { enumValues: ['compound', 'isolation', 'cardio', 'plyometric', 'stretch'] },
  muscleGroupEnum: { enumValues: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'forearms', 'traps', 'lats'] }
}));

import { encodeCursor, decodeCursor } from './exerciseService';
import { CursorData } from '../models/exercise.types';

describe('exerciseService', () => {
  describe('cursor encoding/decoding', () => {
    it('should correctly encode and decode cursor data with string sortValue', () => {
      const cursorData: CursorData = {
        id: 'test-uuid-1234',
        sortValue: 'Bench Press',
        sortField: 'name'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with numeric sortValue', () => {
      const cursorData: CursorData = {
        id: 'test-uuid-5678',
        sortValue: 95.5,
        sortField: 'popularity'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with null sortValue', () => {
      const cursorData: CursorData = {
        id: 'test-uuid-9999',
        sortValue: null,
        sortField: 'difficulty'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor for recently_used sort', () => {
      const cursorData: CursorData = {
        id: 'test-uuid-abcd',
        sortValue: '2024-01-15T10:30:00.000Z',
        sortField: 'recently_used'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should return null for invalid cursor string', () => {
      const decoded = decodeCursor('invalid-cursor-string');
      expect(decoded).toBeNull();
    });

    it('should return null for malformed base64', () => {
      const decoded = decodeCursor('!!!not-valid-base64!!!');
      expect(decoded).toBeNull();
    });

    it('should return null for valid base64 but invalid JSON', () => {
      // Encode a non-JSON string
      const notJson = Buffer.from('this is not json').toString('base64url');
      const decoded = decodeCursor(notJson);
      expect(decoded).toBeNull();
    });

    it('should return null for empty string', () => {
      const decoded = decodeCursor('');
      expect(decoded).toBeNull();
    });

    it('should produce URL-safe base64 encoding', () => {
      const cursorData: CursorData = {
        id: 'test-uuid-with-special-chars',
        sortValue: 'Exercise with special chars: +/=',
        sortField: 'name'
      };

      const encoded = encodeCursor(cursorData);

      // URL-safe base64 should not contain +, /, or =
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      // base64url may have trailing = for padding, but they're optional
      // The important thing is it doesn't have the standard base64 chars

      // Should still decode correctly
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(cursorData);
    });

    it('should handle cursor data with all sort field types', () => {
      const sortFields = ['name', 'popularity', 'recently_used', 'difficulty'] as const;

      for (const sortField of sortFields) {
        const cursorData: CursorData = {
          id: `test-${sortField}`,
          sortValue: 'test-value',
          sortField
        };

        const encoded = encodeCursor(cursorData);
        const decoded = decodeCursor(encoded);

        expect(decoded).toEqual(cursorData);
        expect(decoded?.sortField).toBe(sortField);
      }
    });
  });

  describe('cursor round-trip integrity', () => {
    it('should maintain data integrity through multiple encode/decode cycles', () => {
      const originalData: CursorData = {
        id: 'multi-cycle-test',
        sortValue: 'Test Exercise Name',
        sortField: 'name'
      };

      let cursor = encodeCursor(originalData);

      // Decode and re-encode multiple times
      for (let i = 0; i < 5; i++) {
        const decoded = decodeCursor(cursor);
        expect(decoded).toEqual(originalData);
        cursor = encodeCursor(decoded!);
      }

      const finalDecoded = decodeCursor(cursor);
      expect(finalDecoded).toEqual(originalData);
    });
  });
});
