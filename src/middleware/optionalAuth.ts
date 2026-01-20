import { NextFunction, Response } from 'express';
import admin from '../services/firebase';
import { AuthenticatedRequest } from './auth';
import { logWarn, generateCorrelationId } from '../utils/errorResponse';

/**
 * Optional authentication middleware.
 * If a valid token is provided, attaches user to request.
 * If no token or invalid token, continues without user (no error).
 * Use this for endpoints that work for both authenticated and unauthenticated users,
 * but provide personalized features for authenticated users.
 */
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    // No token provided - continue as unauthenticated
    return next();
  }

  const token = authorization.split('Bearer ')[1];
  if (!token) {
    return next();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
  } catch (error) {
    // Invalid token - continue as unauthenticated (don't fail the request)
    const correlationId = req.correlationId || generateCorrelationId();
    logWarn('Optional auth middleware', 'Invalid token provided, continuing as unauthenticated', correlationId);
  }

  next();
};
