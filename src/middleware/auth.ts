import { NextFunction, Request, Response } from 'express';
import admin from '../services/firebase';

// Extend the Express Request type to include our custom 'user' property
export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  body: any;
}

/**
 * Express middleware to verify a Firebase ID token in the Authorization header.
 * If the token is valid, the decoded token is attached to the request object as `req.user`.
 * If the token is invalid or missing, it sends a 401 Unauthorized response.
 */
export const firebaseAuthMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized: Missing or invalid Authorization header.' });
    return;
  }

  const token = authorization.split('Bearer ')[1];
  if (!token) {
    res.status(401).json({ message: 'Unauthorized: Bearer token is missing.' });
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    res.status(401).json({ 
      message: 'Unauthorized: Invalid token.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
