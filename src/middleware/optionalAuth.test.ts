import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

// Create mock function that persists across calls
const mockVerifyIdToken = jest.fn();

// Mock Firebase Admin
jest.mock('../services/firebase', () => ({
  __esModule: true,
  default: {
    auth: () => ({
      verifyIdToken: mockVerifyIdToken
    })
  }
}));

import { optionalAuthMiddleware } from './optionalAuth';

describe('optionalAuthMiddleware', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    nextFunction = jest.fn();
    mockVerifyIdToken.mockReset();
  });

  it('should call next() without setting user when no Authorization header is provided', async () => {
    mockRequest.headers = {};

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(nextFunction).toHaveBeenCalled();
    expect(mockRequest.user).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('should call next() without setting user when Authorization header does not start with Bearer', async () => {
    mockRequest.headers = {
      authorization: 'Basic sometoken'
    };

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(nextFunction).toHaveBeenCalled();
    expect(mockRequest.user).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('should call next() without setting user when Bearer token is empty', async () => {
    mockRequest.headers = {
      authorization: 'Bearer '
    };

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(nextFunction).toHaveBeenCalled();
    expect(mockRequest.user).toBeUndefined();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('should set user and call next() when valid token is provided', async () => {
    const mockDecodedToken = {
      uid: 'test-user-id',
      email: 'test@example.com'
    };

    mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

    mockRequest.headers = {
      authorization: 'Bearer valid-token'
    };

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(mockRequest.user).toEqual(mockDecodedToken);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should call next() without setting user when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    mockRequest.headers = {
      authorization: 'Bearer invalid-token'
    };

    // Suppress console.warn for this test
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(mockVerifyIdToken).toHaveBeenCalledWith('invalid-token');
    expect(mockRequest.user).toBeUndefined();
    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled(); // Should not return error

    consoleSpy.mockRestore();
  });

  it('should not return 401 on invalid token (unlike required auth middleware)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

    mockRequest.headers = {
      authorization: 'Bearer expired-token'
    };

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    // Key assertion: optional auth should NOT return 401
    expect(mockResponse.status).not.toHaveBeenCalledWith(401);
    expect(mockResponse.json).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle token with only Bearer prefix and whitespace', async () => {
    mockRequest.headers = {
      authorization: 'Bearer    '
    };

    await optionalAuthMiddleware(
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
      nextFunction
    );

    // Token is truthy (whitespace), so it should try to verify
    // But this depends on implementation - if it trims, it won't verify
    expect(nextFunction).toHaveBeenCalled();
  });
});
