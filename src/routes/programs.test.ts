// Route-level tests for the program write endpoints.
//
// The real router and the real request validation run over HTTP (express on a free port,
// called with Node's fetch). Auth, the user lookup and the service are replaced, so these
// tests pin down what the routes do with a request: what reaches the service, and which
// status and message each outcome becomes.

jest.mock('../config', () => ({ config: { env: 'test' } }));

jest.mock('../middleware/auth', () => ({
  firebaseAuthMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { uid: 'firebase-uid' };
    next();
  },
}));

jest.mock('../services/userService', () => ({
  getOrCreateUser: jest.fn(async () => ({ id: 'user-1' })),
}));

jest.mock('../services/programService', () => {
  // The router's `instanceof` check and the tests share this one class
  class ProgramValidationError extends Error {}
  return {
    ProgramValidationError,
    getPrograms: jest.fn(),
    getProgramById: jest.fn(),
    getActiveProgram: jest.fn(),
    createProgram: jest.fn(),
    updateProgram: jest.fn(),
    deleteProgram: jest.fn(),
    updateProgramWorkouts: jest.fn(),
    activateProgram: jest.fn(),
    deactivateProgram: jest.fn(),
    advanceDay: jest.fn(),
    resetProgress: jest.fn(),
    verifyProgramOwnership: jest.fn(),
  };
});

import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import programRoutes from './programs';
import {
  updateProgram,
  updateProgramWorkouts,
  createProgram,
  verifyProgramOwnership,
  ProgramValidationError,
} from '../services/programService';

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rotation = (days: number) =>
  Array.from({ length: days }, (_, dayNumber) => ({ dayNumber, templateId: TEMPLATE_ID }));

const mockUpdateProgram = updateProgram as jest.Mock;
const mockUpdateProgramWorkouts = updateProgramWorkouts as jest.Mock;
const mockCreateProgram = createProgram as jest.Mock;
const mockVerifyOwnership = verifyProgramOwnership as jest.Mock;

describe('program write routes', () => {
  let server: Server;
  let base: string;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = express();
    app.use(express.json());
    app.use('/api/programs', programRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/programs`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // The caller owns a stored 4-day program
    mockVerifyOwnership.mockResolvedValue({ id: PROGRAM_ID, daysPerWeek: 4 });
    mockUpdateProgram.mockResolvedValue({ id: PROGRAM_ID, daysPerWeek: 3, workouts: [] });
  });

  const send = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, any> };
  };

  describe('PUT /:id', () => {
    it('removes a day in one request: daysPerWeek 3 and three workouts on a stored 4-day program', async () => {
      const res = await send('PUT', `/${PROGRAM_ID}`, { name: 'PPL', daysPerWeek: 3, workouts: rotation(3) });

      expect(res.status).toBe(200);
      expect(res.body.data.program).toMatchObject({ id: PROGRAM_ID, daysPerWeek: 3 });
      // Day count and rotation reach the service together, with the request's correlation id
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        PROGRAM_ID,
        'user-1',
        { name: 'PPL', daysPerWeek: 3, workouts: rotation(3).map(w => ({ ...w, dayLabel: undefined })) },
        expect.any(String)
      );
    });

    it('accepts the metadata-only request older app builds send first (4 -> 3, no workouts)', async () => {
      const res = await send('PUT', `/${PROGRAM_ID}`, { name: 'PPL', daysPerWeek: 3 });

      expect(res.status).toBe(200);
      expect(mockUpdateProgram).toHaveBeenCalledWith(PROGRAM_ID, 'user-1', { name: 'PPL', daysPerWeek: 3 }, expect.any(String));
    });

    it('validates workouts against the stored daysPerWeek when the request does not change it', async () => {
      mockVerifyOwnership.mockResolvedValue({ id: PROGRAM_ID, daysPerWeek: 3 });

      const res = await send('PUT', `/${PROGRAM_ID}`, { workouts: rotation(4) });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid request data');
      expect(mockUpdateProgram).not.toHaveBeenCalled();
    });

    it('rejects a body with no known field, and unknown fields', async () => {
      for (const body of [{}, { bogus: true }]) {
        const res = await send('PUT', `/${PROGRAM_ID}`, body);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid request data');
      }
      expect(mockUpdateProgram).not.toHaveBeenCalled();
    });

    it('rejects a program id that is not a UUID', async () => {
      const res = await send('PUT', '/not-a-uuid', { name: 'PPL' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid program ID format');
      expect(mockVerifyOwnership).not.toHaveBeenCalled();
    });

    it('answers 404 when the program is not the caller\'s, before looking at the body', async () => {
      mockVerifyOwnership.mockResolvedValue(null);

      for (const body of [{ daysPerWeek: 1, workouts: rotation(1) }, { bogus: true }]) {
        const res = await send('PUT', `/${PROGRAM_ID}`, body);

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Program not found');
      }
      expect(mockVerifyOwnership).toHaveBeenCalledWith(PROGRAM_ID, 'user-1');
      expect(mockUpdateProgram).not.toHaveBeenCalled();
    });

    it('answers 404 when the program disappears before the service writes', async () => {
      mockUpdateProgram.mockResolvedValue(null);

      const res = await send('PUT', `/${PROGRAM_ID}`, { name: 'PPL' });

      expect(res.status).toBe(404);
    });

    it('answers 500 without passing on the message of an unexpected failure', async () => {
      mockUpdateProgram.mockRejectedValue(new Error('connection refused'));

      const res = await send('PUT', `/${PROGRAM_ID}`, { daysPerWeek: 3, workouts: rotation(3) });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Failed to update program');
    });
  });

  it.each([
    ['PUT', `/${PROGRAM_ID}`, { daysPerWeek: 3, workouts: rotation(3) }, mockUpdateProgram],
    ['PUT', `/${PROGRAM_ID}/workouts`, { workouts: rotation(3) }, mockUpdateProgramWorkouts],
    ['POST', '/', { name: 'PPL', daysPerWeek: 3, workouts: rotation(3) }, mockCreateProgram],
  ] as const)('%s %s answers 400 with the message of a ProgramValidationError', async (method, path, body, service) => {
    service.mockRejectedValue(new ProgramValidationError(`Templates not found or not owned by user: ${TEMPLATE_ID}`));

    const res = await send(method, path, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Templates not found or not owned by user: ${TEMPLATE_ID}`);
  });
});
