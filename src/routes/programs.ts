import { Router, Response, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import {
  getPrograms,
  getProgramById,
  getActiveProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  updateProgramWorkouts,
  activateProgram,
  deactivateProgram,
  advanceDay,
  resetProgress,
  verifyProgramOwnership,
} from '../services/programService';
import { ProgramListQuery } from '../models/program.types';
import {
  validateProgramListQuery,
  validateCreateProgram,
  validateUpdateProgram,
  validateProgramWorkouts,
  isValidUuid,
} from '../utils/validation';
import {
  generateCorrelationId,
  logError,
  logInfo,
  sendErrorResponse,
} from '../utils/errorResponse';
import { config } from '../config';

const router = Router();
const isDevelopment = config.env === 'development';

// ============ Helpers ============

/**
 * Extract correlation ID from request
 */
function getCorrelationId(req: Request): string {
  return (req as Request & { correlationId?: string }).correlationId || generateCorrelationId();
}

// ============ Rate Limiting ============

// Rate limiter for write operations (POST, PUT, DELETE)
const programWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 200 : 50, // 50 program write operations per hour
  message: {
    success: false,
    message: 'Too many program operations, please try again later',
    correlationId: 'rate-limit-program'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============ Middleware ============

// All routes require authentication
router.use(firebaseAuthMiddleware);

// ============ Read Routes (no rate limiting) ============

/**
 * GET /api/programs
 * List user's programs with pagination
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Validate query parameters
    const validation = validateProgramListQuery(req.query as Record<string, unknown>);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid query parameters', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    // Build query with defaults
    const query: ProgramListQuery = {
      cursor: validation.sanitized?.cursor,
      limit: validation.sanitized?.limit,
      sort: validation.sanitized?.sort || 'createdAt',
      order: validation.sanitized?.order || 'desc'
    };

    const result = await getPrograms(user.id, query);

    res.json({
      success: true,
      data: result,
      correlationId
    });
  } catch (error) {
    logError('GET /api/programs', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch programs', error, correlationId);
  }
});

/**
 * GET /api/programs/active
 * Get the user's active program with next workout info
 */
router.get('/active', async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Get user
    const user = await getOrCreateUser(req.user!);

    const result = await getActiveProgram(user.id);

    if (!result) {
      res.status(404).json({
        success: false,
        message: 'No active program found',
        correlationId
      });
      return;
    }

    res.json({
      success: true,
      data: result,
      correlationId
    });
  } catch (error) {
    logError('GET /api/programs/active', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch active program', error, correlationId);
  }
});

/**
 * GET /api/programs/:id
 * Get program with all workouts
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await getProgramById(id, user.id);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('GET /api/programs/:id', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to fetch program', error, correlationId);
  }
});

// ============ Write Routes (with rate limiting) ============

/**
 * POST /api/programs
 * Create a new program with workouts
 */
router.post('/', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Validate request body
    const validation = validateCreateProgram(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await createProgram(user.id, validation.sanitized!);

    logInfo('POST /api/programs', 'Program created', correlationId, {
      userId: user.id,
      programId: program.id
    });

    res.status(201).json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('POST /api/programs', error, correlationId);

    // Handle specific errors
    if (error instanceof Error && error.message.includes('Templates not found')) {
      sendErrorResponse(res, 400, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to create program', error, correlationId);
  }
});

/**
 * PUT /api/programs/:id
 * Update program metadata (name, description, daysPerWeek, durationWeeks)
 */
router.put('/:id', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Validate request body
    const validation = validateUpdateProgram(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await updateProgram(id, user.id, validation.sanitized!);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('PUT /api/programs/:id', 'Program updated', correlationId, {
      userId: user.id,
      programId: id
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('PUT /api/programs/:id', error, correlationId, { programId: req.params.id });

    // Handle daysPerWeek reduction error (would orphan workouts)
    if (error instanceof Error && error.message.includes('Cannot reduce daysPerWeek')) {
      sendErrorResponse(res, 400, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to update program', error, correlationId);
  }
});

/**
 * DELETE /api/programs/:id
 * Delete program (workouts cascade, templates preserved)
 */
router.delete('/:id', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const deleted = await deleteProgram(id, user.id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('DELETE /api/programs/:id', 'Program deleted', correlationId, {
      userId: user.id,
      programId: id
    });

    res.json({
      success: true,
      message: 'Program deleted successfully',
      correlationId
    });
  } catch (error) {
    logError('DELETE /api/programs/:id', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to delete program', error, correlationId);
  }
});

/**
 * PUT /api/programs/:id/workouts
 * Bulk update/replace program workouts
 */
router.put('/:id/workouts', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    // First fetch the program to get daysPerWeek for validation
    const existingProgram = await verifyProgramOwnership(id, user.id);
    if (!existingProgram) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    // Validate request body with the program's daysPerWeek
    const validation = validateProgramWorkouts(req.body, existingProgram.daysPerWeek);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    const program = await updateProgramWorkouts(id, user.id, validation.sanitized!.workouts);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('PUT /api/programs/:id/workouts', 'Program workouts updated', correlationId, {
      userId: user.id,
      programId: id,
      workoutCount: validation.sanitized!.workouts.length
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('PUT /api/programs/:id/workouts', error, correlationId, { programId: req.params.id });

    // Handle specific errors
    if (error instanceof Error && error.message.includes('Templates not found')) {
      sendErrorResponse(res, 400, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to update program workouts', error, correlationId);
  }
});

/**
 * POST /api/programs/:id/activate
 * Set program as active (deactivates any other active program)
 */
router.post('/:id/activate', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await activateProgram(id, user.id);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('POST /api/programs/:id/activate', 'Program activated', correlationId, {
      userId: user.id,
      programId: id
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('POST /api/programs/:id/activate', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to activate program', error, correlationId);
  }
});

/**
 * POST /api/programs/:id/deactivate
 * Remove active status from program
 */
router.post('/:id/deactivate', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await deactivateProgram(id, user.id);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('POST /api/programs/:id/deactivate', 'Program deactivated', correlationId, {
      userId: user.id,
      programId: id
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('POST /api/programs/:id/deactivate', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to deactivate program', error, correlationId);
  }
});

/**
 * POST /api/programs/:id/advance
 * Advance to the next day in the program rotation
 */
router.post('/:id/advance', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await advanceDay(id, user.id);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('POST /api/programs/:id/advance', 'Program day advanced', correlationId, {
      userId: user.id,
      programId: id,
      newDayIndex: program.currentDayIndex,
      timesCompleted: program.timesCompleted
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('POST /api/programs/:id/advance', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to advance program day', error, correlationId);
  }
});

/**
 * POST /api/programs/:id/reset
 * Reset program progress to day 0
 */
router.post('/:id/reset', programWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid program ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const program = await resetProgress(id, user.id);

    if (!program) {
      res.status(404).json({
        success: false,
        message: 'Program not found',
        correlationId
      });
      return;
    }

    logInfo('POST /api/programs/:id/reset', 'Program progress reset', correlationId, {
      userId: user.id,
      programId: id
    });

    res.json({
      success: true,
      data: { program },
      correlationId
    });
  } catch (error) {
    logError('POST /api/programs/:id/reset', error, correlationId, { programId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to reset program progress', error, correlationId);
  }
});

export default router;
