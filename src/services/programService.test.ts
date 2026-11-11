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

import { encodeCursor, decodeCursor, planProgramUpdate, ProgramValidationError } from './programService';
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

    describe('with workouts (rotation replaced in the same request)', () => {
      const templateId = '12345678-1234-1234-1234-123456789abc';
      const rotation = (days: number) =>
        Array.from({ length: days }, (_, dayNumber) => ({ dayNumber, templateId }));

      it('should accept removing a day: daysPerWeek 4 -> 3 with the three remaining workouts', () => {
        // The stored program still has 4 days; the request must be judged against the new 3
        const result = validateUpdateProgram({ daysPerWeek: 3, workouts: rotation(3) }, 4);

        expect(result.valid).toBe(true);
        expect(result.sanitized?.daysPerWeek).toBe(3);
        expect(result.sanitized?.workouts?.map(w => w.dayNumber)).toEqual([0, 1, 2]);
      });

      it('should accept adding a day: daysPerWeek 3 -> 4 with four workouts', () => {
        const result = validateUpdateProgram({ daysPerWeek: 4, workouts: rotation(4) }, 3);

        expect(result.valid).toBe(true);
        expect(result.sanitized?.workouts).toHaveLength(4);
      });

      it('should accept workouts as the only field', () => {
        const result = validateUpdateProgram({ workouts: rotation(2) }, 3);

        expect(result.valid).toBe(true);
        expect(result.sanitized).toEqual({
          workouts: [
            { dayNumber: 0, templateId, dayLabel: undefined },
            { dayNumber: 1, templateId, dayLabel: undefined }
          ]
        });
      });

      it('should trim dayLabel like the create and workouts endpoints do', () => {
        const result = validateUpdateProgram({
          workouts: [{ dayNumber: 0, templateId, dayLabel: '  Push  ' }]
        }, 3);

        expect(result.valid).toBe(true);
        expect(result.sanitized?.workouts?.[0].dayLabel).toBe('Push');
      });

      it('should reject a dayNumber beyond the daysPerWeek in the same request', () => {
        // 4 workouts cannot fit the 3-day rotation this request asks for
        const result = validateUpdateProgram({ daysPerWeek: 3, workouts: rotation(4) }, 4);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('workouts[3].dayNumber must be between 0 and 2');
      });

      it('should reject a dayNumber beyond the stored daysPerWeek when the request does not change it', () => {
        const result = validateUpdateProgram({ workouts: rotation(4) }, 3);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('workouts[3].dayNumber must be between 0 and 2');
      });

      it('should fall back to the maximum when no daysPerWeek is known', () => {
        expect(validateUpdateProgram({ workouts: rotation(7) }).valid).toBe(true);

        const tooMany = validateUpdateProgram({ workouts: rotation(8) });
        expect(tooMany.valid).toBe(false);
        expect(tooMany.errors).toContain('workouts[7].dayNumber must be between 0 and 6');
      });

      it('should reject duplicate dayNumber values', () => {
        const result = validateUpdateProgram({
          workouts: [{ dayNumber: 0, templateId }, { dayNumber: 0, templateId }]
        }, 3);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('is duplicated'))).toBe(true);
      });

      it('should reject an invalid templateId', () => {
        const result = validateUpdateProgram({
          workouts: [{ dayNumber: 0, templateId: 'not-a-uuid' }]
        }, 3);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('templateId must be a valid UUID'))).toBe(true);
      });

      it('should reject an empty workouts array', () => {
        const result = validateUpdateProgram({ name: 'New Name', workouts: [] }, 3);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('workouts array cannot be empty');
      });

      it('should reject null or non-array workouts instead of treating them as absent', () => {
        // "Absent" means "leave the rotation alone", so ambiguous input must not pass as absent
        for (const workouts of [null, 'nope', {}, 3]) {
          const result = validateUpdateProgram({ daysPerWeek: 2, workouts }, 4);

          expect(result.valid).toBe(false);
          expect(result.errors).toContain('workouts must be an array');
        }
      });

      it('should not report workouts when they are not sent', () => {
        const result = validateUpdateProgram({ daysPerWeek: 3 }, 4);

        expect(result.valid).toBe(true);
        expect(result.sanitized).toEqual({ daysPerWeek: 3 });
      });
    });
  });

  describe('planProgramUpdate', () => {
    const templateId = '12345678-1234-1234-1234-123456789abc';
    const rotation = (days: number) =>
      Array.from({ length: days }, (_, dayNumber) => ({ dayNumber, templateId }));
    const fourDayProgram = { daysPerWeek: 4, currentDayIndex: 0 };

    it('should replace the rotation when removing a day (4 -> 3 with workouts)', () => {
      const workouts = rotation(3);
      const plan = planProgramUpdate(fourDayProgram, { daysPerWeek: 3, workouts });

      expect(plan.replaceWorkouts).toBe(workouts);
      expect(plan.trimFromDay).toBeUndefined();
      expect(plan.set.daysPerWeek).toBe(3);
    });

    it('should replace the rotation when adding a day (4 -> 5 with workouts)', () => {
      const plan = planProgramUpdate(fourDayProgram, { daysPerWeek: 5, workouts: rotation(5) });

      expect(plan.replaceWorkouts).toHaveLength(5);
      expect(plan.trimFromDay).toBeUndefined();
      expect(plan.set.daysPerWeek).toBe(5);
    });

    it('should check workouts against the stored daysPerWeek when the request does not change it', () => {
      const plan = planProgramUpdate(fourDayProgram, { workouts: rotation(4) });

      expect(plan.replaceWorkouts).toHaveLength(4);
      expect(plan.set.daysPerWeek).toBeUndefined();

      expect(() => planProgramUpdate(fourDayProgram, { workouts: rotation(5) }))
        .toThrow(ProgramValidationError);
    });

    it('should refuse workouts that do not fit the new daysPerWeek', () => {
      expect(() => planProgramUpdate(fourDayProgram, { daysPerWeek: 3, workouts: rotation(4) }))
        .toThrow('Workout dayNumber 3 does not fit a program with 3 days per week (dayNumber must be between 0 and 2)');
    });

    it('should refuse a negative dayNumber', () => {
      expect(() => planProgramUpdate(fourDayProgram, { workouts: [{ dayNumber: -1, templateId }] }))
        .toThrow(ProgramValidationError);
    });

    it('should drop the days that no longer fit when daysPerWeek goes down without workouts', () => {
      // What older app builds send first: metadata only, rotation in a second request
      const plan = planProgramUpdate(fourDayProgram, { name: 'Push / Pull / Legs', daysPerWeek: 3 });

      expect(plan.trimFromDay).toBe(3);
      expect(plan.replaceWorkouts).toBeUndefined();
      expect(plan.set.daysPerWeek).toBe(3);
      expect(plan.set.name).toBe('Push / Pull / Legs');
    });

    it('should leave the rotation alone when daysPerWeek is unchanged, higher, or not sent', () => {
      for (const updates of [{ daysPerWeek: 4 }, { daysPerWeek: 5 }, { name: 'Renamed' }]) {
        const plan = planProgramUpdate(fourDayProgram, updates);

        expect(plan.trimFromDay).toBeUndefined();
        expect(plan.replaceWorkouts).toBeUndefined();
      }
    });

    it('should reset currentDayIndex only when it would fall outside the new rotation', () => {
      // Pointing at day 3, which a 3-day rotation no longer has
      expect(planProgramUpdate({ daysPerWeek: 4, currentDayIndex: 3 }, { daysPerWeek: 3 }).set.currentDayIndex).toBe(0);
      expect(planProgramUpdate({ daysPerWeek: 4, currentDayIndex: 3 }, { daysPerWeek: 3, workouts: rotation(3) }).set.currentDayIndex).toBe(0);

      // Still inside the rotation: progress is left untouched
      expect(planProgramUpdate({ daysPerWeek: 4, currentDayIndex: 2 }, { daysPerWeek: 3 }).set).not.toHaveProperty('currentDayIndex');
      expect(planProgramUpdate({ daysPerWeek: 4, currentDayIndex: 3 }, { daysPerWeek: 5 }).set).not.toHaveProperty('currentDayIndex');
      expect(planProgramUpdate({ daysPerWeek: 4, currentDayIndex: 3 }, { name: 'Renamed' }).set).not.toHaveProperty('currentDayIndex');
    });

    it('should carry metadata changes and always bump updatedAt', () => {
      const plan = planProgramUpdate(fourDayProgram, { name: 'New', description: '', durationWeeks: null });

      expect(plan.set.name).toBe('New');
      expect(plan.set.description).toBeNull(); // empty string clears the description
      expect(plan.set.durationWeeks).toBeNull(); // null makes the program indefinite
      expect(plan.set.updatedAt).toBeInstanceOf(Date);
      expect(plan.set).not.toHaveProperty('daysPerWeek');
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
