import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../db';
import {
  users,
  exercises,
  aiGenerationLogs,
  workoutPrograms,
  userStrengthProfiles,
} from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { aiConfig, equipmentArrayToDb, equipmentFromDb } from '../config/ai';
import { buildProgramGenerationPrompt, buildRetryPrompt } from '../prompts/programGeneration';
import { createTemplate, getTemplatesByIds, updateTemplateExercises } from './templateService';
import { createProgram, isTemplateUsedInActivePrograms } from './programService';
import { getTrainingHistorySummary, getProgressTrends, formatProgressTrendsForPrompt } from './trainingHistoryService';
import {
  getStrengthProfile,
  upsertStrengthProfile,
  formatStrengthDataForPrompt,
  ManualStrengthInput,
} from './strengthProfileService';
import { logError, logInfo, logWarn } from '../utils/errorResponse';

// ============ Types ============

export interface GenerateProgramInput {
  inspirationSource: string;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  experienceLevel: string;
  goal: string;
  equipment: string[];
  useTrainingHistory: boolean;
  manualStrengthData?: ManualStrengthInput[];
  freeTextPreferences?: string;
  reuseTemplateIds?: string[];
}

interface GeminiWorkoutExercise {
  exerciseId: string;
  orderIndex: number;
  warmupSets: number;
  workingSets: number;
  targetReps: string;
  restSeconds: number;
  notes: string;
}

interface GeminiWorkout {
  dayNumber: number;
  dayLabel: string;
  templateName: string;
  templateDescription: string;
  reuseTemplateId?: string;
  exercises: GeminiWorkoutExercise[];
}

interface GeminiProgramResponse {
  programName: string;
  programDescription: string;
  durationWeeks: number | null;
  workouts: GeminiWorkout[];
}

export interface GenerateProgramResult {
  program: {
    id: string;
    name: string;
    description: string | null;
    daysPerWeek: number;
    durationWeeks: number | null;
    isAiGenerated: boolean;
    aiPrompt: string;
    workouts: Array<{
      dayNumber: number;
      dayLabel: string;
      template: {
        id: string;
        name: string;
        exerciseCount: number;
        wasReused: boolean;
        exercises: Array<{
          exerciseId: string;
          name: string;
          warmupSets: number;
          workingSets: number;
          targetReps: string | null;
          restSeconds: number | null;
          notes: string | null;
        }>;
      };
    }>;
  };
  generation: {
    timeMs: number;
    model: string;
    usedTrainingHistory: boolean;
    trainingHistorySummary: string | null;
    personalizationSource: string;
  };
}

interface ExerciseCatalogEntry {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string;
  movementPattern: string;
  exerciseType: string;
}

// ============ Rate Limiting ============

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetsAt: Date;
  limit: number;
  tier: string;
}

/**
 * Read-only rate limit check. Used by the generation-status endpoint
 * to report remaining quota without modifying any state.
 */
export async function checkAiRateLimit(userId: string): Promise<RateLimitResult> {
  const [user] = await db
    .select({
      aiGenerationsThisMonth: users.aiGenerationsThisMonth,
      aiGenerationsResetAt: users.aiGenerationsResetAt,
      subscriptionTier: users.subscriptionTier,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  const now = new Date();
  const tier = user.subscriptionTier || 'free';
  const limit = tier === 'paid'
    ? aiConfig.rateLimit.paidMonthlyLimit
    : aiConfig.rateLimit.freeMonthlyLimit;

  const resetAt = user.aiGenerationsResetAt;
  const currentCount = user.aiGenerationsThisMonth || 0;

  // If reset time has passed (or never set), counter is effectively 0
  if (!resetAt || now > resetAt) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { allowed: true, remaining: limit, resetsAt: nextMonth, limit, tier };
  }

  if (currentCount >= limit) {
    return { allowed: false, remaining: 0, resetsAt: resetAt, limit, tier };
  }

  return { allowed: true, remaining: limit - currentCount, resetsAt: resetAt, limit, tier };
}

/**
 * Atomically check the rate limit AND reserve a generation slot in a single
 * SQL UPDATE. This prevents TOCTOU race conditions — since the Gemini call
 * takes 10-30s, a separate check-then-increment pattern would let concurrent
 * requests both pass the limit check before either increments.
 *
 * The WHERE clause ensures the UPDATE only succeeds if:
 *   - the monthly reset period has passed (reset needed), OR
 *   - the current count is still under the limit
 *
 * The SET clause uses CASE expressions so both the reset and normal-increment
 * paths are handled atomically within the same statement.
 *
 * If generation fails after reservation, call releaseAiGeneration() to
 * return the slot.
 */
export async function reserveAiGeneration(userId: string): Promise<RateLimitResult> {
  const [user] = await db
    .select({ subscriptionTier: users.subscriptionTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error('User not found');

  const tier = user.subscriptionTier || 'free';
  const limit = tier === 'paid'
    ? aiConfig.rateLimit.paidMonthlyLimit
    : aiConfig.rateLimit.freeMonthlyLimit;

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Single atomic UPDATE: checks limit in WHERE, handles reset vs increment in SET
  const updated = await db.update(users)
    .set({
      aiGenerationsThisMonth: sql`CASE
        WHEN ${users.aiGenerationsResetAt} IS NULL OR ${users.aiGenerationsResetAt} < ${now}
        THEN 1
        ELSE COALESCE(${users.aiGenerationsThisMonth}, 0) + 1
      END`,
      aiGenerationsResetAt: sql`CASE
        WHEN ${users.aiGenerationsResetAt} IS NULL OR ${users.aiGenerationsResetAt} < ${now}
        THEN ${nextMonth}
        ELSE ${users.aiGenerationsResetAt}
      END`,
    })
    .where(
      sql`${users.id} = ${userId} AND (
        ${users.aiGenerationsResetAt} IS NULL
        OR ${users.aiGenerationsResetAt} < ${now}
        OR COALESCE(${users.aiGenerationsThisMonth}, 0) < ${limit}
      )`
    )
    .returning();

  if (updated.length === 0) {
    // No rows updated = rate limit exceeded
    const [current] = await db
      .select({ resetsAt: users.aiGenerationsResetAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      allowed: false,
      remaining: 0,
      resetsAt: current?.resetsAt || nextMonth,
      limit,
      tier,
    };
  }

  const newCount = updated[0].aiGenerationsThisMonth || 1;
  const resetsAt = updated[0].aiGenerationsResetAt || nextMonth;

  return {
    allowed: true,
    remaining: limit - newCount,
    resetsAt,
    limit,
    tier,
  };
}

/**
 * Release a previously reserved generation slot. Called when AI generation
 * fails after reserveAiGeneration() succeeded, so the user isn't charged
 * for a failed attempt.
 */
export async function releaseAiGeneration(userId: string): Promise<void> {
  await db.update(users)
    .set({
      aiGenerationsThisMonth: sql`GREATEST(COALESCE(${users.aiGenerationsThisMonth}, 0) - 1, 0)`,
    })
    .where(eq(users.id, userId));
}

// ============ Exercise Catalog ============

async function fetchExerciseCatalog(equipmentFilter: string[]): Promise<ExerciseCatalogEntry[]> {
  // Convert client equipment values to DB values
  const dbEquipment = equipmentArrayToDb(equipmentFilter);

  const allExercises = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
      equipment: exercises.equipment,
      movementPattern: exercises.movementPattern,
      exerciseType: exercises.exerciseType,
    })
    .from(exercises);

  // Filter to exercises that match the user's equipment and have required fields
  return allExercises
    .filter(e => {
      if (!e.equipment || !e.movementPattern || !e.exerciseType) return false;
      return dbEquipment.includes(e.equipment);
    })
    .map(e => ({
      id: e.id,
      name: e.name,
      primaryMuscles: (e.primaryMuscles || []) as string[],
      secondaryMuscles: (e.secondaryMuscles || []) as string[],
      equipment: equipmentFromDb(e.equipment!),
      movementPattern: e.movementPattern!,
      exerciseType: e.exerciseType!,
    }));
}

// ============ Validation ============

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateGeneratedProgram(
  response: any,
  exerciseIds: Set<string>,
  daysPerWeek: number,
  validReuseTemplateIds?: Set<string>
): ValidationResult {
  const errors: string[] = [];

  if (!response || typeof response !== 'object') {
    errors.push('Response is not an object');
    return { valid: false, errors };
  }

  if (!response.programName || typeof response.programName !== 'string') {
    errors.push('Missing or invalid programName');
  }

  if (!response.programDescription || typeof response.programDescription !== 'string') {
    errors.push('Missing or invalid programDescription');
  }

  if (!Array.isArray(response.workouts)) {
    errors.push('Missing or invalid workouts array');
    return { valid: false, errors };
  }

  if (response.workouts.length !== daysPerWeek) {
    errors.push(`Expected ${daysPerWeek} workouts, got ${response.workouts.length}`);
  }

  for (const workout of response.workouts) {
    if (!workout.dayLabel || typeof workout.dayLabel !== 'string') {
      errors.push(`Workout dayNumber ${workout.dayNumber}: missing dayLabel`);
    }
    if (!workout.templateName || typeof workout.templateName !== 'string') {
      errors.push(`Workout dayNumber ${workout.dayNumber}: missing templateName`);
    }

    // Validate reuseTemplateId if present
    if (workout.reuseTemplateId) {
      if (!validReuseTemplateIds || !validReuseTemplateIds.has(workout.reuseTemplateId)) {
        errors.push(`Invalid reuseTemplateId: ${workout.reuseTemplateId} in "${workout.dayLabel}"`);
      }
    }

    if (!Array.isArray(workout.exercises) || workout.exercises.length === 0) {
      errors.push(`Workout "${workout.dayLabel}": missing or empty exercises`);
      continue;
    }

    for (const exercise of workout.exercises) {
      if (!exerciseIds.has(exercise.exerciseId)) {
        errors.push(`Invalid exerciseId: ${exercise.exerciseId} in "${workout.dayLabel}"`);
      }

      if (typeof exercise.workingSets !== 'number' || exercise.workingSets < 1 || exercise.workingSets > 10) {
        errors.push(`Invalid workingSets: ${exercise.workingSets} in "${workout.dayLabel}"`);
      }

      if (typeof exercise.restSeconds !== 'number' || exercise.restSeconds < 15 || exercise.restSeconds > 600) {
        errors.push(`Invalid restSeconds: ${exercise.restSeconds} in "${workout.dayLabel}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Gemini API ============

function parseGeminiResponse(text: string): GeminiProgramResponse {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  return JSON.parse(cleaned);
}

async function callGemini(
  prompt: string,
  correlationId: string
): Promise<{ text: string; promptTokens?: number; completionTokens?: number }> {
  if (!aiConfig.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const genAI = new GoogleGenerativeAI(aiConfig.gemini.apiKey);
  const model = genAI.getGenerativeModel({
    model: aiConfig.gemini.model,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('GEMINI_TIMEOUT')),
      aiConfig.gemini.requestTimeoutMs
    );
  });

  const generatePromise = model.generateContent(prompt);

  const result = await Promise.race([generatePromise, timeoutPromise]);
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  return {
    text,
    promptTokens: usage?.promptTokenCount,
    completionTokens: usage?.candidatesTokenCount,
  };
}

// ============ Main Generation Flow ============

export async function generateProgram(
  userId: string,
  input: GenerateProgramInput,
  correlationId: string
): Promise<GenerateProgramResult> {
  const startTime = Date.now();
  let retryCount = 0;
  let personalizationSource = 'none';
  let trainingHistorySummary: string | null = null;
  let lastErrors: string[] = [];

  // 1. Fetch exercise catalog (pre-filtered by equipment)
  const catalog = await fetchExerciseCatalog(input.equipment);
  if (catalog.length === 0) {
    throw new AiGenerationError(
      'No exercises found matching your available equipment. Please select different equipment.',
      400
    );
  }

  const exerciseIds = new Set(catalog.map(e => e.id));

  // 2. Handle personalization
  let formattedProgressTrends: string | null = null;

  if (input.useTrainingHistory) {
    // Try computed training history first
    trainingHistorySummary = await getTrainingHistorySummary(userId);

    if (trainingHistorySummary) {
      personalizationSource = 'training_history';
    } else if (input.manualStrengthData && input.manualStrengthData.length > 0) {
      // Save manual strength data for future use
      const profile = await upsertStrengthProfile(userId, input.manualStrengthData);
      const strengthPrompt = formatStrengthDataForPrompt(profile.entries);
      if (strengthPrompt) {
        trainingHistorySummary = strengthPrompt;
        personalizationSource = 'manual_profile';
      }
    } else {
      // Check if user has an existing strength profile
      const existingProfile = await getStrengthProfile(userId);
      if (existingProfile && existingProfile.entries.length > 0) {
        const strengthPrompt = formatStrengthDataForPrompt(existingProfile.entries);
        if (strengthPrompt) {
          trainingHistorySummary = strengthPrompt;
          personalizationSource = 'manual_profile';
        }
      }
      // Otherwise, fall back to generic defaults (trainingHistorySummary stays null)
    }

    // Fetch longer-term progress trends (stalls, weight progression, volume trends)
    const progressTrends = await getProgressTrends(userId);
    if (progressTrends) {
      formattedProgressTrends = formatProgressTrendsForPrompt(progressTrends);
    }
  }

  // 3. Handle template reuse
  // Fetch selected templates, filter to only AI-generated ones not in active programs
  let reuseTemplateData: Array<{
    id: string;
    name: string;
    exercises: Array<{
      exerciseId: string;
      exerciseName: string;
      workingSets: number;
      targetReps: string | null;
    }>;
  }> | null = null;
  const validReuseTemplateIds = new Set<string>();

  if (input.reuseTemplateIds && input.reuseTemplateIds.length > 0) {
    const templates = await getTemplatesByIds(input.reuseTemplateIds, userId);

    // Filter: only AI-generated templates not currently in an active program
    const safeTemplates = [];
    for (const t of templates) {
      if (!t.isAiGenerated) continue;
      const inActiveProgram = await isTemplateUsedInActivePrograms(t.id);
      if (!inActiveProgram) {
        safeTemplates.push(t);
      }
    }

    if (safeTemplates.length > 0) {
      reuseTemplateData = safeTemplates.map(t => ({
        id: t.id,
        name: t.name,
        exercises: t.exercises.map(e => ({
          exerciseId: e.exerciseId,
          exerciseName: e.exercise.name,
          workingSets: e.workingSets,
          targetReps: e.targetReps,
        })),
      }));

      for (const t of safeTemplates) {
        validReuseTemplateIds.add(t.id);
      }
    }
  }

  // 4. Build the base prompt
  const basePrompt = buildProgramGenerationPrompt({
    inspirationSource: input.inspirationSource,
    daysPerWeek: input.daysPerWeek,
    sessionDurationMinutes: input.sessionDurationMinutes,
    experienceLevel: input.experienceLevel,
    goal: input.goal,
    equipment: input.equipment,
    freeTextPreferences: input.freeTextPreferences,
    trainingHistory: trainingHistorySummary,
    progressTrends: formattedProgressTrends,
    existingTemplates: reuseTemplateData,
    exerciseCatalog: catalog,
  });

  // 5. Call Gemini with retry logic
  let parsedResponse: GeminiProgramResponse | null = null;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  for (let attempt = 0; attempt <= aiConfig.gemini.maxRetries; attempt++) {
    try {
      const prompt = attempt === 0
        ? basePrompt
        : buildRetryPrompt(basePrompt, lastErrors);

      const geminiResult = await callGemini(prompt, correlationId);
      promptTokens = geminiResult.promptTokens;
      completionTokens = geminiResult.completionTokens;

      const parsed = parseGeminiResponse(geminiResult.text);
      const validation = validateGeneratedProgram(
        parsed,
        exerciseIds,
        input.daysPerWeek,
        validReuseTemplateIds.size > 0 ? validReuseTemplateIds : undefined
      );

      if (validation.valid) {
        parsedResponse = parsed;
        retryCount = attempt;
        break;
      }

      lastErrors = validation.errors;
      retryCount = attempt;

      logWarn('aiService', `Validation failed on attempt ${attempt + 1}: ${validation.errors.join('; ')}`, correlationId);
    } catch (error) {
      retryCount = attempt;

      if (error instanceof Error && error.message === 'GEMINI_TIMEOUT') {
        // Log and throw timeout — don't retry timeouts
        await logGenerationAttempt(userId, input, {
          success: false,
          errorMessage: 'Gemini API timeout',
          retryCount,
          generationTimeMs: Date.now() - startTime,
          promptTokens,
          completionTokens,
          personalizationSource,
        });
        throw new AiGenerationError(
          'Generation is taking longer than expected. Please try again.',
          503,
          true
        );
      }

      if (attempt === aiConfig.gemini.maxRetries) {
        await logGenerationAttempt(userId, input, {
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          retryCount,
          generationTimeMs: Date.now() - startTime,
          promptTokens,
          completionTokens,
          personalizationSource,
        });
        throw new AiGenerationError(
          'Program generation failed. Please try again.',
          502,
          true
        );
      }

      lastErrors = [error instanceof Error ? error.message : 'Failed to parse response'];
      logWarn('aiService', `Attempt ${attempt + 1} failed: ${lastErrors[0]}`, correlationId);
    }
  }

  if (!parsedResponse) {
    // All retries exhausted with validation errors
    await logGenerationAttempt(userId, input, {
      success: false,
      errorMessage: `Validation failed after ${retryCount + 1} attempts: ${lastErrors.join('; ')}`,
      retryCount,
      generationTimeMs: Date.now() - startTime,
      promptTokens,
      completionTokens,
      personalizationSource,
    });
    throw new AiGenerationError(
      "We couldn't generate a program right now. Please try again.",
      502,
      true
    );
  }

  const generationTimeMs = Date.now() - startTime;

  // 6. Create/update templates and program using existing services
  const exerciseNameMap = new Map(catalog.map(e => [e.id, e.name]));

  const createdTemplates: Array<{
    dayNumber: number;
    dayLabel: string;
    templateId: string;
    templateName: string;
    wasReused: boolean;
    exercises: Array<{
      exerciseId: string;
      name: string;
      warmupSets: number;
      workingSets: number;
      targetReps: string | null;
      restSeconds: number | null;
      notes: string | null;
    }>;
  }> = [];

  for (const workout of parsedResponse.workouts) {
    const exerciseInputs = workout.exercises.map((e, idx) => ({
      exerciseId: e.exerciseId,
      orderIndex: e.orderIndex ?? idx,
      warmupSets: e.warmupSets ?? 0,
      workingSets: e.workingSets,
      targetReps: e.targetReps || undefined,
      restSeconds: e.restSeconds || undefined,
      notes: e.notes || undefined,
    }));

    const exerciseSummary = workout.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      name: exerciseNameMap.get(e.exerciseId) || 'Unknown',
      warmupSets: e.warmupSets ?? 0,
      workingSets: e.workingSets,
      targetReps: e.targetReps || null,
      restSeconds: e.restSeconds || null,
      notes: e.notes || null,
    }));

    // Reuse path: update existing template's exercises in-place
    if (workout.reuseTemplateId && validReuseTemplateIds.has(workout.reuseTemplateId)) {
      const updated = await updateTemplateExercises(
        workout.reuseTemplateId,
        userId,
        exerciseInputs
      );

      if (!updated) {
        throw new AiGenerationError('Failed to update reused template', 500);
      }

      createdTemplates.push({
        dayNumber: workout.dayNumber,
        dayLabel: workout.dayLabel,
        templateId: workout.reuseTemplateId,
        templateName: updated.name,
        wasReused: true,
        exercises: exerciseSummary,
      });
    } else {
      // Create path: new template (existing behavior)
      const template = await createTemplate(userId, {
        name: workout.templateName,
        description: workout.templateDescription || undefined,
        isAiGenerated: true,
        aiPrompt: input.inspirationSource,
        exercises: exerciseInputs,
      });

      createdTemplates.push({
        dayNumber: workout.dayNumber,
        dayLabel: workout.dayLabel,
        templateId: template.id,
        templateName: template.name,
        wasReused: false,
        exercises: exerciseSummary,
      });
    }
  }

  // Create program
  const program = await createProgram(userId, {
    name: parsedResponse.programName,
    description: parsedResponse.programDescription || undefined,
    daysPerWeek: input.daysPerWeek,
    durationWeeks: parsedResponse.durationWeeks ?? undefined,
    isAiGenerated: true,
    aiPrompt: input.inspirationSource,
    aiModel: aiConfig.gemini.model,
    aiGenerationTimeMs: generationTimeMs,
    workouts: createdTemplates.map(t => ({
      dayNumber: t.dayNumber,
      templateId: t.templateId,
      dayLabel: t.dayLabel,
    })),
  });

  // 7. Log successful generation (rate limit slot was already reserved by the caller)
  await logGenerationAttempt(userId, input, {
    success: true,
    programId: program.id,
    retryCount,
    generationTimeMs,
    promptTokens,
    completionTokens,
    personalizationSource,
  });

  logInfo('aiService', `Program generated successfully in ${generationTimeMs}ms`, correlationId, {
    programId: program.id,
    model: aiConfig.gemini.model,
    retryCount,
  });

  return {
    program: {
      id: program.id,
      name: program.name,
      description: program.description,
      daysPerWeek: program.daysPerWeek,
      durationWeeks: program.durationWeeks,
      isAiGenerated: true,
      aiPrompt: input.inspirationSource,
      workouts: createdTemplates.map(t => ({
        dayNumber: t.dayNumber,
        dayLabel: t.dayLabel,
        template: {
          id: t.templateId,
          name: t.templateName,
          exerciseCount: t.exercises.length,
          wasReused: t.wasReused,
          exercises: t.exercises,
        },
      })),
    },
    generation: {
      timeMs: generationTimeMs,
      model: aiConfig.gemini.model,
      usedTrainingHistory: personalizationSource !== 'none',
      trainingHistorySummary,
      personalizationSource,
    },
  };
}

// ============ Logging ============

async function logGenerationAttempt(
  userId: string,
  input: GenerateProgramInput,
  result: {
    success: boolean;
    programId?: string;
    errorMessage?: string;
    retryCount: number;
    generationTimeMs: number;
    promptTokens?: number;
    completionTokens?: number;
    personalizationSource: string;
  }
): Promise<void> {
  try {
    await db.insert(aiGenerationLogs).values({
      userId,
      inspirationSource: input.inspirationSource,
      daysPerWeek: input.daysPerWeek,
      sessionDurationMinutes: input.sessionDurationMinutes,
      experienceLevel: input.experienceLevel,
      goal: input.goal,
      equipment: input.equipment,
      usedTrainingHistory: input.useTrainingHistory,
      freeTextPreferences: input.freeTextPreferences || null,
      programId: result.programId || null,
      success: result.success,
      errorMessage: result.errorMessage || null,
      retryCount: result.retryCount,
      generationTimeMs: result.generationTimeMs,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      personalizationSource: result.personalizationSource,
    });
  } catch (error) {
    // Don't let logging failures break the main flow
    console.error('Failed to log AI generation attempt:', error);
  }
}

// ============ Rate Program ============

export async function rateProgram(
  userId: string,
  programId: string,
  rating: number,
  feedback?: string
): Promise<void> {
  // Verify program exists, belongs to user, and is AI-generated
  const [program] = await db
    .select({
      id: workoutPrograms.id,
      userId: workoutPrograms.userId,
      isAiGenerated: workoutPrograms.isAiGenerated,
    })
    .from(workoutPrograms)
    .where(eq(workoutPrograms.id, programId))
    .limit(1);

  if (!program) {
    throw new AiGenerationError('Program not found', 404);
  }

  if (program.userId !== userId) {
    throw new AiGenerationError('Program not found', 404);
  }

  if (!program.isAiGenerated) {
    throw new AiGenerationError('Only AI-generated programs can be rated', 400);
  }

  // Update program rating
  await db.update(workoutPrograms)
    .set({ rating })
    .where(eq(workoutPrograms.id, programId));

  // Update generation log with feedback
  const [log] = await db
    .select({ id: aiGenerationLogs.id })
    .from(aiGenerationLogs)
    .where(eq(aiGenerationLogs.programId, programId))
    .limit(1);

  if (log) {
    await db.update(aiGenerationLogs)
      .set({
        userRating: rating,
        userFeedback: feedback || null,
      })
      .where(eq(aiGenerationLogs.id, log.id));
  }
}

// ============ Generation Status ============

export async function getGenerationStatus(userId: string): Promise<{
  generationsUsed: number;
  generationsLimit: number;
  generationsRemaining: number;
  resetsAt: string;
  tier: string;
}> {
  const rateLimit = await checkAiRateLimit(userId);

  return {
    generationsUsed: rateLimit.limit - rateLimit.remaining,
    generationsLimit: rateLimit.limit,
    generationsRemaining: rateLimit.remaining,
    resetsAt: rateLimit.resetsAt.toISOString(),
    tier: rateLimit.tier,
  };
}

// ============ Error Class ============

export class AiGenerationError extends Error {
  statusCode: number;
  retryable: boolean;

  constructor(message: string, statusCode: number = 500, retryable: boolean = false) {
    super(message);
    this.name = 'AiGenerationError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}
