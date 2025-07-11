// This file assumes that environment variables are already loaded.
// In development, 'tsx' handles loading .env files automatically.
// In production, the environment variables should be set in the deployment environment.

// Basic validation to ensure critical variables are present
const env = process.env.NODE_ENV || 'development';
if (!process.env.DATABASE_URL) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}

// Firebase is required only for staging and production
if ((env === 'staging' || env === 'production') && !process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  throw new Error(`Missing required environment variable: FIREBASE_SERVICE_ACCOUNT_BASE64 for ${env} environment`);
}

// Export the configuration object
export const config = {
  env: env,
  database: {
    url: process.env.DATABASE_URL as string,
  },
  firebase: {
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 as string,
  },
  // Add other configurations here as your app grows
  // e.g., firebase, api keys, etc.
};
