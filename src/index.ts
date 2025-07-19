import './services/firebase'; // Initializes Firebase Admin SDK
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';
import { getOrCreateUser, updateUserProfile } from './services/userService';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: true, // Allow all origins for testing
  credentials: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    environment: config.env,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Public route
app.get('/', (req, res) => {
  res.send(`Recess backend is running in ${config.env} mode.`);
});

// Authentication endpoint - get or create user
app.post('/api/auth/login', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
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
app.get('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
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
app.put('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
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

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: config.env === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} in ${config.env} mode`);
});
