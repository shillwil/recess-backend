import './services/firebase'; // Initializes Firebase Admin SDK
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';
import { getOrCreateUser, updateUserProfile } from './services/userService';
import { SyncService, SyncPayload } from './services/syncService';
import exerciseRoutes from './routes/exercises';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: true, // Allow all origins for testing
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

// Exercise API routes
app.use('/api/exercises', exerciseRoutes);

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
