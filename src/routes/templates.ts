import { Router, Response, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, firebaseAuthMiddleware } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  cloneTemplate,
  updateTemplateExercises,
} from '../services/templateService';
import { TemplateListQuery } from '../models/template.types';
import {
  validateTemplateListQuery,
  validateCreateTemplate,
  validateUpdateTemplate,
  validateTemplateExercises,
  validateCloneTemplate,
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

// Rate limiter for write operations only (POST, PUT, DELETE)
const templateWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 200 : 50, // 50 template write operations per hour
  message: {
    success: false,
    message: 'Too many template operations, please try again later',
    correlationId: 'rate-limit-template'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============ Middleware ============

// All routes require authentication
router.use(firebaseAuthMiddleware);

// ============ Read Routes (no rate limiting) ============

/**
 * GET /api/templates
 * List user's templates with pagination
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Validate query parameters
    const validation = validateTemplateListQuery(req.query as Record<string, unknown>);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid query parameters', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    // Build query with defaults
    const query: TemplateListQuery = {
      cursor: validation.sanitized?.cursor,
      limit: validation.sanitized?.limit,
      sort: validation.sanitized?.sort || 'createdAt',
      order: validation.sanitized?.order || 'desc'
    };

    const result = await getTemplates(user.id, query);

    res.json({
      success: true,
      data: result,
      correlationId
    });
  } catch (error) {
    logError('GET /api/templates', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch templates', error, correlationId);
  }
});

/**
 * GET /api/templates/:id
 * Get template with all exercises
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid template ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const template = await getTemplateById(id, user.id);

    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Template not found',
        correlationId
      });
      return;
    }

    res.json({
      success: true,
      data: { template },
      correlationId
    });
  } catch (error) {
    logError('GET /api/templates/:id', error, correlationId, { templateId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to fetch template', error, correlationId);
  }
});

// ============ Write Routes (with rate limiting) ============

/**
 * POST /api/templates
 * Create a new template with exercises
 */
router.post('/', templateWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    // Validate request body
    const validation = validateCreateTemplate(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const template = await createTemplate(user.id, validation.sanitized!);

    logInfo('POST /api/templates', 'Template created', correlationId, {
      userId: user.id,
      templateId: template.id
    });

    res.status(201).json({
      success: true,
      data: { template },
      correlationId
    });
  } catch (error) {
    logError('POST /api/templates', error, correlationId);

    // Handle specific errors
    if (error instanceof Error && error.message.includes('Exercises not found')) {
      sendErrorResponse(res, 400, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to create template', error, correlationId);
  }
});

/**
 * PUT /api/templates/:id
 * Update template metadata (name, description)
 */
router.put('/:id', templateWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid template ID format', undefined, correlationId);
      return;
    }

    // Validate request body
    const validation = validateUpdateTemplate(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const template = await updateTemplate(id, user.id, validation.sanitized!);

    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Template not found',
        correlationId
      });
      return;
    }

    logInfo('PUT /api/templates/:id', 'Template updated', correlationId, {
      userId: user.id,
      templateId: id
    });

    res.json({
      success: true,
      data: { template },
      correlationId
    });
  } catch (error) {
    logError('PUT /api/templates/:id', error, correlationId, { templateId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to update template', error, correlationId);
  }
});

/**
 * DELETE /api/templates/:id
 * Delete template (cascades to exercises)
 * Returns 409 Conflict if template is used in any program
 */
router.delete('/:id', templateWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid template ID format', undefined, correlationId);
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const deleted = await deleteTemplate(id, user.id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Template not found',
        correlationId
      });
      return;
    }

    logInfo('DELETE /api/templates/:id', 'Template deleted', correlationId, {
      userId: user.id,
      templateId: id
    });

    res.json({
      success: true,
      message: 'Template deleted successfully',
      correlationId
    });
  } catch (error) {
    logError('DELETE /api/templates/:id', error, correlationId, { templateId: req.params.id });

    // Handle template-in-use error
    if (error instanceof Error && error.message.includes('used in one or more programs')) {
      sendErrorResponse(res, 409, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to delete template', error, correlationId);
  }
});

/**
 * POST /api/templates/:id/clone
 * Clone a template
 */
router.post('/:id/clone', templateWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid template ID format', undefined, correlationId);
      return;
    }

    // Validate request body (optional name)
    const validation = validateCloneTemplate(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const template = await cloneTemplate(id, user.id, validation.sanitized?.name);

    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Template not found',
        correlationId
      });
      return;
    }

    logInfo('POST /api/templates/:id/clone', 'Template cloned', correlationId, {
      userId: user.id,
      sourceTemplateId: id,
      newTemplateId: template.id
    });

    res.status(201).json({
      success: true,
      data: { template },
      correlationId
    });
  } catch (error) {
    logError('POST /api/templates/:id/clone', error, correlationId, { templateId: req.params.id });
    sendErrorResponse(res, 500, 'Failed to clone template', error, correlationId);
  }
});

/**
 * PUT /api/templates/:id/exercises
 * Bulk update/reorder exercises
 */
router.put('/:id/exercises', templateWriteLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId(req);
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      sendErrorResponse(res, 400, 'Invalid template ID format', undefined, correlationId);
      return;
    }

    // Validate request body
    const validation = validateTemplateExercises(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Get user
    const user = await getOrCreateUser(req.user!);

    const template = await updateTemplateExercises(id, user.id, validation.sanitized!.exercises);

    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Template not found',
        correlationId
      });
      return;
    }

    logInfo('PUT /api/templates/:id/exercises', 'Template exercises updated', correlationId, {
      userId: user.id,
      templateId: id,
      exerciseCount: validation.sanitized!.exercises.length
    });

    res.json({
      success: true,
      data: { template },
      correlationId
    });
  } catch (error) {
    logError('PUT /api/templates/:id/exercises', error, correlationId, { templateId: req.params.id });

    // Handle specific errors
    if (error instanceof Error && error.message.includes('Exercises not found')) {
      sendErrorResponse(res, 400, error.message, undefined, correlationId);
      return;
    }

    sendErrorResponse(res, 500, 'Failed to update template exercises', error, correlationId);
  }
});

export default router;
