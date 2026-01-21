import './services/firebase'; // Initializes Firebase Admin SDK
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';
import { getOrCreateUser, updateUserProfile } from './services/userService';
import { SyncService, SyncPayload } from './services/syncService';
import exerciseRoutes from './routes/exercises';
import templateRoutes from './routes/templates';
import programRoutes from './routes/programs';
import { validateUserProfileUpdate, validateSyncPayload } from './utils/validation';
import {
  generateCorrelationId,
  logError,
  logInfo,
  sendErrorResponse,
} from './utils/errorResponse';

const app = express();
const PORT = process.env.PORT || 3000;
const isDevelopment = config.env === 'development';

// CORS configuration - restrict origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : isDevelopment
    ? ['http://localhost:3000', 'http://localhost:8080', 'capacitor://localhost', 'ionic://localhost']
    : ['capacitor://localhost', 'ionic://localhost']; // Mobile app origins for production

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // In production, require origin header for browser requests
    // Mobile apps (Capacitor/Ionic) send origin headers, so this is safe
    if (!origin) {
      if (isDevelopment) {
        // Allow no-origin in development only (for curl, Postman, etc.)
        callback(null, true);
      } else {
        // In production, reject requests without origin (prevents direct API abuse)
        // Note: Mobile apps DO send origin headers (capacitor://localhost, ionic://localhost)
        callback(new Error('Origin header required'));
      }
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (isDevelopment) {
      // In development only, allow unlisted origins with warning
      console.warn(`CORS: Allowing request from unlisted origin: ${origin}`);
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Rate limiting configuration
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100, // 100 requests per 15 minutes in production
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    correlationId: 'rate-limit'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 100 : 10, // 10 auth attempts per 15 minutes
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
    correlationId: 'rate-limit-auth'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const syncLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isDevelopment ? 100 : 10, // 10 syncs per minute
  message: {
    success: false,
    message: 'Too many sync requests, please try again later',
    correlationId: 'rate-limit-sync'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Profile update limiter - prevent rapid profile spam
const profileLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDevelopment ? 100 : 10, // 10 profile updates per hour
  message: {
    success: false,
    message: 'Too many profile updates, please try again later',
    correlationId: 'rate-limit-profile'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(express.json({ limit: '10mb' })); // Limit body size for sync payloads

// Health check endpoint - BEFORE CORS middleware
// This allows load balancers, Kubernetes probes, and monitoring systems to access
// the health endpoint without requiring Origin headers (which they don't send)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    environment: config.env,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// CORS and rate limiting applied to all other routes
app.use(cors(corsOptions));
app.use(generalLimiter); // Apply general rate limiting to all routes

// Add correlation ID to all requests
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = generateCorrelationId();
  (req as AuthenticatedRequest & { correlationId: string }).correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
});

// Public route
app.get('/', (req: Request, res: Response) => {
  res.send(`Recess backend is running in ${config.env} mode.`);
});

// Authentication endpoint - get or create user
app.post('/api/auth/login', authLimiter, firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId;
  try {
    const userRecord = await getOrCreateUser(req.user!);
    logInfo('/api/auth/login', 'User authenticated successfully', correlationId, { userId: userRecord.id });
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      data: { user: userRecord },
      correlationId
    });
  } catch (error) {
    logError('/api/auth/login', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to authenticate user', error, correlationId);
  }
});

// Get current user profile
app.get('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId;
  try {
    const userRecord = await getOrCreateUser(req.user!);
    res.status(200).json({
      success: true,
      data: { user: userRecord },
      correlationId
    });
  } catch (error) {
    logError('/api/me GET', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to fetch user profile', error, correlationId);
  }
});

// Update user profile
app.put('/api/me', profileLimiter, firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId;
  try {
    // Validate and sanitize input
    const validation = validateUserProfileUpdate(req.body);
    if (!validation.valid) {
      sendErrorResponse(res, 400, 'Invalid request data', undefined, correlationId, {
        validationErrors: validation.errors
      });
      return;
    }

    // Check if there's anything to update
    if (!validation.sanitized || Object.keys(validation.sanitized).length === 0) {
      sendErrorResponse(res, 400, 'No valid fields to update', undefined, correlationId);
      return;
    }

    const updatedUser = await updateUserProfile(req.user!.uid, validation.sanitized);
    logInfo('/api/me PUT', 'Profile updated successfully', correlationId, { userId: updatedUser.id });
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser },
      correlationId
    });
  } catch (error) {
    logError('/api/me PUT', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to update user profile', error, correlationId);
  }
});

// Exercise API routes
app.use('/api/exercises', exerciseRoutes);

// Template API routes (rate limiting handled in routes file for write operations only)
app.use('/api/templates', templateRoutes);

// Program API routes (rate limiting handled in routes file for write operations only)
app.use('/api/programs', programRoutes);

// Sync endpoint - sync user's workout data
app.post('/api/sync', syncLimiter, firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId;
  try {
    // Validate payload structure and size limits (DoS prevention)
    const payloadValidation = validateSyncPayload(req.body);
    if (!payloadValidation.valid) {
      sendErrorResponse(res, 400, 'Invalid sync payload', undefined, correlationId, {
        validationErrors: payloadValidation.errors
      });
      return;
    }

    const payload = req.body as SyncPayload;

    // Get user ID from Firebase auth
    const userRecord = await getOrCreateUser(req.user!);

    // Perform sync
    const syncResult = await SyncService.syncUserData(userRecord.id, payload);

    logInfo('/api/sync', 'Sync completed successfully', correlationId, {
      userId: userRecord.id,
      deviceId: payload.deviceId,
      workoutsCount: payload.workouts?.length || 0
    });

    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      data: syncResult,
      correlationId
    });
  } catch (error) {
    logError('/api/sync', error, correlationId);
    sendErrorResponse(res, 500, 'Failed to sync user data', error, correlationId);
  }
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId || generateCorrelationId();
  logError('Global error handler', err, correlationId, { path: req.originalUrl, method: req.method });
  sendErrorResponse(res, 500, 'Internal server error', err, correlationId);
});

// 404 handler
app.use((req: Request, res: Response) => {
  const correlationId = (req as AuthenticatedRequest & { correlationId: string }).correlationId || generateCorrelationId();
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    correlationId
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} in ${config.env} mode`);
});
