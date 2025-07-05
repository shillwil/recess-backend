// This file assumes that environment variables are already loaded.
// In development, 'tsx' handles loading .env files automatically.
// In production, the environment variables should be set in the deployment environment.

// Basic validation to ensure critical variables are present
const requiredEnvVars = ['DATABASE_URL'];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    // Provide a more helpful error message
    const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
    throw new Error(
      `Missing required environment variable: ${varName}. ` +
      `Please ensure it is defined in your ${envFile} file or in your system's environment variables.`
    );
  }
}

// Export the configuration object
export const config = {
  env: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL as string,
  },
  // Add other configurations here as your app grows
  // e.g., firebase, api keys, etc.
};
