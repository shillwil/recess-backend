import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../src/db/schema.ts';  // Adjusted path based on project structure
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env for local dev only
if (process.env.NODE_ENV === 'development') {
  config({ path: '.env.development' });
}

// Direct DB URL (Railway private TCP—no proxy)
function getDirectDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing—set in .env.development locally or link in Railway');
  const parsed = new URL(url);
  if (process.env.NODE_ENV !== 'development') {
    parsed.searchParams.set('sslmode', 'require');
  }
  return parsed.toString();
}

async function runMigrations(): Promise<void> {
  console.log('🔄 Starting Drizzle migrations...');
  const pool = new Pool({
    connectionString: getDirectDbUrl(),
    max: 1,
  });  // Single conn for safety
  const db = drizzle(pool, { schema });

  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, '../drizzle/migrations') });
    console.log('✅ Migrations applied successfully.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);  // Fail deploy if critical
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}

export { runMigrations };
