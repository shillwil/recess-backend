// Mock the database module before importing programService
jest.mock('../db', () => ({
  db: {}
}));

// Mock the schema module
jest.mock('../db/schema', () => ({
  workoutPrograms: {},
  programWeeks: {},
  workoutTemplates: {},
  templateExercises: {}
}));

import { encodeCursor, decodeCursor } from './programService';
import { ProgramCursorData } from '../models/program.types';
import {
  validateProgramListQuery,
  validateCreateProgram,
  validateUpdateProgram,
  validateProgramWorkouts,
  isValidUuid,
  PROGRAM_LIMITS
} from '../utils/validation';

describe('programService', () => {
  describe('cursor encoding/decoding', () => {
    it('should correctly encode and decode cursor data with string sortValue (name)', () => {
      const cursorData: ProgramCursorData = {
        id: 'test-uuid-1234',
        sortValue: 'PPL Program',
        sortField: 'name'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with date sortValue (createdAt)', () => {
      const cursorData: ProgramCursorData = {
        id: 'test-uuid-5678',
        sortValue: '2024-01-15T10:30:00.000Z',
        sortField: 'createdAt'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with date sortValue (updatedAt)', () => {
      const cursorData: ProgramCursorData = {
        id: 'test-uuid-9999',
        sortValue: '2024-06-20T15:45:30.000Z',
        sortField: 'updatedAt'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with null sortValue', () => {
      const cursorData: ProgramCursorData = {
        id: 'test-uuid-null',
        sortValue: null,
        sortField: 'name'
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
      const notJson = Buffer.from('this is not json').toString('base64url');
      const decoded = decodeCursor(notJson);
      expect(decoded).toBeNull();
    });

    it('should return null for empty string', () => {
      const decoded = decodeCursor('');
      expect(decoded).toBeNull();
    });

    it('should return null for cursor with invalid sortField', () => {
      const invalidCursor = Buffer.from(JSON.stringify({
        id: 'test-id',
        sortValue: 'test',
        sortField: 'invalidField'
      })).toString('base64url');

      const decoded = decodeCursor(invalidCursor);
      expect(decoded).toBeNull();
    });

    it('should return null for cursor with missing id', () => {
      const invalidCursor = Buffer.from(JSON.stringify({
        sortValue: 'test',
        sortField: 'name'
      })).toString('base64url');

      const decoded = decodeCursor(invalidCursor);
      expect(decoded).toBeNull();
    });

    it('should return null for extremely long cursor (DoS prevention)', () => {
      const longSortValue = 'a'.repeat(600);
      const longCursor = Buffer.from(JSON.stringify({
        id: 'test-id',
        sortValue: longSortValue,
        sortField: 'name'
      })).toString('base64url');

      expect(longCursor.length).toBeGreaterThan(500);

      const decoded = decodeCursor(longCursor);
      expect(decoded).toBeNull();
    });

    it('should produce URL-safe base64 encoding', () => {
      const cursorData: ProgramCursorData = {
        id: 'test-uuid-special',
        sortValue: 'Program with special chars: +/=',
        sortField: 'name'
      };

      const encoded = encodeCursor(cursorData);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');

      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(cursorData);
    });

    it('should handle all valid sort field types', () => {
      const sortFields = ['name', 'createdAt', 'updatedAt'] as const;

      for (const sortField of sortFields) {
        const cursorData: ProgramCursorData = {
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
      const originalData: ProgramCursorData = {
        id: 'multi-cycle-test',
        sortValue: '6-Day PPL Split',
        sortField: 'name'
      };

      let cursor = encodeCursor(originalData);

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

describe('program validation', () => {
  describe('validateProgramListQuery', () => {
    it('should accept valid query parameters', () => {
      const result = validateProgramListQuery({
        limit: 20,
        sort: 'name',
        order: 'asc'
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.limit).toBe(20);
      expect(result.sanitized?.sort).toBe('name');
      expect(result.sanitized?.order).toBe('asc');
    });

    it('should reject limit below 1', () => {
      const result = validateProgramListQuery({ limit: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('limit must be at least 1');
    });

    it('should reject limit above 100', () => {
      const result = validateProgramListQuery({ limit: 101 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('limit cannot exceed 100');
    });

    it('should reject invalid sort option', () => {
      const result = validateProgramListQuery({ sort: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid sort option');
    });

    it('should reject invalid order option', () => {
      const result = validateProgramListQuery({ order: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('order must be "asc" or "desc"');
    });

    it('should accept empty query (use defaults)', () => {
      const result = validateProgramListQuery({});
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCreateProgram', () => {
    const validTemplateId = '12345678-1234-1234-1234-123456789abc';

    it('should accept valid program input', () => {
      const result = validateCreateProgram({
        name: 'Push Pull Legs',
        description: '6-day split',
        daysPerWeek: 6,
        workouts: [
          { dayNumber: 0, templateId: validTemplateId, dayLabel: 'Push' },
          { dayNumber: 1, templateId: validTemplateId, dayLabel: 'Pull' },
          { dayNumber: 2, templateId: validTemplateId, dayLabel: 'Legs' },
          { dayNumber: 3, templateId: validTemplateId, dayLabel: 'Push' },
          { dayNumber: 4, templateId: validTemplateId, dayLabel: 'Pull' },
          { dayNumber: 5, templateId: validTemplateId, dayLabel: 'Legs' }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.name).toBe('Push Pull Legs');
      expect(result.sanitized?.daysPerWeek).toBe(6);
      expect(result.sanitized?.workouts).toHaveLength(6);
    });

    it('should accept program without durationWeeks (indefinite)', () => {
      const result = validateCreateProgram({
        name: 'Ongoing Program',
        daysPerWeek: 3,
        workouts: [
          { dayNumber: 0, templateId: validTemplateId },
          { dayNumber: 1, templateId: validTemplateId },
          { dayNumber: 2, templateId: validTemplateId }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.durationWeeks).toBeUndefined();
    });

    it('should accept program with durationWeeks (finite)', () => {
      const result = validateCreateProgram({
        name: '8-Week Program',
        daysPerWeek: 4,
        durationWeeks: 8,
        workouts: [
          { dayNumber: 0, templateId: validTemplateId },
          { dayNumber: 1, templateId: validTemplateId },
          { dayNumber: 2, templateId: validTemplateId },
          { dayNumber: 3, templateId: validTemplateId }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.durationWeeks).toBe(8);
    });

    it('should reject empty name', () => {
      const result = validateCreateProgram({
        name: '',
        daysPerWeek: 3,
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should reject name exceeding max length', () => {
      const result = validateCreateProgram({
        name: 'a'.repeat(PROGRAM_LIMITS.MAX_NAME_LENGTH + 1),
        daysPerWeek: 3,
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name cannot exceed'))).toBe(true);
    });

    it('should reject missing daysPerWeek', () => {
      const result = validateCreateProgram({
        name: 'Test',
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('daysPerWeek is required'))).toBe(true);
    });

    it('should reject daysPerWeek below 1', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 0,
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('daysPerWeek must be between'))).toBe(true);
    });

    it('should reject daysPerWeek above 7', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 8,
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('daysPerWeek must be between'))).toBe(true);
    });

    it('should reject empty workouts array', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        workouts: []
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('workouts array cannot be empty');
    });

    it('should reject invalid templateId format', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        workouts: [{ dayNumber: 0, templateId: 'invalid-uuid' }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('valid UUID'))).toBe(true);
    });

    it('should reject dayNumber outside range', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        workouts: [{ dayNumber: 5, templateId: validTemplateId }] // 5 >= 3
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('dayNumber must be between'))).toBe(true);
    });

    it('should reject duplicate dayNumber values', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        workouts: [
          { dayNumber: 0, templateId: validTemplateId },
          { dayNumber: 0, templateId: validTemplateId }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('duplicated'))).toBe(true);
    });

    it('should reject dayLabel exceeding max length', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        workouts: [{
          dayNumber: 0,
          templateId: validTemplateId,
          dayLabel: 'a'.repeat(PROGRAM_LIMITS.MAX_DAY_LABEL_LENGTH + 1)
        }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('dayLabel cannot exceed'))).toBe(true);
    });

    it('should reject durationWeeks above 52', () => {
      const result = validateCreateProgram({
        name: 'Test',
        daysPerWeek: 3,
        durationWeeks: 53,
        workouts: [{ dayNumber: 0, templateId: validTemplateId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('durationWeeks must be between'))).toBe(true);
    });
  });

  describe('validateUpdateProgram', () => {
    it('should accept valid update with name only', () => {
      const result = validateUpdateProgram({ name: 'New Name' });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.name).toBe('New Name');
    });

    it('should accept valid update with description only', () => {
      const result = validateUpdateProgram({ description: 'New description' });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.description).toBe('New description');
    });

    it('should accept valid update with daysPerWeek', () => {
      const result = validateUpdateProgram({ daysPerWeek: 5 });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.daysPerWeek).toBe(5);
    });

    it('should accept null durationWeeks to make indefinite', () => {
      const result = validateUpdateProgram({ durationWeeks: null });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.durationWeeks).toBeNull();
    });

    it('should reject empty update body', () => {
      const result = validateUpdateProgram({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No valid fields to update');
    });

    it('should reject unknown fields', () => {
      const result = validateUpdateProgram({ unknownField: 'value' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown fields'))).toBe(true);
    });

    it('should reject empty name', () => {
      const result = validateUpdateProgram({ name: '   ' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name cannot be empty');
    });

    it('should reject invalid daysPerWeek', () => {
      const result = validateUpdateProgram({ daysPerWeek: 8 });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('daysPerWeek must be between'))).toBe(true);
    });
  });

  describe('validateProgramWorkouts', () => {
    const validTemplateId = '12345678-1234-1234-1234-123456789abc';
    const daysPerWeek = 3;

    it('should accept valid workouts array', () => {
      const result = validateProgramWorkouts({
        workouts: [
          { dayNumber: 0, templateId: validTemplateId },
          { dayNumber: 1, templateId: validTemplateId },
          { dayNumber: 2, templateId: validTemplateId }
        ]
      }, daysPerWeek);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.workouts).toHaveLength(3);
    });

    it('should reject empty workouts array', () => {
      const result = validateProgramWorkouts({ workouts: [] }, daysPerWeek);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('workouts array cannot be empty');
    });

    it('should reject missing workouts key', () => {
      const result = validateProgramWorkouts({}, daysPerWeek);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('workouts must be an array');
    });

    it('should reject dayNumber outside daysPerWeek range', () => {
      const result = validateProgramWorkouts({
        workouts: [{ dayNumber: 3, templateId: validTemplateId }] // 3 >= 3
      }, daysPerWeek);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('dayNumber must be between'))).toBe(true);
    });
  });
});
