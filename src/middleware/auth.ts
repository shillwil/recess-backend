import { NextFunction, Request, Response } from 'express';
import admin from '../services/firebase';
import { generateCorrelationId, logError } from '../utils/errorResponse';

// Extend the Express Request type to include our custom 'user' property
export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  correlationId?: string;
}

/**
 * Express middleware to verify a Firebase ID token in the Authorization header.
 * If the token is valid, the decoded token is attached to the request object as `req.user`.
 * If the token is invalid or missing, it sends a 401 Unauthorized response.
 *
 * Security: Error details are logged server-side only, never exposed to clients.
 */
export const firebaseAuthMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const correlationId = req.correlationId || generateCorrelationId();
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized: Missing or invalid Authorization header',
      correlationId
    });
    return;
  }

  const token = authorization.split('Bearer ')[1];
  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized: Bearer token is missing',
      correlationId
    });
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    // Log full error details server-side for debugging
    logError('Firebase auth middleware', error, correlationId);

    // Return generic error to client - never expose Firebase error details
    res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or expired token',
      correlationId
    });
  }
};
