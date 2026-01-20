import { drizzle } from 'drizzle-orm/pg-proxy';  // Proxy wrapper
import { drizzle as directDrizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';
import { SignJWT } from 'jose';  // For proxy JWT

const isDev = process.env.NODE_ENV === 'development';

// Validate required environment variables at module load time
function validateProxyEnvVars(): void {
  if (!isDev) {
    if (!process.env.APP_SECRET) {
      throw new Error('APP_SECRET environment variable is required in production');
    }
    if (!process.env.DATABASE_PROXY) {
      throw new Error('DATABASE_PROXY environment variable is required in production');
    }
  }
}

// Validate on module load
validateProxyEnvVars();

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

// Type for pool configuration
interface PoolConfig {
  connectionString: string;
  max: number;
  ssl?: { rejectUnauthorized: boolean };
}

export function getDirectClient(): Pool {
  // In development, don't set ssl option (let connection string handle it)
  // In production, enable SSL with certificate validation
  // Note: Railway provides valid SSL certificates, so rejectUnauthorized: true is safe
  const poolConfig: PoolConfig = {
    connectionString: getDirectDbUrl(),
    max: 10,
  };

  if (!isDev) {
    poolConfig.ssl = { rejectUnauthorized: true };
  }

  return new Pool(poolConfig);
}

export const directDb = directDrizzle(getDirectClient(), { schema });

// Timeout for database proxy requests (10 seconds)
const PROXY_TIMEOUT_MS = 10000;

// Proxy-wrapped for runtime queries (production only)
async function proxyQueryExecutor(sql: string, params: unknown[], method: string) {
  const APP_SECRET = process.env.APP_SECRET!;
  const DATABASE_PROXY = process.env.DATABASE_PROXY!;

  const encoder = new TextEncoder();
  // Short expiration for database proxy tokens - security best practice
  const jwt = await new SignJWT({ sql, params, method })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(encoder.encode(APP_SECRET));

  // Use AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(`${DATABASE_PROXY}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/jwt' },
      body: jwt,
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Proxy error: ${response.statusText}`);
    // Drizzle handles the actual typing based on the query
    return response.json() as Promise<{ rows: unknown[] }>;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Database proxy request timed out after ${PROXY_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// In development, use direct connection; in production, use proxy
export const db = isDev
  ? directDb
  : drizzle(proxyQueryExecutor, { schema });

// Export the schema for use in other files
export * from './schema';
