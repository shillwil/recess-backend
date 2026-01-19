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

const router = Router();

// Valid sort options
const VALID_SORTS: ExerciseSortOption[] = ['name', 'popularity', 'recently_used', 'difficulty'];

/**
 * GET /api/exercises
 * List exercises with pagination, filtering, and search
 * Public endpoint with optional auth for personalization
 */
router.get('/', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Parse query parameters
    const query: ExerciseListQuery = {
      cursor: req.query.cursor as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      muscleGroup: req.query.muscleGroup as string | string[] | undefined,
      difficulty: req.query.difficulty as any,
      equipment: req.query.equipment as string | string[] | undefined,
      movementPattern: req.query.movementPattern as any,
      exerciseType: req.query.exerciseType as any,
      search: req.query.search as string | undefined,
      sort: (req.query.sort as ExerciseSortOption) || 'name',
      order: (req.query.order as 'asc' | 'desc') || 'asc'
    };

    // Validate sort option
    if (query.sort && !VALID_SORTS.includes(query.sort)) {
      res.status(400).json({
        success: false,
        message: `Invalid sort option. Valid options: ${VALID_SORTS.join(', ')}`
      });
      return;
    }

    // Validate order
    if (query.order && !['asc', 'desc'].includes(query.order)) {
      res.status(400).json({
        success: false,
        message: 'Invalid order option. Valid options: asc, desc'
      });
      return;
    }

    // Get user ID if authenticated (for recently_used sort)
    let userId: string | undefined;
    if (req.user) {
      try {
        const user = await getOrCreateUser(req.user);
        userId = user.id;
      } catch (error) {
        // Continue without user context
        console.warn('Failed to get user for exercise list:', error);
      }
    }

    // Check if recently_used sort requires auth
    if (query.sort === 'recently_used' && !userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required for "recently_used" sort option'
      });
      return;
    }

    const result = await getExercises(query, userId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error in GET /api/exercises:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exercises',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/exercises/filters
 * Get filter metadata with counts
 * Public endpoint
 */
router.get('/filters', async (req: Request, res: Response) => {
  try {
    const metadata = await getFilterMetadata();

    res.json({
      success: true,
      filters: metadata
    });
  } catch (error) {
    console.error('Error in GET /api/exercises/filters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch filter metadata',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/exercises/:id
 * Get single exercise details
 * Public endpoint
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
      return;
    }

    const exercise = await getExerciseById(id);

    if (!exercise) {
      res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
      return;
    }

    res.json({
      success: true,
      exercise
    });
  } catch (error) {
    console.error('Error in GET /api/exercises/:id:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exercise',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
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
    try {
      const { id } = req.params;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid exercise ID format'
        });
        return;
      }

      const user = await getOrCreateUser(req.user!);
      await recordExerciseUsage(user.id, id);

      res.json({
        success: true,
        message: 'Exercise usage recorded'
      });
    } catch (error) {
      console.error('Error in POST /api/exercises/:id/record-usage:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to record exercise usage',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;
