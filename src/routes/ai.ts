import { Router, Response } from 'express';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import { AiService, AiGenerationError, GenerateProgramRequest } from '../services/aiService';

const router = Router();

// All AI routes require authentication
router.use(firebaseAuthMiddleware);

// --- Validation helpers ---

const VALID_EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const VALID_GOALS = ['hypertrophy', 'strength', 'endurance', 'general', 'powerbuilding'];
const VALID_EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'bands', 'kettlebell', 'smith_machine'];

// --- POST /api/ai/generate-program ---

router.post('/generate-program', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);

    // Validate request body
    const {
      inspirationSource,
      daysPerWeek,
      sessionDurationMinutes,
      experienceLevel,
      goal,
      equipment,
      useTrainingHistory,
      manualStrengthData,
      freeTextPreferences,
    } = req.body;

    // Required fields
    if (!inspirationSource || typeof inspirationSource !== 'string' || inspirationSource.length > 200) {
      res.status(400).json({
        success: false,
        message: 'inspirationSource is required and must be a string (max 200 chars)',
      });
      return;
    }

    if (!daysPerWeek || typeof daysPerWeek !== 'number' || daysPerWeek < 1 || daysPerWeek > 7) {
      res.status(400).json({
        success: false,
        message: 'daysPerWeek is required and must be a number between 1 and 7',
      });
      return;
    }

    if (!experienceLevel || !VALID_EXPERIENCE_LEVELS.includes(experienceLevel)) {
      res.status(400).json({
        success: false,
        message: `experienceLevel must be one of: ${VALID_EXPERIENCE_LEVELS.join(', ')}`,
      });
      return;
    }

    if (!goal || !VALID_GOALS.includes(goal)) {
      res.status(400).json({
        success: false,
        message: `goal must be one of: ${VALID_GOALS.join(', ')}`,
      });
      return;
    }

    if (!equipment || !Array.isArray(equipment) || equipment.length === 0) {
      res.status(400).json({
        success: false,
        message: 'equipment is required and must be a non-empty array',
      });
      return;
    }

    for (const eq of equipment) {
      if (!VALID_EQUIPMENT.includes(eq)) {
        res.status(400).json({
          success: false,
          message: `Invalid equipment: "${eq}". Valid options: ${VALID_EQUIPMENT.join(', ')}`,
        });
        return;
      }
    }

    // Optional fields validation
    const duration = sessionDurationMinutes || 60;
    if (typeof duration !== 'number' || duration < 30 || duration > 120) {
      res.status(400).json({
        success: false,
        message: 'sessionDurationMinutes must be a number between 30 and 120',
      });
      return;
    }

    if (freeTextPreferences && (typeof freeTextPreferences !== 'string' || freeTextPreferences.length > 500)) {
      res.status(400).json({
        success: false,
        message: 'freeTextPreferences must be a string (max 500 chars)',
      });
      return;
    }

    if (manualStrengthData) {
      if (!Array.isArray(manualStrengthData) || manualStrengthData.length > 20) {
        res.status(400).json({
          success: false,
          message: 'manualStrengthData must be an array with max 20 entries',
        });
        return;
      }

      for (const entry of manualStrengthData) {
        if (!entry.exerciseName || typeof entry.exerciseName !== 'string') {
          res.status(400).json({ success: false, message: 'Each manualStrengthData entry must have exerciseName (string)' });
          return;
        }
        if (typeof entry.weight !== 'number' || entry.weight <= 0) {
          res.status(400).json({ success: false, message: 'Each manualStrengthData entry must have weight (positive number)' });
          return;
        }
        if (entry.unit !== 'lb' && entry.unit !== 'kg') {
          res.status(400).json({ success: false, message: 'Each manualStrengthData entry unit must be "lb" or "kg"' });
          return;
        }
        if (typeof entry.reps !== 'number' || entry.reps < 1 || entry.reps > 100) {
          res.status(400).json({ success: false, message: 'Each manualStrengthData entry reps must be 1-100' });
          return;
        }
        if (typeof entry.sets !== 'number' || entry.sets < 1 || entry.sets > 20) {
          res.status(400).json({ success: false, message: 'Each manualStrengthData entry sets must be 1-20' });
          return;
        }
      }
    }

    // Check rate limit
    const rateLimit = await AiService.checkRateLimit(userRecord.id);
    if (!rateLimit.allowed) {
      res.status(429).json({
        success: false,
        message: `You've used all ${rateLimit.limit} AI generations for this month. Resets on ${rateLimit.resetsAt.toISOString().split('T')[0]}. ${rateLimit.tier === 'free' ? `Upgrade to Pro for ${rateLimit.limit} generations/month.` : ''}`,
        data: {
          generationsUsed: rateLimit.limit,
          generationsLimit: rateLimit.limit,
          generationsRemaining: 0,
          resetsAt: rateLimit.resetsAt.toISOString(),
          tier: rateLimit.tier,
        },
      });
      return;
    }

    // Generate program
    const request: GenerateProgramRequest = {
      inspirationSource,
      daysPerWeek,
      sessionDurationMinutes: duration,
      experienceLevel,
      goal,
      equipment,
      useTrainingHistory: useTrainingHistory || false,
      manualStrengthData,
      freeTextPreferences,
    };

    const result = await AiService.generateProgram(userRecord.id, request);

    // Get updated rate limit info for response
    const updatedRateLimit = await AiService.checkRateLimit(userRecord.id);

    res.status(201).json({
      success: true,
      data: {
        ...result,
        rateLimit: {
          generationsRemaining: updatedRateLimit.remaining,
          generationsLimit: updatedRateLimit.limit,
          resetsAt: updatedRateLimit.resetsAt.toISOString(),
          tier: updatedRateLimit.tier,
        },
      },
    });
  } catch (error) {
    if (error instanceof AiGenerationError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
        retryable: error.retryable,
      });
      return;
    }

    console.error('Error in POST /api/ai/generate-program:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate program',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --- POST /api/ai/rate-program/:programId ---

router.post('/rate-program/:programId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    const { programId } = req.params;
    const { rating, feedback } = req.body;

    // Validate
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      res.status(400).json({
        success: false,
        message: 'rating is required and must be an integer between 1 and 5',
      });
      return;
    }

    if (feedback && (typeof feedback !== 'string' || feedback.length > 500)) {
      res.status(400).json({
        success: false,
        message: 'feedback must be a string (max 500 chars)',
      });
      return;
    }

    await AiService.rateProgram(userRecord.id, programId, rating, feedback);

    res.status(200).json({
      success: true,
      message: 'Rating saved. Thanks for the feedback!',
    });
  } catch (error) {
    if (error instanceof AiGenerationError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }

    console.error('Error in POST /api/ai/rate-program:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save rating',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --- GET /api/ai/generation-status ---

router.get('/generation-status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    const rateLimit = await AiService.checkRateLimit(userRecord.id);

    res.status(200).json({
      success: true,
      data: {
        generationsUsed: rateLimit.limit - rateLimit.remaining,
        generationsLimit: rateLimit.limit,
        generationsRemaining: rateLimit.remaining,
        resetsAt: rateLimit.resetsAt.toISOString(),
        tier: rateLimit.tier,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/ai/generation-status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch generation status',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --- PUT /api/ai/strength-profile ---

router.put('/strength-profile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries) || entries.length === 0 || entries.length > 20) {
      res.status(400).json({
        success: false,
        message: 'entries is required and must be an array with 1-20 entries',
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.exerciseName || typeof entry.exerciseName !== 'string') {
        res.status(400).json({ success: false, message: 'Each entry must have exerciseName (string)' });
        return;
      }
      if (typeof entry.weight !== 'number' || entry.weight <= 0) {
        res.status(400).json({ success: false, message: 'Each entry must have weight (positive number)' });
        return;
      }
      if (entry.unit !== 'lb' && entry.unit !== 'kg') {
        res.status(400).json({ success: false, message: 'Each entry unit must be "lb" or "kg"' });
        return;
      }
      if (typeof entry.reps !== 'number' || entry.reps < 1 || entry.reps > 100) {
        res.status(400).json({ success: false, message: 'Each entry reps must be 1-100' });
        return;
      }
      if (typeof entry.sets !== 'number' || entry.sets < 1 || entry.sets > 20) {
        res.status(400).json({ success: false, message: 'Each entry sets must be 1-20' });
        return;
      }
    }

    const profile = await AiService.upsertStrengthProfile(userRecord.id, entries);

    res.status(200).json({
      success: true,
      data: {
        profile: {
          entries: profile.entries,
          updatedAt: profile.updatedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error in PUT /api/ai/strength-profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update strength profile',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// --- GET /api/ai/strength-profile ---

router.get('/strength-profile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    const profile = await AiService.getStrengthProfile(userRecord.id);

    if (!profile) {
      res.status(404).json({
        success: false,
        message: 'No strength profile found. Create one using PUT /api/ai/strength-profile.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        profile: {
          entries: profile.entries,
          updatedAt: profile.updatedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error in GET /api/ai/strength-profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch strength profile',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
