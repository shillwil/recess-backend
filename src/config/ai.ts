// AI Configuration — Gemini API settings and rate limits

export const aiConfig = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '120000', 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || '2', 10),
  },
  rateLimit: {
    freeMonthlyLimit: parseInt(process.env.AI_MAX_GENERATIONS_FREE || '3', 10),
    paidMonthlyLimit: parseInt(process.env.AI_MAX_GENERATIONS_PAID || '20', 10),
  },
};

/**
 * Maps client-facing equipment names to DB values.
 * Client uses underscores (smith_machine), DB uses spaces (smith machine).
 */
const EQUIPMENT_TO_DB: Record<string, string> = {
  smith_machine: 'smith machine',
};

const DB_TO_EQUIPMENT: Record<string, string> = {
  'smith machine': 'smith_machine',
};

/** Valid equipment values the client can send */
export const VALID_EQUIPMENT = [
  'barbell', 'dumbbell', 'cable', 'machine',
  'bodyweight', 'bands', 'kettlebell', 'smith_machine',
] as const;

export type Equipment = typeof VALID_EQUIPMENT[number];

/** Convert a client equipment value to its DB representation */
export function equipmentToDb(value: string): string {
  return EQUIPMENT_TO_DB[value] || value;
}

/** Convert a DB equipment value to the client representation */
export function equipmentFromDb(value: string): string {
  return DB_TO_EQUIPMENT[value] || value;
}

/** Convert an array of client equipment values to DB values */
export function equipmentArrayToDb(values: string[]): string[] {
  return values.map(equipmentToDb);
}

export const VALID_EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const VALID_GOALS = ['hypertrophy', 'strength', 'endurance', 'general', 'powerbuilding'] as const;
