import './services/firebase'; // Initializes Firebase Admin SDK
import express from 'express';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';
import { getOrCreateUser } from './services/userService';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public route
app.get('/', (req, res) => {
  res.send(`Recess backend is running in ${config.env} mode.`);
});

// Protected route
app.get('/api/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    // The middleware has already verified the token. Now, get or create the user in our database.
  try {
    const userRecord = await getOrCreateUser(req.user!);
    res.json({
      message: 'Authentication successful. User profile retrieved from database.',
      user: userRecord,
    });
  } catch (error) {
    console.error('Error in /api/me endpoint:', error);
    res.status(500).json({ message: 'An error occurred while fetching user data.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} in ${config.env} mode`);
});
