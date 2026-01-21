import * as admin from 'firebase-admin';
import { config } from '../config';

// Helper to safely log Firebase errors without exposing sensitive config
function logFirebaseError(error: unknown): void {
  const isDev = config.env === 'development';

  if (isDev) {
    // In development, log full error for debugging
    console.error('Failed to initialize Firebase Admin SDK:', error);
  } else {
    // In production, log only generic message to avoid leaking config details
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Only log error code/message, not full stack or config
    console.error('Firebase Admin SDK initialization failed:', {
      message: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
}

// Only initialize Firebase if the service account is configured
if (config.firebase.serviceAccount) {
  try {
    // Decode the Base64 service account key
    const serviceAccountJson = Buffer.from(
      config.firebase.serviceAccount,
      'base64'
    ).toString('utf-8');

    const serviceAccount = JSON.parse(serviceAccountJson);

    // Initialize the Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin SDK initialized successfully.');
    }
  } catch (error) {
    logFirebaseError(error);
    // If Firebase is critical for an environment, you might want to exit.
    if (config.env !== 'development') {
      process.exit(1);
    }
  }
} else {
  // Log that Firebase is not initialized, which is expected in development.
  if (config.env === 'development') {
    console.log('Firebase Admin SDK not initialized: Service account not provided. This is expected for local development.');
  }
}

export default admin;
