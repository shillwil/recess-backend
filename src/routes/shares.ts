import { Router, Response, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import { createShare, getShareByToken, ShareNotFoundError } from '../services/shareService';
import { validateCreateShare, validateShareToken } from '../utils/validation';
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

function getCorrelationId(req: Request): string {
  return (req as Request & { correlationId?: string }).correlationId || generateCorrelationId();
}

// ============ Rate Limiting ============

// Rate limiter for share creation only (not GET lookups)
const shareCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 200 : 30, // 30 share creations per hour in production
  message: {
    success: false,
    message: 'Too many share requests, please try again later',
    correlationId: 'rate-limit-share'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============ Routes ============
// NOTE: Unlike template/program routes that apply router.use(firebaseAuthMiddleware),
// shares need mixed auth — POST requires auth, GET is public.
// Auth middleware is applied per-route, not at router level.

/**
 * POST /api/shares
 * Create a share link for a program or template.
 * Requires authentication (must own the item being shared).
 */
router.post('/', shareCreateLimiter, firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Validate request body
    const validation = validateCreateShare(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const result = await createShare(user.id, validation.sanitized!);

    logInfo('POST /api/shares', 'Share created', correlationId, {
      userId: user.id,
      type: validation.sanitized!.type,
      itemId: validation.sanitized!.itemId,
      token: result.token
    });

    res.status(201).json({
      success: true,
      data: result,
      correlationId
    });
  } catch (error) {
    logError('POST /api/shares', error, correlationId);

    if (error instanceof ShareNotFoundError) {
      sendErrorResponse(res, 404, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to create share', error, correlationId);
  }
});

/**
 * GET /api/shares/:token
 * Retrieve a shared item by its token. No auth required.
 * Returns the frozen snapshot with sharer info.
 */
router.get('/:token', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { token } = req.params;

    if (!validateShareToken(token)) {
      sendErrorResponse(res, 400, 'Invalid share token format', undefined, correlationId);
      return;
    }

    const share = await getShareByToken(token);

    if (!share) {
      res.status(404).json({
        success: false,
        message: 'Share not found or has expired',
        correlationId
      });
      return;
    }

    res.json({
      success: true,
      data: share,
      correlationId
    });
  } catch (error) {
    logError('GET /api/shares/:token', error, correlationId, { token: req.params.token });
    sendErrorResponse(res, 500, 'Failed to retrieve share', error, correlationId);
  }
});

export default router;
