// Mock the database module before importing templateService
jest.mock('../db', () => ({
  db: {}
}));

// Mock the schema module
jest.mock('../db/schema', () => ({
  workoutTemplates: {},
  templateExercises: {},
  exercises: {}
}));

import { encodeCursor, decodeCursor } from './templateService';
import { TemplateCursorData } from '../models/template.types';
import {
  validateTemplateListQuery,
  validateCreateTemplate,
  validateUpdateTemplate,
  validateTemplateExercises,
  validateCloneTemplate,
  isValidUuid,
  TEMPLATE_LIMITS
} from '../utils/validation';

describe('templateService', () => {
  describe('cursor encoding/decoding', () => {
    it('should correctly encode and decode cursor data with string sortValue (name)', () => {
      const cursorData: TemplateCursorData = {
        id: 'test-uuid-1234',
        sortValue: 'Push Day',
        sortField: 'name'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with date sortValue (createdAt)', () => {
      const cursorData: TemplateCursorData = {
        id: 'test-uuid-5678',
        sortValue: '2024-01-15T10:30:00.000Z',
        sortField: 'createdAt'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with date sortValue (updatedAt)', () => {
      const cursorData: TemplateCursorData = {
        id: 'test-uuid-9999',
        sortValue: '2024-06-20T15:45:30.000Z',
        sortField: 'updatedAt'
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it('should correctly encode and decode cursor data with null sortValue', () => {
      const cursorData: TemplateCursorData = {
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
      // Create a cursor that exceeds MAX_CURSOR_LENGTH (500)
      const longSortValue = 'a'.repeat(600);
      const longCursor = Buffer.from(JSON.stringify({
        id: 'test-id',
        sortValue: longSortValue,
        sortField: 'name'
      })).toString('base64url');

      // The cursor string should be well over 500 characters
      expect(longCursor.length).toBeGreaterThan(500);

      const decoded = decodeCursor(longCursor);
      expect(decoded).toBeNull();
    });

    it('should produce URL-safe base64 encoding', () => {
      const cursorData: TemplateCursorData = {
        id: 'test-uuid-special',
        sortValue: 'Template with special chars: +/=',
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
        const cursorData: TemplateCursorData = {
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
      const originalData: TemplateCursorData = {
        id: 'multi-cycle-test',
        sortValue: 'Upper Body Workout',
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

describe('template validation', () => {
  describe('validateTemplateListQuery', () => {
    it('should accept valid query parameters', () => {
      const result = validateTemplateListQuery({
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
      const result = validateTemplateListQuery({ limit: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('limit must be at least 1');
    });

    it('should reject limit above 100', () => {
      const result = validateTemplateListQuery({ limit: 101 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('limit cannot exceed 100');
    });

    it('should reject invalid sort option', () => {
      const result = validateTemplateListQuery({ sort: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid sort option');
    });

    it('should reject invalid order option', () => {
      const result = validateTemplateListQuery({ order: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('order must be "asc" or "desc"');
    });

    it('should accept empty query (use defaults)', () => {
      const result = validateTemplateListQuery({});
      expect(result.valid).toBe(true);
    });

    it('should accept limit at maximum (100)', () => {
      const result = validateTemplateListQuery({ limit: 100 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.limit).toBe(100);
    });

    it('should accept limit at minimum (1)', () => {
      const result = validateTemplateListQuery({ limit: 1 });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.limit).toBe(1);
    });

    it('should parse limit from string', () => {
      const result = validateTemplateListQuery({ limit: '50' });
      expect(result.valid).toBe(true);
      expect(result.sanitized?.limit).toBe(50);
    });
  });

  describe('validateCreateTemplate', () => {
    const validExerciseId = '12345678-1234-1234-1234-123456789abc';

    it('should accept valid template input', () => {
      const result = validateCreateTemplate({
        name: 'Push Day',
        description: 'Upper body push workout',
        exercises: [
          {
            exerciseId: validExerciseId,
            orderIndex: 0,
            workingSets: 4,
            warmupSets: 2,
            targetReps: '8-12',
            restSeconds: 90,
            notes: 'Focus on form'
          }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.name).toBe('Push Day');
      expect(result.sanitized?.description).toBe('Upper body push workout');
      expect(result.sanitized?.exercises).toHaveLength(1);
    });

    it('should reject empty name', () => {
      const result = validateCreateTemplate({
        name: '',
        exercises: [{ exerciseId: validExerciseId, workingSets: 3 }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should reject name exceeding max length', () => {
      const result = validateCreateTemplate({
        name: 'a'.repeat(TEMPLATE_LIMITS.MAX_NAME_LENGTH + 1),
        exercises: [{ exerciseId: validExerciseId, workingSets: 3 }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name cannot exceed'))).toBe(true);
    });

    it('should reject empty exercises array', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: []
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exercises array cannot be empty');
    });

    it('should reject too many exercises', () => {
      const exercises = Array(TEMPLATE_LIMITS.MAX_EXERCISES_PER_TEMPLATE + 1)
        .fill(null)
        .map((_, i) => ({
          exerciseId: validExerciseId,
          orderIndex: i,
          workingSets: 3
        }));

      const result = validateCreateTemplate({
        name: 'Test',
        exercises
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cannot exceed'))).toBe(true);
    });

    it('should reject invalid exercise ID format', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [{ exerciseId: 'invalid-uuid', workingSets: 3 }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('valid UUID'))).toBe(true);
    });

    it('should reject missing workingSets', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [{ exerciseId: validExerciseId }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('workingSets is required'))).toBe(true);
    });

    it('should reject workingSets below 1', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [{ exerciseId: validExerciseId, workingSets: 0 }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('workingSets must be an integer >= 1'))).toBe(true);
    });

    it('should reject workingSets above max', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [{
          exerciseId: validExerciseId,
          workingSets: TEMPLATE_LIMITS.MAX_WORKING_SETS + 1
        }]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('workingSets cannot exceed'))).toBe(true);
    });

    it('should reject duplicate orderIndex values', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [
          { exerciseId: validExerciseId, orderIndex: 0, workingSets: 3 },
          { exerciseId: validExerciseId, orderIndex: 0, workingSets: 3 }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('duplicated'))).toBe(true);
    });

    it('should use array index as default orderIndex', () => {
      const result = validateCreateTemplate({
        name: 'Test',
        exercises: [
          { exerciseId: validExerciseId, workingSets: 3 },
          { exerciseId: validExerciseId, workingSets: 4 }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.exercises[0].orderIndex).toBe(0);
      expect(result.sanitized?.exercises[1].orderIndex).toBe(1);
    });
  });

  describe('validateUpdateTemplate', () => {
    it('should accept valid update with name only', () => {
      const result = validateUpdateTemplate({ name: 'New Name' });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.name).toBe('New Name');
    });

    it('should accept valid update with description only', () => {
      const result = validateUpdateTemplate({ description: 'New description' });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.description).toBe('New description');
    });

    it('should accept null description to clear it', () => {
      const result = validateUpdateTemplate({ description: null });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.description).toBe('');
    });

    it('should reject empty update body', () => {
      const result = validateUpdateTemplate({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No valid fields to update');
    });

    it('should reject unknown fields', () => {
      const result = validateUpdateTemplate({ unknownField: 'value' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown fields'))).toBe(true);
    });

    it('should reject empty name', () => {
      const result = validateUpdateTemplate({ name: '   ' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name cannot be empty');
    });
  });

  describe('validateTemplateExercises', () => {
    const validExerciseId = '12345678-1234-1234-1234-123456789abc';

    it('should accept valid exercises array', () => {
      const result = validateTemplateExercises({
        exercises: [
          { exerciseId: validExerciseId, orderIndex: 0, workingSets: 4 },
          { exerciseId: validExerciseId, orderIndex: 1, workingSets: 3 }
        ]
      });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.exercises).toHaveLength(2);
    });

    it('should reject empty exercises array', () => {
      const result = validateTemplateExercises({ exercises: [] });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exercises array cannot be empty');
    });

    it('should reject missing exercises key', () => {
      const result = validateTemplateExercises({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exercises must be an array');
    });
  });

  describe('validateCloneTemplate', () => {
    it('should accept empty body', () => {
      const result = validateCloneTemplate({});
      expect(result.valid).toBe(true);
    });

    it('should accept null body', () => {
      const result = validateCloneTemplate(null);
      expect(result.valid).toBe(true);
    });

    it('should accept valid name', () => {
      const result = validateCloneTemplate({ name: 'Cloned Template' });

      expect(result.valid).toBe(true);
      expect(result.sanitized?.name).toBe('Cloned Template');
    });

    it('should reject empty name', () => {
      const result = validateCloneTemplate({ name: '' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name cannot be empty');
    });

    it('should reject name exceeding max length', () => {
      const result = validateCloneTemplate({
        name: 'a'.repeat(TEMPLATE_LIMITS.MAX_NAME_LENGTH + 1)
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cannot exceed'))).toBe(true);
    });
  });

  describe('isValidUuid', () => {
    it('should accept valid UUIDs', () => {
      expect(isValidUuid('12345678-1234-1234-1234-123456789abc')).toBe(true);
      expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
      expect(isValidUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('12345678-1234-1234-1234')).toBe(false);
      expect(isValidUuid('12345678-1234-1234-1234-123456789abcdef')).toBe(false);
      expect(isValidUuid('12345678_1234_1234_1234_123456789abc')).toBe(false);
    });
  });
});
