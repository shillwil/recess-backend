import crypto from 'crypto';
import { Response } from 'express';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Standard error response structure
 */
export interface ErrorResponse {
  success: false;
  message: string;
  correlationId: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Standard success response structure
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  message?: string;
  data?: T;
  correlationId?: string;
}

/**
 * Generates a correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Creates a standardized error response object
 * In development, includes error details; in production, omits sensitive info
 */
export function createErrorResponse(
  message: string,
  error?: unknown,
  correlationId?: string,
  details?: Record<string, unknown>
): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    message,
    correlationId: correlationId || generateCorrelationId()
  };

  // In development, include error details for debugging
  if (isDevelopment && error instanceof Error) {
    response.error = error.message;
  }

  // Include additional details if provided (sanitized in production)
  if (details) {
    response.details = isDevelopment ? details : undefined;
  }

  return response;
}

/**
 * Logs an error with correlation ID and context
 * Verbose in development, structured for production
 */
export function logError(
  context: string,
  error: unknown,
  correlationId: string,
  metadata?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const errorStack = error instanceof Error ? error.stack : undefined;

  if (isDevelopment) {
    // Verbose logging in development
    console.error(`[${timestamp}] [${correlationId}] ERROR in ${context}:`, {
      message: errorMessage,
      stack: errorStack,
      metadata: sanitizeMetadata(metadata)
    });
  } else {
    // Structured logging for production (JSON format for log aggregation)
    console.error(JSON.stringify({
      timestamp,
      level: 'error',
      correlationId,
      context,
      message: errorMessage,
      // Don't include stack in production logs by default
      metadata: sanitizeMetadata(metadata)
    }));
  }
}

/**
 * Logs an info message with correlation ID
 */
export function logInfo(
  context: string,
  message: string,
  correlationId?: string,
  metadata?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();

  if (isDevelopment) {
    console.log(`[${timestamp}] [${correlationId || 'no-id'}] ${context}: ${message}`, metadata || '');
  } else {
    console.log(JSON.stringify({
      timestamp,
      level: 'info',
      correlationId,
      context,
      message,
      metadata: sanitizeMetadata(metadata)
    }));
  }
}

/**
 * Logs a warning with correlation ID
 */
export function logWarn(
  context: string,
  message: string,
  correlationId?: string,
  metadata?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();

  if (isDevelopment) {
    console.warn(`[${timestamp}] [${correlationId || 'no-id'}] WARN ${context}: ${message}`, metadata || '');
  } else {
    console.warn(JSON.stringify({
      timestamp,
      level: 'warn',
      correlationId,
      context,
      message,
      metadata: sanitizeMetadata(metadata)
    }));
  }
}

/**
 * Sanitizes metadata to avoid logging sensitive information
 */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'email', 'firebaseUid'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Helper to send a standardized error response
 */
export function sendErrorResponse(
  res: Response,
  statusCode: number,
  message: string,
  error?: unknown,
  correlationId?: string,
  details?: Record<string, unknown>
): void {
  const errorResponse = createErrorResponse(message, error, correlationId, details);
  res.status(statusCode).json(errorResponse);
}

/**
 * Helper to send a standardized success response
 */
export function sendSuccessResponse<T>(
  res: Response,
  data?: T,
  message?: string,
  statusCode: number = 200,
  correlationId?: string
): void {
  const response: SuccessResponse<T> = {
    success: true
  };

  if (message) response.message = message;
  if (data !== undefined) response.data = data;
  if (correlationId) response.correlationId = correlationId;

  res.status(statusCode).json(response);
}
