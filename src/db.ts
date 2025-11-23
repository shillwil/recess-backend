import { drizzle } from 'drizzle-orm/pg-proxy';  // Proxy wrapper
import { drizzle as directDrizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema';
import { SignJWT } from 'jose';  // For proxy JWT

const APP_SECRET = process.env.APP_SECRET;  // Shared with proxy service (optional)
const DATABASE_PROXY = process.env.DATABASE_PROXY;  // e.g., https://proxy.railway.app (optional)

// Direct DB URL (Railway private TCP—no proxy)
function getDirectDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing—link DB service in Railway');
  const parsed = new URL(url);
  // Railway requires SSL for internal connections (self-signed certs)
  parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
}

// Direct client (for migrations)
export function getDirectClient() {
  return new Pool({
    connectionString: getDirectDbUrl(),
    max: 5,
    ssl: {
      rejectUnauthorized: false  // Accept self-signed certs (Railway uses these)
    }
  });  // Pool for app if needed
}
export const directDb = directDrizzle(getDirectClient(), { schema });

// Proxy-wrapped for runtime queries
async function proxyQueryExecutor(sql: string, params: unknown[], method: string) {
  if (!APP_SECRET || !DATABASE_PROXY) {
    throw new Error('DATABASE_PROXY and APP_SECRET must be set to use proxy mode');
  }
  
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

// Use proxy if DATABASE_PROXY is set, otherwise use direct connection
export const db = DATABASE_PROXY 
  ? drizzle(proxyQueryExecutor, { schema })  // Proxy mode
  : directDb;  // Direct mode (fallback)
