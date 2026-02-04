import './services/firebase'; // Initializes Firebase Admin SDK
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';
import { getOrCreateUser, updateUserProfile } from './services/userService';
import { SyncService, SyncPayload } from './services/syncService';
import { db } from './db';
import { exercises } from './db/schema';
import { ilike, count, asc } from 'drizzle-orm';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Native mobile clients (iOS/Android) don't send Origin headers.
// Set a default so the CORS middleware can process the request normally.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.headers.origin) {
    req.headers.origin = `${req.protocol}://${req.get('host')}`;
  }
  next();
});

app.use(cors({
  origin: true,
  credentials: true
}));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    environment: config.env,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Public route
app.get('/', (req: Request, res: Response) => {
  res.send(`Recess backend is running in ${config.env} mode.`);
});

// Authentication endpoint - get or create user
app.post('/api/auth/login', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: userRecord,
    });
  } catch (error) {
    console.error('Error in /api/auth/login endpoint:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to authenticate user',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current user profile
app.get('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userRecord = await getOrCreateUser(req.user!);
    res.status(200).json({
      success: true,
      user: userRecord,
    });
  } catch (error) {
    console.error('Error in /api/me endpoint:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch user profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update user profile
app.put('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    const updatedUser = await updateUserProfile(req.user!.uid, updates);
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error in PUT /api/me endpoint:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update user profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Sync endpoint - sync user's workout data
app.post('/api/sync', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Validate required fields
    const payload = req.body as SyncPayload;
    
    if (!payload.deviceId) {
      res.status(400).json({
        success: false,
        message: 'Device ID is required for sync'
      });
      return;
    }

    // Get user ID from Firebase auth
    const userRecord = await getOrCreateUser(req.user!);
    
    // Perform sync
    const syncResult = await SyncService.syncUserData(userRecord.id, req.body as SyncPayload);
    
    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      data: syncResult
    });
  } catch (error) {
    console.error('Error in /api/sync endpoint:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to sync user data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Search exercises endpoint
app.get('/api/exercises', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = Math.min(parseInt(req.query.per_page as string) || 20, 100);
    const query = req.query.q as string;
    const offset = (page - 1) * perPage;

    const whereClause = query ? ilike(exercises.name, `%${query}%`) : undefined;

    const [results, totalCount] = await Promise.all([
      db.select()
        .from(exercises)
        .where(whereClause)
        .limit(perPage)
        .offset(offset)
        .orderBy(asc(exercises.name)),
      db.select({ count: count() })
        .from(exercises)
        .where(whereClause)
    ]);

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page,
        perPage,
        total: totalCount[0].count,
        totalPages: Math.ceil(Number(totalCount[0].count) / perPage)
      }
    });
  } catch (error) {
    console.error('Error in /api/exercises endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exercises',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: config.env === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} in ${config.env} mode`);
});
