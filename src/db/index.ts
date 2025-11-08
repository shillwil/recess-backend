import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

// Create connection pool
const pool = new Pool({
  connectionString: config.database.url,
});

// Test database connection
pool.connect((err, client, done) => {
  if (client) {
    console.log('✅ Successfully connected to PostgreSQL database');
    client.query('SELECT current_database()', (err, result) => {
      done();
      if (err) {
        console.error('❌ Failed to query database:', err);
      } else {
        console.log('✅ Connected to database:', result.rows[0].current_database);
      }
    });
  }
});

// Initialize Drizzle with the connection pool and schema
export const db = drizzle(pool, { schema });

// Export the schema for use in other files
export * from './schema';
