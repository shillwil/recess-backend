// AI / Gemini configuration

export const aiConfig = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  generation: {
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || '2', 10),
    requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '30000', 10),
  },
  rateLimits: {
    free: parseInt(process.env.AI_MAX_GENERATIONS_FREE || '3', 10),
    paid: parseInt(process.env.AI_MAX_GENERATIONS_PAID || '20', 10),
  },
};
