// drizzle.config.ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Detect if we're on Railway (RAILWAY_ENVIRONMENT_NAME is set there)
const isRailway = !!process.env.RAILWAY_ENVIRONMENT_NAME;

console.log("[drizzle.config] All env vars:", Object.keys(process.env));

if (!isRailway) {
  // Local development: load from .env.development / .env.test / etc.
  const env = process.env.NODE_ENV || 'development';
  config({ path: `./.env.${env}` });
}

// At this point, either:
// - Locally: dotenv has populated process.env
// - Railway: real env vars are present (no dotenv)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // This is what you're seeing in logs
  throw new Error('DATABASE_URL must be set in environment variables');
}

export default defineConfig({
  out: './drizzle/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  verbose: true,
  strict: true,
});