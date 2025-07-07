import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load environment variables from the correct .env file
const env = process.env.NODE_ENV || 'development';
config({ path: `.env.${env}` });

// Check for the required DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in the environment variables');
}


export default defineConfig({
  out: './drizzle/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true
});
