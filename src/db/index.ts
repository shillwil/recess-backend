import { drizzle } from 'drizzle-orm/pg-proxy';  // Proxy wrapper
import { drizzle as directDrizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';
import { SignJWT } from 'jose';  // For proxy JWT

const APP_SECRET = process.env.APP_SECRET!;  // Shared with proxy service
const DATABASE_PROXY = process.env.DATABASE_PROXY!;  // e.g., https://proxy.railway.app

// Direct client (for migrations)
function getDirectDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing—link DB service in Railway');
  const parsed = new URL(url);
  // Railway requires SSL for internal connections (self-signed certs)
  parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
}

export function getDirectClient() {
  return new Pool({
    connectionString: getDirectDbUrl(),
    max: 5,
    ssl: {
      rejectUnauthorized: false
    }
  });  // Pool for app if needed
}
export const directDb = directDrizzle(getDirectClient(), { schema });

// Proxy-wrapped for runtime queries
async function proxyQueryExecutor(sql: string, params: unknown[], method: string) {
  const encoder = new TextEncoder();
  const jwt = await new SignJWT({ sql, params, method })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encoder.encode(APP_SECRET));

  const response = await fetch(`${DATABASE_PROXY}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/jwt' },
    body: jwt,
  });
  if (!response.ok) throw new Error(`Proxy error: ${response.statusText}`);
  return response.json() as any;  // Drizzle handles typing
}

export const db = drizzle(proxyQueryExecutor, { schema });  // Use this in your app

// Export the schema for use in other files
export * from './schema';
