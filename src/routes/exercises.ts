import { Router, Request, Response } from 'express';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { optionalAuthMiddleware } from '../middleware/optionalAuth';
import { getOrCreateUser } from '../services/userService';
import {
  getExercises,
  getExerciseById,
  getFilterMetadata,
  recordExerciseUsage
} from '../services/exerciseService';
import { ExerciseListQuery, ExerciseSortOption } from '../models/exercise.types';
import { validateExerciseListQuery } from '../utils/validation';
import {
  generateCorrelationId,
  logError,
  logWarn,
  sendErrorResponse
} from '../utils/errorResponse';

const router = Router();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates UUID format
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * GET /api/exercises
 * List exercises with pagination, filtering, and search
 * Public endpoint with optional auth for personalization
 */
router.get('/', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId || generateCorrelationId();
  try {
    // Validate and sanitize query parameters
    const validation = validateExerciseListQuery(req.query as Record<string, unknown>);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid query parameters', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Build validated query with defaults
    const query: ExerciseListQuery = {
      cursor: validation.sanitized?.cursor,
      limit: validation.sanitized?.limit,
      muscleGroup: validation.sanitized?.muscleGroup,
      difficulty: validation.sanitized?.difficulty,
      equipment: validation.sanitized?.equipment,
      movementPattern: validation.sanitized?.movementPattern,
      exerciseType: validation.sanitized?.exerciseType,
      search: validation.sanitized?.search,
      sort: validation.sanitized?.sort || 'name',
      order: validation.sanitized?.order || 'asc'
    };

    // Get user ID if authenticated (for recently_used sort)
    let userId: string | undefined;
    if (req.user) {
      try {
        const user = await getOrCreateUser(req.user);
        userId = user.id;
      } catch (error) {
        // Log the error but continue without user context for non-personalized features
        logWarn('GET /api/exercises', 'Failed to get user context, continuing without personalization', correlationId, {
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
        // If user auth was attempted but failed with a real error (not just missing user),
        // and they need user-specific features, we should handle that
        if (query.sort === 'recently_used') {
          // For recently_used, we need auth - re-throw to trigger proper error
          throw new Error('User authentication required for recently_used sort');
        }
      }
    }

    // Check if recently_used sort requires auth
    if (query.sort === 'recently_used' && !userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required for "recently_used" sort option',
        correlationId
      });
      return;
    }

    const result = await getExercises(query, userId);

    res.json({
      success: true,
      data: result,
      correlationId
    });
  } catch (error) {
    logError('GET /api/exercises', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch exercises', error, correlationId);
  }
});

/**
 * GET /api/exercises/filters
 * Get filter metadata with counts
 * Public endpoint
 */
router.get('/filters', async (req: Request, res: Response) => {
  const correlationId = (req as Request & { correlationId: string }).correlationId || generateCorrelationId();
  try {
    const metadata = await getFilterMetadata();

    res.json({
      success: true,
      data: { filters: metadata },
      correlationId
    });
  } catch (error) {
    logError('GET /api/exercises/filters', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch filter metadata', error, correlationId);
  }
});

/**
 * GET /api/exercises/:id
 * Get single exercise details
 * Public endpoint
 */
router.get('/:id', async (req: Request, res: Response) => {
  const correlationId = (req as Request & { correlationId: string }).correlationId || generateCorrelationId();
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid exercise ID format', undefined, correlationId);
      return;
    }

    const exercise = await getExerciseById(id);

    if (!exercise) {
      res.status(404).json({
        success: false,
        message: 'Exercise not found',
        correlationId
      });
      return;
    }

    res.json({
      success: true,
      data: { exercise },
      correlationId
    });
  } catch (error) {
    logError('GET /api/exercises/:id', error, correlationId, { exerciseId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to fetch exercise', error, correlationId);
  }
});

/**
 * POST /api/exercises/:id/record-usage
 * Record that a user used an exercise (for recently_used sorting)
 * Requires authentication
 */
router.post(
  '/:id/record-usage',
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId || generateCorrelationId();
    try {
      const { id } = req.params;

      if (!isValidUuid(id)) {
        sendErrorResponse(res, 400, 'Invalid exercise ID format', undefined, correlationId);
        return;
      }

      const user = await getOrCreateUser(req.user!);
      await recordExerciseUsage(user.id, id);

      res.json({
        success: true,
        message: 'Exercise usage recorded',
        correlationId
      });
    } catch (error) {
      logError('POST /api/exercises/:id/record-usage', error, correlationId, { exerciseId: req.params.id });
      sendErrorResponse(res, 500, 'Failed to record exercise usage', error, correlationId);
    }
  }
);

export default router;
