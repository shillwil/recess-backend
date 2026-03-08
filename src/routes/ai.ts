import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import {
  generateProgram,
  reserveAiGeneration,
  releaseAiGeneration,
  rateProgram,
  getGenerationStatus,
  AiGenerationError,
  GenerateProgramInput,
} from '../services/aiService';
import {
  upsertStrengthProfile,
  getStrengthProfile,
  ManualStrengthInput,
} from '../services/strengthProfileService';
import { VALID_EQUIPMENT, VALID_EXPERIENCE_LEVELS, VALID_GOALS } from '../config/ai';
import {
  logError,
  logInfo,
  sendErrorResponse,
  sendSuccessResponse,
} from '../utils/errorResponse';
import { isValidUuid } from '../utils/validation';

const router = Router();
const isDevelopment = process.env.NODE_ENV === 'development';

// Rate limiter for AI generation — prevents rapid-fire abuse (on top of monthly limits)
const aiGenerateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isDevelopment ? 50 : 5,
  message: {
    success: false,
    message: 'Too many generation requests. Please wait a moment before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============ Validation Helpers ============

interface ValidationError {
  valid: false;
  errors: string[];
}

interface ValidationSuccess {
  valid: true;
  sanitized: GenerateProgramInput;
}

function validateGenerateProgramInput(body: any): ValidationError | ValidationSuccess {
  const errors: string[] = [];

  // inspirationSource — required, 1-200 chars
  if (!body.inspirationSource || typeof body.inspirationSource !== 'string') {
    errors.push('inspirationSource is required and must be a string');
  } else if (body.inspirationSource.trim().length < 1 || body.inspirationSource.trim().length > 200) {
    errors.push('inspirationSource must be 1-200 characters');
  }

  // daysPerWeek — required, 1-7
  if (body.daysPerWeek === undefined || body.daysPerWeek === null) {
    errors.push('daysPerWeek is required');
  } else if (!Number.isInteger(body.daysPerWeek) || body.daysPerWeek < 1 || body.daysPerWeek > 7) {
    errors.push('daysPerWeek must be an integer between 1 and 7');
  }

  // sessionDurationMinutes — optional, 30-120
  const sessionDuration = body.sessionDurationMinutes ?? 60;
  if (!Number.isInteger(sessionDuration) || sessionDuration < 30 || sessionDuration > 120) {
    errors.push('sessionDurationMinutes must be an integer between 30 and 120');
  }

  // experienceLevel — required
  if (!body.experienceLevel || !VALID_EXPERIENCE_LEVELS.includes(body.experienceLevel)) {
    errors.push(`experienceLevel must be one of: ${VALID_EXPERIENCE_LEVELS.join(', ')}`);
  }

  // goal — required
  if (!body.goal || !VALID_GOALS.includes(body.goal)) {
    errors.push(`goal must be one of: ${VALID_GOALS.join(', ')}`);
  }

  // equipment — required, non-empty array
  if (!Array.isArray(body.equipment) || body.equipment.length === 0) {
    errors.push('equipment must be a non-empty array');
  } else {
    const invalidEquipment = body.equipment.filter((e: any) => !VALID_EQUIPMENT.includes(e));
    if (invalidEquipment.length > 0) {
      errors.push(`Invalid equipment values: ${invalidEquipment.join(', ')}. Valid values: ${VALID_EQUIPMENT.join(', ')}`);
    }
  }

  // useTrainingHistory — optional boolean
  const useTrainingHistory = body.useTrainingHistory === true;

  // manualStrengthData — optional, max 20 entries
  if (body.manualStrengthData !== undefined) {
    if (!Array.isArray(body.manualStrengthData)) {
      errors.push('manualStrengthData must be an array');
    } else if (body.manualStrengthData.length > 20) {
      errors.push('manualStrengthData must have at most 20 entries');
    } else {
      for (let i = 0; i < body.manualStrengthData.length; i++) {
        const entry = body.manualStrengthData[i];
        if (!entry.exerciseName || typeof entry.exerciseName !== 'string') {
          errors.push(`manualStrengthData[${i}].exerciseName is required`);
        }
        if (typeof entry.weight !== 'number' || entry.weight <= 0) {
          errors.push(`manualStrengthData[${i}].weight must be a positive number`);
        }
        if (entry.unit !== 'lb' && entry.unit !== 'kg') {
          errors.push(`manualStrengthData[${i}].unit must be "lb" or "kg"`);
        }
        if (!Number.isInteger(entry.reps) || entry.reps < 1 || entry.reps > 100) {
          errors.push(`manualStrengthData[${i}].reps must be an integer between 1 and 100`);
        }
        if (!Number.isInteger(entry.sets) || entry.sets < 1 || entry.sets > 20) {
          errors.push(`manualStrengthData[${i}].sets must be an integer between 1 and 20`);
        }
      }
    }
  }

  // freeTextPreferences — optional, max 500 chars
  if (body.freeTextPreferences !== undefined) {
    if (typeof body.freeTextPreferences !== 'string') {
      errors.push('freeTextPreferences must be a string');
    } else if (body.freeTextPreferences.length > 500) {
      errors.push('freeTextPreferences must be at most 500 characters');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    sanitized: {
      inspirationSource: body.inspirationSource.trim(),
      daysPerWeek: body.daysPerWeek,
      sessionDurationMinutes: sessionDuration,
      experienceLevel: body.experienceLevel,
      goal: body.goal,
      equipment: body.equipment,
      useTrainingHistory,
      manualStrengthData: body.manualStrengthData,
      freeTextPreferences: body.freeTextPreferences?.trim(),
    },
  };
}

function validateStrengthProfileInput(body: any): { valid: boolean; errors: string[]; entries?: ManualStrengthInput[] } {
  const errors: string[] = [];

  if (!Array.isArray(body.entries)) {
    return { valid: false, errors: ['entries must be an array'] };
  }

  if (body.entries.length < 1 || body.entries.length > 20) {
    errors.push('entries must have 1-20 items');
  }

  for (let i = 0; i < body.entries.length; i++) {
    const entry = body.entries[i];
    if (!entry.exerciseName || typeof entry.exerciseName !== 'string') {
      errors.push(`entries[${i}].exerciseName is required`);
    }
    if (typeof entry.weight !== 'number' || entry.weight <= 0) {
      errors.push(`entries[${i}].weight must be a positive number`);
    }
    if (entry.unit !== 'lb' && entry.unit !== 'kg') {
      errors.push(`entries[${i}].unit must be "lb" or "kg"`);
    }
    if (!Number.isInteger(entry.reps) || entry.reps < 1 || entry.reps > 100) {
      errors.push(`entries[${i}].reps must be an integer between 1 and 100`);
    }
    if (!Number.isInteger(entry.sets) || entry.sets < 1 || entry.sets > 20) {
      errors.push(`entries[${i}].sets must be an integer between 1 and 20`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    entries: body.entries.map((e: any) => ({
      exerciseName: e.exerciseName.trim(),
      weight: e.weight,
      unit: e.unit,
      reps: e.reps,
      sets: e.sets,
    })),
  };
}

// ============ Routes ============

/**
 * POST /api/ai/generate-program
 * Generate a complete workout program using AI
 */
router.post(
  '/generate-program',
  aiGenerateLimiter,
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as any).correlationId;
    try {
      // Get user
      const user = await getOrCreateUser(req.user!);

      // Validate input
      const validation = validateGenerateProgramInput(req.body);
      if (!validation.valid) {
        sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
          validationErrors: validation.errors,
        });
        return;
      }

      // Atomically check rate limit AND reserve a generation slot.
      // This prevents race conditions where concurrent requests both pass
      // the limit check before either increments the counter.
      const rateLimit = await reserveAiGeneration(user.id);
      if (!rateLimit.allowed) {
        const resetDate = rateLimit.resetsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        const message = rateLimit.tier === 'free'
          ? `You've used all ${rateLimit.limit} AI generations for this month. Resets on ${resetDate}. Upgrade to Pro for more generations.`
          : `You've used all ${rateLimit.limit} AI generations for this month. Resets on ${resetDate}.`;
        res.status(429).json({
          success: false,
          message,
          correlationId,
          data: {
            resetsAt: rateLimit.resetsAt.toISOString(),
            limit: rateLimit.limit,
            tier: rateLimit.tier,
          },
        });
        return;
      }

      // Generate program — if it fails, release the reserved slot
      let result;
      try {
        result = await generateProgram(user.id, validation.sanitized, correlationId);
      } catch (error) {
        await releaseAiGeneration(user.id);
        throw error;
      }

      res.status(201).json({
        success: true,
        data: result,
        correlationId,
      });
    } catch (error) {
      if (error instanceof AiGenerationError) {
        const responseBody: Record<string, any> = {
          success: false,
          message: error.message,
          correlationId,
        };
        if (error.retryable) {
          responseBody.retryable = true;
        }
        res.status(error.statusCode).json(responseBody);
        return;
      }

      logError('POST /api/ai/generate-program', error, correlationId);
      sendErrorResponse(res, 500, 'An unexpected error occurred', error, correlationId);
    }
  }
);

/**
 * POST /api/ai/rate-program/:programId
 * Rate an AI-generated program
 */
router.post(
  '/rate-program/:programId',
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as any).correlationId;
    try {
      const { programId } = req.params;
      if (!isValidUuid(programId)) {
        sendErrorResponse(res, 400, 'Invalid program ID', undefined, correlationId);
        return;
      }

      const user = await getOrCreateUser(req.user!);

      // Validate rating
      const { rating, feedback } = req.body;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        sendErrorResponse(res, 400, 'rating must be an integer between 1 and 5', undefined, correlationId);
        return;
      }
      if (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 500)) {
        sendErrorResponse(res, 400, 'feedback must be a string with at most 500 characters', undefined, correlationId);
        return;
      }

      await rateProgram(user.id, programId, rating, feedback);

      sendSuccessResponse(res, undefined, 'Rating saved. Thanks for the feedback!', 200, correlationId);
    } catch (error) {
      if (error instanceof AiGenerationError) {
        sendErrorResponse(res, error.statusCode, error.message, undefined, correlationId);
        return;
      }
      logError('POST /api/ai/rate-program', error, correlationId);
      sendErrorResponse(res, 500, 'Failed to save rating', error, correlationId);
    }
  }
);

/**
 * GET /api/ai/generation-status
 * Check the user's current generation limit status
 */
router.get(
  '/generation-status',
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as any).correlationId;
    try {
      const user = await getOrCreateUser(req.user!);
      const status = await getGenerationStatus(user.id);

      sendSuccessResponse(res, status, undefined, 200, correlationId);
    } catch (error) {
      logError('GET /api/ai/generation-status', error, correlationId);
      sendErrorResponse(res, 500, 'Failed to fetch generation status', error, correlationId);
    }
  }
);

/**
 * PUT /api/ai/strength-profile
 * Create or update the user's manual strength profile
 */
router.put(
  '/strength-profile',
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as any).correlationId;
    try {
      const user = await getOrCreateUser(req.user!);

      const validation = validateStrengthProfileInput(req.body);
      if (!validation.valid) {
        sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
          validationErrors: validation.errors,
        });
        return;
      }

      const profile = await upsertStrengthProfile(user.id, validation.entries!);

      sendSuccessResponse(res, { profile }, undefined, 200, correlationId);
    } catch (error) {
      logError('PUT /api/ai/strength-profile', error, correlationId);
      sendErrorResponse(res, 500, 'Failed to update strength profile', error, correlationId);
    }
  }
);

/**
 * GET /api/ai/strength-profile
 * Fetch the user's current strength profile
 */
router.get(
  '/strength-profile',
  firebaseAuthMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const correlationId = (req as any).correlationId;
    try {
      const user = await getOrCreateUser(req.user!);
      const profile = await getStrengthProfile(user.id);

      if (!profile) {
        sendErrorResponse(res, 404, 'No strength profile found', undefined, correlationId);
        return;
      }

      sendSuccessResponse(res, { profile }, undefined, 200, correlationId);
    } catch (error) {
      logError('GET /api/ai/strength-profile', error, correlationId);
      sendErrorResponse(res, 500, 'Failed to fetch strength profile', error, correlationId);
    }
  }
);

export default router;
