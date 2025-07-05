import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

// Create connection pool
const pool = new Pool({
  connectionString: config.database.url,
});

// Initialize Drizzle with the connection pool and schema
export const db = drizzle(pool, { schema });

// Export the schema for use in other files
export * from './schema';
