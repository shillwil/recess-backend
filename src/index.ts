import './services/firebase'; // Initializes Firebase Admin SDK
import express from 'express';
import { config } from './config';
import { AuthenticatedRequest, firebaseAuthMiddleware } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public route
app.get('/', (req, res) => {
  res.send(`Recess backend is running in ${config.env} mode.`);
});

// Protected route
app.get('/api/me', firebaseAuthMiddleware, (req: AuthenticatedRequest, res) => {
  // If the middleware succeeds, req.user will be populated.
  const { name, email, uid } = req.user!;
  res.json({
    message: 'This is a protected route. Authentication successful!',
    user: {
      uid,
      name,
      email,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT} in ${config.env} mode`);
});
