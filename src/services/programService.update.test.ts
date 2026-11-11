// Wiring tests for the functions that write a program inside a transaction.
//
// The database is replaced by recording fakes, so these tests pin down WHICH statements
// run, in what order, and through which handle (the transaction, not the global db).
// They cannot prove the SQL itself; the rules are covered in programService.test.ts
// (planProgramUpdate).

jest.mock('../db', () => ({
  db: {
    select: jest.fn(),
    transaction: jest.fn(),
  }
}));

// Named markers instead of real tables, so assertions can say which table/column was used
jest.mock('../db/schema', () => ({
  workoutPrograms: { table: 'workout_programs', id: 'workout_programs.id', userId: 'workout_programs.user_id' },
  programWeeks: {
    table: 'program_weeks',
    id: 'program_weeks.id',
    programId: 'program_weeks.program_id',
    dayNumber: 'program_weeks.day_number',
    dayLabel: 'program_weeks.day_label',
    templateId: 'program_weeks.template_id',
  },
  workoutTemplates: {
    table: 'workout_templates',
    id: 'workout_templates.id',
    userId: 'workout_templates.user_id',
    name: 'workout_templates.name',
    description: 'workout_templates.description',
  },
  templateExercises: { table: 'template_exercises', templateId: 'template_exercises.template_id' },
}));

// Mock drizzle-orm operators so query conditions can be inspected without a real connection
jest.mock('drizzle-orm', () => ({
  eq: jest.fn((column, value) => ({ op: 'eq', column, value })),
  gte: jest.fn((column, value) => ({ op: 'gte', column, value })),
  and: jest.fn((...conditions) => ({ op: 'and', conditions })),
  inArray: jest.fn((column, values) => ({ op: 'inArray', column, values })),
  asc: jest.fn((column) => column),
  desc: jest.fn((column) => column),
  ne: jest.fn(),
  sql: jest.fn(),
}));

jest.mock('../utils/errorResponse', () => ({
  logInfo: jest.fn(),
}));

import { db } from '../db';
import { programWeeks, workoutPrograms, workoutTemplates } from '../db/schema';
import { logInfo } from '../utils/errorResponse';
import {
  advanceDay,
  createProgram,
  updateProgram,
  updateProgramWorkouts,
  ProgramValidationError,
} from './programService';

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATES = {
  push: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pull: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  legs: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  arms: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

type Query = { [method: string]: jest.Mock } & PromiseLike<unknown>;

/**
 * A stand-in for a drizzle query builder: every builder method returns the same object,
 * and awaiting it yields `result` (or rejects with `error`).
 */
function query(result: unknown = undefined, error?: Error): Query {
  const q = {} as Query;
  for (const method of ['from', 'where', 'limit', 'innerJoin', 'orderBy', 'groupBy', 'for', 'values', 'set', 'returning']) {
    q[method] = jest.fn(() => q);
  }
  (q as { then: PromiseLike<unknown>['then'] }).then = (onFulfilled, onRejected) =>
    (error ? Promise.reject(error) : Promise.resolve(result)).then(onFulfilled, onRejected);
  return q;
}

const mockDb = db as unknown as { select: jest.Mock; transaction: jest.Mock };
const mockLogInfo = logInfo as jest.Mock;

/** The stored program as the locked SELECT returns it */
function storedProgram(
  overrides: Partial<{ daysPerWeek: number; currentDayIndex: number; timesCompleted: number }> = {}
) {
  return {
    id: PROGRAM_ID,
    userId: USER_ID,
    name: 'Push / Pull / Legs',
    description: null,
    daysPerWeek: 4,
    durationWeeks: null,
    isActive: true,
    currentDayIndex: 0,
    timesCompleted: 0,
    isPublic: false,
    isAiGenerated: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const rotation = (...templateIds: string[]) =>
  templateIds.map((templateId, dayNumber) => ({ dayNumber, templateId }));

describe('programService program writes', () => {
  /** Order in which the transaction's statements ran */
  let statements: string[];
  let lockQuery: Query;
  let deleteQuery: Query;
  let insertQuery: Query;
  let updateQuery: Query;
  let tx: { select: jest.Mock; delete: jest.Mock; insert: jest.Mock; update: jest.Mock };

  /**
   * @param locked rows the locking SELECT returns ([] = program missing or not owned)
   * @param trimmedRows rows a `DELETE ... RETURNING` reports
   * @param failures statements that reject instead of succeeding
   */
  function arrangeTransaction(
    locked: unknown[],
    trimmedRows: unknown[] = [],
    failures: { insert?: Error; update?: Error } = {}
  ) {
    statements = [];
    lockQuery = query(locked);
    deleteQuery = query(trimmedRows);
    insertQuery = query(undefined, failures.insert);
    updateQuery = query(undefined, failures.update);
    tx = {
      select: jest.fn(() => { statements.push('lock'); return lockQuery; }),
      delete: jest.fn(() => { statements.push('delete'); return deleteQuery; }),
      insert: jest.fn(() => { statements.push('insert'); return insertQuery; }),
      update: jest.fn(() => { statements.push('update'); return updateQuery; }),
    };
    mockDb.transaction.mockImplementation(async (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx));
  }

  /**
   * Results for the queries that run on the global db, in call order.
   * Any read beyond the ones listed finds no rows.
   */
  function arrangeDbSelects(...results: unknown[][]) {
    mockDb.select.mockReset();
    mockDb.select.mockImplementation(() => query([]));
    for (const result of results) {
      mockDb.select.mockImplementationOnce(() => query(result));
    }
  }

  /** Tables the global db was asked to read from, in call order */
  const tablesReadOutsideTransaction = () =>
    mockDb.select.mock.results.map(result => (result.value as Query).from.mock.calls[0]?.[0]);

  /** The lock is taken on the program row, scoped to its owner, with FOR UPDATE */
  function expectOwnerScopedLock() {
    expect(lockQuery.from).toHaveBeenCalledWith(workoutPrograms);
    expect(lockQuery.where).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', column: workoutPrograms.id, value: PROGRAM_ID },
        { op: 'eq', column: workoutPrograms.userId, value: USER_ID },
      ],
    });
    expect(lockQuery.for).toHaveBeenCalledWith('update');
  }

  const ownedTemplates = (...ids: string[]) => ids.map(id => ({ id }));
  /** What getProgramById reads after the transaction: the program row, then its (empty) rotation */
  const reloadedProgram = (overrides: Parameters<typeof storedProgram>[0] = {}) => [[storedProgram(overrides)], []];

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.transaction.mockReset();
    arrangeDbSelects();
  });

  describe('updateProgram', () => {
    it('removes a day in one transaction: lock, replace the rotation, then update the program', async () => {
      // The reported bug: a 4-day plan saved with one day deleted
      const workouts = [
        { dayNumber: 0, templateId: TEMPLATES.push, dayLabel: 'Push' },
        { dayNumber: 1, templateId: TEMPLATES.legs, dayLabel: 'Legs' },
        { dayNumber: 2, templateId: TEMPLATES.pull },
      ];
      arrangeDbSelects(
        ownedTemplates(TEMPLATES.push, TEMPLATES.legs, TEMPLATES.pull),
        ...reloadedProgram({ daysPerWeek: 3 })
      );
      arrangeTransaction([storedProgram({ daysPerWeek: 4, currentDayIndex: 3 })]);

      const result = await updateProgram(PROGRAM_ID, USER_ID, { name: 'Push / Pull / Legs', daysPerWeek: 3, workouts });

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(statements).toEqual(['lock', 'delete', 'insert', 'update']);

      // The templates are looked up among the caller's own, not by id alone
      const templateQuery = mockDb.select.mock.results[0].value as Query;
      expect(templateQuery.from).toHaveBeenCalledWith(workoutTemplates);
      expect(templateQuery.where).toHaveBeenCalledWith({
        op: 'and',
        conditions: [
          { op: 'inArray', column: workoutTemplates.id, values: [TEMPLATES.push, TEMPLATES.legs, TEMPLATES.pull] },
          { op: 'eq', column: workoutTemplates.userId, value: USER_ID },
        ],
      });

      expectOwnerScopedLock();

      // Every stored day goes, not just the ones past the new daysPerWeek
      expect(tx.delete).toHaveBeenCalledWith(programWeeks);
      expect(deleteQuery.where).toHaveBeenCalledWith({ op: 'eq', column: programWeeks.programId, value: PROGRAM_ID });

      expect(tx.insert).toHaveBeenCalledWith(programWeeks);
      expect(insertQuery.values).toHaveBeenCalledWith([
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 0, templateId: TEMPLATES.push, dayLabel: 'Push' },
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 1, templateId: TEMPLATES.legs, dayLabel: 'Legs' },
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 2, templateId: TEMPLATES.pull, dayLabel: null },
      ]);

      expect(tx.update).toHaveBeenCalledWith(workoutPrograms);
      expect(updateQuery.set).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Push / Pull / Legs',
        daysPerWeek: 3,
        currentDayIndex: 0, // was on day 3, which no longer exists
      }));
      expect(updateQuery.where).toHaveBeenCalledWith({ op: 'eq', column: workoutPrograms.id, value: PROGRAM_ID });

      expect(result).toMatchObject({ id: PROGRAM_ID, daysPerWeek: 3 });
      expect(mockLogInfo).not.toHaveBeenCalled();
    });

    it('drops only the days that no longer fit when daysPerWeek goes down without workouts', async () => {
      // What older app builds send first; they follow up with PUT /:id/workouts
      const dropped = [{ id: 'row-3', programId: PROGRAM_ID, weekNumber: 1, dayNumber: 3, templateId: TEMPLATES.arms, dayLabel: 'Arms', createdAt: new Date() }];
      arrangeDbSelects(...reloadedProgram({ daysPerWeek: 3 }));
      arrangeTransaction([storedProgram({ daysPerWeek: 4 })], dropped);

      await updateProgram(PROGRAM_ID, USER_ID, { name: 'Push / Pull / Legs', daysPerWeek: 3 }, 'req_test');

      expect(statements).toEqual(['lock', 'delete', 'update']);
      expect(deleteQuery.where).toHaveBeenCalledWith({
        op: 'and',
        conditions: [
          { op: 'eq', column: programWeeks.programId, value: PROGRAM_ID },
          { op: 'gte', column: programWeeks.dayNumber, value: 3 },
        ],
      });
      expect(updateQuery.set).toHaveBeenCalledWith(expect.objectContaining({ daysPerWeek: 3 }));

      // The dropped days are logged so they can be traced if the follow-up request never arrives
      expect(mockLogInfo).toHaveBeenCalledTimes(1);
      expect(mockLogInfo).toHaveBeenCalledWith(
        'programService.updateProgram',
        expect.any(String),
        'req_test',
        {
          programId: PROGRAM_ID,
          previousDaysPerWeek: 4,
          daysPerWeek: 3,
          droppedDays: [{ dayNumber: 3, templateId: TEMPLATES.arms, dayLabel: 'Arms' }],
        }
      );
    });

    it('does not log when lowering daysPerWeek dropped nothing', async () => {
      arrangeDbSelects(...reloadedProgram({ daysPerWeek: 3 }));
      arrangeTransaction([storedProgram({ daysPerWeek: 4 })], []);

      await updateProgram(PROGRAM_ID, USER_ID, { daysPerWeek: 3 });

      expect(statements).toEqual(['lock', 'delete', 'update']);
      expect(mockLogInfo).not.toHaveBeenCalled();
    });

    it('does not log dropped days when the transaction fails after the delete', async () => {
      // The delete is rolled back with the rest, so a log line would describe a drop that never happened
      const dropped = [{ id: 'row-3', programId: PROGRAM_ID, weekNumber: 1, dayNumber: 3, templateId: TEMPLATES.arms, dayLabel: 'Arms', createdAt: new Date() }];
      arrangeTransaction([storedProgram({ daysPerWeek: 4 })], dropped, { update: new Error('update failed') });

      await expect(updateProgram(PROGRAM_ID, USER_ID, { daysPerWeek: 3 })).rejects.toThrow('update failed');

      expect(statements).toEqual(['lock', 'delete', 'update']);
      expect(mockLogInfo).not.toHaveBeenCalled();
    });

    it('leaves the rotation alone for a metadata-only update that does not lower daysPerWeek', async () => {
      for (const updates of [{ name: 'Renamed' }, { daysPerWeek: 4 }, { daysPerWeek: 6 }, { durationWeeks: null }]) {
        arrangeDbSelects(...reloadedProgram());
        arrangeTransaction([storedProgram({ daysPerWeek: 4 })]);

        await updateProgram(PROGRAM_ID, USER_ID, updates);

        expect(statements).toEqual(['lock', 'update']);
      }
    });

    it('returns null and writes nothing when the program is missing or owned by someone else', async () => {
      arrangeTransaction([]);

      const result = await updateProgram(PROGRAM_ID, USER_ID, { daysPerWeek: 2 });

      expect(result).toBeNull();
      expectOwnerScopedLock();
      expect(statements).toEqual(['lock']);
      expect(mockDb.select).not.toHaveBeenCalled(); // nothing is re-read either
    });

    it('refuses workouts that do not fit the daysPerWeek of the LOCKED row, and writes nothing', async () => {
      // The route validated against a 4-day program, but by the time the row is locked it has 3
      arrangeDbSelects(ownedTemplates(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs, TEMPLATES.arms));
      arrangeTransaction([storedProgram({ daysPerWeek: 3 })]);

      const save = updateProgram(PROGRAM_ID, USER_ID, {
        workouts: rotation(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs, TEMPLATES.arms),
      });

      await expect(save).rejects.toThrow(ProgramValidationError);
      await expect(save).rejects.toThrow('Workout dayNumber 3 does not fit a program with 3 days per week');
      expect(statements).toEqual(['lock']);
    });

    it('refuses templates the user does not own before opening a transaction', async () => {
      arrangeDbSelects(ownedTemplates(TEMPLATES.push)); // pull is missing
      arrangeTransaction([storedProgram()]);

      const save = updateProgram(PROGRAM_ID, USER_ID, {
        daysPerWeek: 2,
        workouts: rotation(TEMPLATES.push, TEMPLATES.pull),
      });

      await expect(save).rejects.toThrow(ProgramValidationError);
      await expect(save).rejects.toThrow(`Templates not found or not owned by user: ${TEMPLATES.pull}`);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('does not check templates when the request carries no workouts', async () => {
      arrangeDbSelects(...reloadedProgram());
      arrangeTransaction([storedProgram()]);

      await updateProgram(PROGRAM_ID, USER_ID, { name: 'Renamed' });

      // The reads on the global db are the reload, never a template lookup
      expect(tablesReadOutsideTransaction()).toEqual([workoutPrograms, programWeeks]);
    });

    it('propagates a failing statement out of the transaction callback, before the program row is written', async () => {
      arrangeDbSelects(ownedTemplates(TEMPLATES.push, TEMPLATES.pull));
      arrangeTransaction([storedProgram()], [], { insert: new Error('insert failed') });

      const save = updateProgram(PROGRAM_ID, USER_ID, {
        daysPerWeek: 2,
        workouts: rotation(TEMPLATES.push, TEMPLATES.pull),
      });

      await expect(save).rejects.toThrow('insert failed');
      // The error left the transaction callback (which is what makes drizzle roll back)
      // before the program row was touched
      expect(statements).toEqual(['lock', 'delete', 'insert']);
    });
  });

  describe('updateProgramWorkouts', () => {
    it('locks the program, replaces the rotation and bumps updatedAt', async () => {
      arrangeDbSelects(
        ownedTemplates(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs),
        ...reloadedProgram({ daysPerWeek: 3 })
      );
      arrangeTransaction([storedProgram({ daysPerWeek: 3 })]);

      const result = await updateProgramWorkouts(
        PROGRAM_ID,
        USER_ID,
        rotation(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs)
      );

      expect(statements).toEqual(['lock', 'delete', 'insert', 'update']);
      expectOwnerScopedLock();
      expect(deleteQuery.where).toHaveBeenCalledWith({ op: 'eq', column: programWeeks.programId, value: PROGRAM_ID });
      expect(insertQuery.values).toHaveBeenCalledWith([
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 0, templateId: TEMPLATES.push, dayLabel: null },
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 1, templateId: TEMPLATES.pull, dayLabel: null },
        { programId: PROGRAM_ID, weekNumber: 1, dayNumber: 2, templateId: TEMPLATES.legs, dayLabel: null },
      ]);
      expect(updateQuery.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
      expect(updateQuery.where).toHaveBeenCalledWith({ op: 'eq', column: workoutPrograms.id, value: PROGRAM_ID });
      expect(result).toMatchObject({ id: PROGRAM_ID, daysPerWeek: 3 });
    });

    it('refuses a rotation that does not fit the daysPerWeek of the LOCKED row, and writes nothing', async () => {
      // A metadata update lowered daysPerWeek to 3 after this request was validated against 4
      arrangeDbSelects(ownedTemplates(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs, TEMPLATES.arms));
      arrangeTransaction([storedProgram({ daysPerWeek: 3 })]);

      const save = updateProgramWorkouts(
        PROGRAM_ID,
        USER_ID,
        rotation(TEMPLATES.push, TEMPLATES.pull, TEMPLATES.legs, TEMPLATES.arms)
      );

      await expect(save).rejects.toThrow(ProgramValidationError);
      expect(statements).toEqual(['lock']);
    });

    it('returns null and writes nothing when the program is missing or owned by someone else', async () => {
      arrangeDbSelects(ownedTemplates(TEMPLATES.push));
      arrangeTransaction([]);

      const result = await updateProgramWorkouts(PROGRAM_ID, USER_ID, rotation(TEMPLATES.push));

      expect(result).toBeNull();
      expectOwnerScopedLock();
      expect(statements).toEqual(['lock']);
    });

    it('refuses templates the user does not own before opening a transaction', async () => {
      arrangeDbSelects([]);
      arrangeTransaction([storedProgram()]);

      await expect(updateProgramWorkouts(PROGRAM_ID, USER_ID, rotation(TEMPLATES.push)))
        .rejects.toThrow(ProgramValidationError);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('createProgram', () => {
    it('refuses templates the user does not own before opening a transaction', async () => {
      arrangeDbSelects(ownedTemplates(TEMPLATES.push)); // pull is missing
      arrangeTransaction([]);

      const create = createProgram(USER_ID, {
        name: 'Push / Pull',
        daysPerWeek: 2,
        workouts: rotation(TEMPLATES.push, TEMPLATES.pull),
      });

      await expect(create).rejects.toThrow(ProgramValidationError);
      await expect(create).rejects.toThrow(`Templates not found or not owned by user: ${TEMPLATES.pull}`);
      expect(tablesReadOutsideTransaction()[0]).toBe(workoutTemplates);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('advanceDay', () => {
    it('moves to the next day of the locked row, inside one transaction', async () => {
      arrangeDbSelects(...reloadedProgram({ daysPerWeek: 3, currentDayIndex: 2 }));
      arrangeTransaction([storedProgram({ daysPerWeek: 3, currentDayIndex: 1, timesCompleted: 2 })]);

      const result = await advanceDay(PROGRAM_ID, USER_ID);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(statements).toEqual(['lock', 'update']);
      expectOwnerScopedLock();
      expect(tx.update).toHaveBeenCalledWith(workoutPrograms);
      // Mid-rotation: the cycle count is left alone
      expect(updateQuery.set).toHaveBeenCalledWith({ currentDayIndex: 2, updatedAt: expect.any(Date) });
      expect(updateQuery.where).toHaveBeenCalledWith({ op: 'eq', column: workoutPrograms.id, value: PROGRAM_ID });
      expect(result).toMatchObject({ id: PROGRAM_ID, currentDayIndex: 2 });
    });

    it('wraps to day 0 after the last day and counts the completed cycle', async () => {
      arrangeDbSelects(...reloadedProgram({ daysPerWeek: 3 }));
      arrangeTransaction([storedProgram({ daysPerWeek: 3, currentDayIndex: 2, timesCompleted: 2 })]);

      await advanceDay(PROGRAM_ID, USER_ID);

      expect(updateQuery.set).toHaveBeenCalledWith({
        currentDayIndex: 0,
        timesCompleted: 3,
        updatedAt: expect.any(Date),
      });
    });

    it('wraps by the daysPerWeek the locked row has now, not one read earlier', async () => {
      // A save just shortened the plan from 4 days to 3 while the pointer stayed on day 2
      arrangeDbSelects(...reloadedProgram({ daysPerWeek: 3 }));
      arrangeTransaction([storedProgram({ daysPerWeek: 3, currentDayIndex: 2 })]);

      await advanceDay(PROGRAM_ID, USER_ID);

      // Only the reload ran on the global db: nothing was read before the lock
      expect(tablesReadOutsideTransaction()).toEqual([workoutPrograms, programWeeks]);
      expect(updateQuery.set).toHaveBeenCalledWith(expect.objectContaining({ currentDayIndex: 0 }));
    });

    it('returns null and writes nothing when the program is missing or owned by someone else', async () => {
      arrangeTransaction([]);

      const result = await advanceDay(PROGRAM_ID, USER_ID);

      expect(result).toBeNull();
      expectOwnerScopedLock();
      expect(statements).toEqual(['lock']);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });
});
