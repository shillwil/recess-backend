import { drizzle } from 'drizzle-orm/pg-proxy';  // Proxy wrapper
import { drizzle as directDrizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';
import { SignJWT } from 'jose';  // For proxy JWT

const isDev = process.env.NODE_ENV === 'development';

// Direct client (for migrations and development)
function getDirectDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing—link DB service in Railway');

  // In production, ensure SSL is enabled
  if (!isDev && !url.includes('sslmode=')) {
    const parsed = new URL(url);
    parsed.searchParams.set('sslmode', 'require');
    return parsed.toString();
  }

  // In development, use URL as-is (should have sslmode=disable)
  return url;
}

export function getDirectClient(): Pool {
  // In development, don't set ssl option (let connection string handle it)
  // In production, use ssl with rejectUnauthorized: false for Railway
  const poolConfig: any = {
    connectionString: getDirectDbUrl(),
    max: 5,
  };

  if (!isDev) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  return new Pool(poolConfig);
}

export const directDb = directDrizzle(getDirectClient(), { schema });

// Proxy-wrapped for runtime queries (production only)
async function proxyQueryExecutor(sql: string, params: unknown[], method: string) {
  const APP_SECRET = process.env.APP_SECRET!;
  const DATABASE_PROXY = process.env.DATABASE_PROXY!;

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

// In development, use direct connection; in production, use proxy
export const db = isDev
  ? directDb
  : drizzle(proxyQueryExecutor, { schema });

// Export the schema for use in other files
export * from './schema';
