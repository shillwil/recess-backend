import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../db';
import {
  users,
  exercises,
  workoutPrograms,
  workoutTemplates,
  templateExercises,
  programWeeks,
  aiGenerationLogs,
  userStrengthProfiles,
} from '../db/schema';
import { eq, and, inArray, ilike } from 'drizzle-orm';
import { aiConfig } from '../config/ai';
import { buildProgramGenerationPrompt, ExerciseCatalogEntry } from '../prompts/programGeneration';
import { TrainingHistoryService } from './trainingHistoryService';

// --- Types ---

export interface GenerateProgramRequest {
  inspirationSource: string;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  experienceLevel: string;
  goal: string;
  equipment: string[];
  useTrainingHistory: boolean;
  manualStrengthData?: Array<{
    exerciseName: string;
    weight: number;
    unit: 'lb' | 'kg';
    reps: number;
    sets: number;
  }>;
  freeTextPreferences?: string;
}

interface GeminiExercise {
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
  exercises: GeminiExercise[];
}

interface GeminiProgramResponse {
  programName: string;
  programDescription: string;
  durationWeeks: number | null;
  workouts: GeminiWorkout[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GenerationResult {
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
        exercises: Array<{
          exerciseId: string;
          name: string;
          warmupSets: number;
          workingSets: number;
          targetReps: string;
          restSeconds: number;
          notes: string;
        }>;
      };
    }>;
  };
  generation: {
    timeMs: number;
    model: string;
    usedTrainingHistory: boolean;
    personalizationSource: 'training_history' | 'manual_profile' | 'none';
    trainingHistorySummary: string | null;
  };
}

// --- Service ---

export class AiService {
  /**
   * Check if user is within their monthly generation limit.
   * Returns rate limit status WITHOUT incrementing the counter.
   */
  static async checkRateLimit(userId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetsAt: Date;
    limit: number;
    tier: string;
  }> {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new Error('User not found');

    const now = new Date();
    const tier = user.subscriptionTier || 'free';
    const limit = tier === 'paid' ? aiConfig.rateLimits.paid : aiConfig.rateLimits.free;

    let resetAt = user.aiGenerationsResetAt;
    let currentCount = user.aiGenerationsThisMonth || 0;

    // If reset time has passed (or never set), reset counter
    if (!resetAt || now > resetAt) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      await db.update(users)
        .set({
          aiGenerationsThisMonth: 0,
          aiGenerationsResetAt: nextMonth,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      resetAt = nextMonth;
      currentCount = 0;
    }

    return {
      allowed: currentCount < limit,
      remaining: Math.max(0, limit - currentCount),
      resetsAt: resetAt!,
      limit,
      tier,
    };
  }

  /**
   * Increment the user's generation count. Only call on SUCCESS.
   */
  private static async incrementGenerationCount(userId: string): Promise<void> {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) return;

    await db.update(users)
      .set({
        aiGenerationsThisMonth: (user.aiGenerationsThisMonth || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  /**
   * Fetch the exercise catalog filtered by user's available equipment.
   * Exercises with null equipment (bodyweight) are always included.
   */
  static async getFilteredExerciseCatalog(equipment: string[]): Promise<ExerciseCatalogEntry[]> {
    const allExercises = await db.select({
      id: exercises.id,
      name: exercises.name,
      muscleGroups: exercises.muscleGroups,
      equipment: exercises.equipment,
    }).from(exercises);

    // Filter: include exercises where equipment is in user's list OR is null (bodyweight)
    return allExercises.filter(ex =>
      ex.equipment === null || equipment.includes(ex.equipment)
    );
  }

  /**
   * Main program generation orchestrator.
   */
  static async generateProgram(
    userId: string,
    request: GenerateProgramRequest
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastErrors: string[] = [];
    let personalizationSource: 'training_history' | 'manual_profile' | 'none' = 'none';
    let trainingHistorySummary: string | null = null;

    // 1. Fetch filtered exercise catalog
    const catalog = await this.getFilteredExerciseCatalog(request.equipment);
    if (catalog.length === 0) {
      throw new AiGenerationError(
        'No exercises found matching your available equipment. Please select different equipment.',
        400
      );
    }

    const exerciseIdSet = new Set(catalog.map(e => e.id));
    const exerciseMap = new Map(catalog.map(e => [e.id, e]));

    // 2. Build personalization context
    if (request.useTrainingHistory) {
      // Try training history first
      const history = await TrainingHistoryService.getUserTrainingSummary(userId);

      if (history && history.hasHistory) {
        trainingHistorySummary = history.summaryText;
        personalizationSource = 'training_history';
      } else if (request.manualStrengthData && request.manualStrengthData.length > 0) {
        // Fall back to manual strength data
        trainingHistorySummary = TrainingHistoryService.formatManualStrengthData(
          request.manualStrengthData
        );
        personalizationSource = 'manual_profile';

        // Save manual strength data to user's profile for future use
        await this.saveManualStrengthProfile(userId, request.manualStrengthData, catalog);
      }
      // If neither available, personalizationSource stays 'none'
    }

    // 3. Build prompt
    const prompt = buildProgramGenerationPrompt({
      inspirationSource: request.inspirationSource,
      daysPerWeek: request.daysPerWeek,
      sessionDurationMinutes: request.sessionDurationMinutes,
      experienceLevel: request.experienceLevel,
      goal: request.goal,
      equipment: request.equipment,
      freeTextPreferences: request.freeTextPreferences,
      trainingHistory: trainingHistorySummary,
      exerciseCatalog: catalog,
    });

    // 4. Call Gemini with retry logic
    const maxAttempts = aiConfig.generation.maxRetries + 1;
    let geminiResponse: GeminiProgramResponse | null = null;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      retryCount = attempt - 1;

      try {
        let currentPrompt = prompt;
        if (attempt > 1 && lastErrors.length > 0) {
          currentPrompt += `\n\n## CORRECTION REQUIRED\nYour previous response had these errors:\n${lastErrors.map(e => `- ${e}`).join('\n')}\n\nPlease fix these issues and return ONLY a valid JSON object.`;
        }

        const result = await this.callGemini(currentPrompt);
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;

        // Parse JSON
        let parsed: GeminiProgramResponse;
        try {
          parsed = JSON.parse(result.text);
        } catch {
          lastErrors = ['Response was not valid JSON. Return ONLY a JSON object, no markdown or extra text.'];
          console.error(`[AI] Attempt ${attempt}: Invalid JSON from Gemini`);
          if (attempt === maxAttempts) break;
          continue;
        }

        // Validate
        const validation = this.validateGeneratedProgram(
          parsed,
          exerciseIdSet,
          request.daysPerWeek,
          request.equipment,
          exerciseMap
        );

        if (!validation.valid) {
          lastErrors = validation.errors;
          console.error(`[AI] Attempt ${attempt}: Validation failed:`, validation.errors);
          if (attempt === maxAttempts) break;
          continue;
        }

        geminiResponse = parsed;
        break;

      } catch (error) {
        if (error instanceof AiGenerationError) throw error;

        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[AI] Attempt ${attempt} error:`, errMsg);

        if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
          // Log the failed attempt
          await this.logGeneration(userId, request, {
            success: false,
            errorMessage: 'Gemini API timeout',
            retryCount,
            generationTimeMs: Date.now() - startTime,
            personalizationSource,
            promptTokens,
            completionTokens,
          });
          throw new AiGenerationError(
            'Generation is taking longer than expected. Please try again.',
            503,
            true
          );
        }

        if (attempt === maxAttempts) {
          await this.logGeneration(userId, request, {
            success: false,
            errorMessage: errMsg,
            retryCount,
            generationTimeMs: Date.now() - startTime,
            personalizationSource,
            promptTokens,
            completionTokens,
          });
          throw new AiGenerationError(
            'Program generation failed. Please try again.',
            502,
            true
          );
        }
      }
    }

    const generationTimeMs = Date.now() - startTime;

    // All retries exhausted
    if (!geminiResponse) {
      await this.logGeneration(userId, request, {
        success: false,
        errorMessage: `Validation failed after ${maxAttempts} attempts: ${lastErrors.join('; ')}`,
        retryCount,
        generationTimeMs,
        personalizationSource,
        promptTokens,
        completionTokens,
      });
      throw new AiGenerationError(
        'We couldn\'t generate a program right now. Please try again.',
        502,
        true
      );
    }

    // 5. Save program to database
    const savedProgram = await this.saveProgramToDatabase(
      userId,
      geminiResponse,
      request,
      exerciseMap,
      generationTimeMs
    );

    // 6. Increment generation count (only on success!)
    await this.incrementGenerationCount(userId);

    // 7. Log successful generation
    await this.logGeneration(userId, request, {
      success: true,
      programId: savedProgram.id,
      retryCount,
      generationTimeMs,
      personalizationSource,
      promptTokens,
      completionTokens,
    });

    // 8. Build response
    return {
      program: {
        id: savedProgram.id,
        name: geminiResponse.programName,
        description: geminiResponse.programDescription,
        daysPerWeek: request.daysPerWeek,
        durationWeeks: null,
        isAiGenerated: true,
        aiPrompt: request.inspirationSource,
        workouts: savedProgram.workouts,
      },
      generation: {
        timeMs: generationTimeMs,
        model: aiConfig.gemini.model,
        usedTrainingHistory: request.useTrainingHistory,
        personalizationSource,
        trainingHistorySummary,
      },
    };
  }

  /**
   * Call Gemini API with timeout.
   */
  private static async callGemini(prompt: string): Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
  }> {
    if (!aiConfig.gemini.apiKey) {
      throw new AiGenerationError('AI service is not configured. Missing GEMINI_API_KEY.', 503);
    }

    const genAI = new GoogleGenerativeAI(aiConfig.gemini.apiKey);
    const model = genAI.getGenerativeModel({
      model: aiConfig.gemini.model,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiConfig.generation.requestTimeoutMs);

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const response = result.response;
      const text = response.text();
      const usage = response.usageMetadata;

      return {
        text,
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Validate the Gemini response against our constraints.
   */
  private static validateGeneratedProgram(
    response: GeminiProgramResponse,
    exerciseIds: Set<string>,
    daysPerWeek: number,
    equipment: string[],
    exerciseCatalog: Map<string, ExerciseCatalogEntry>
  ): ValidationResult {
    const errors: string[] = [];

    // 1. Check structure
    if (!response.programName || typeof response.programName !== 'string') {
      errors.push('Missing or invalid programName');
    }
    if (!response.workouts || !Array.isArray(response.workouts)) {
      errors.push('Missing or invalid workouts array');
      return { valid: false, errors };
    }

    // 2. Check workout count
    if (response.workouts.length !== daysPerWeek) {
      errors.push(`Expected ${daysPerWeek} workouts, got ${response.workouts.length}`);
    }

    // 3. Validate each workout
    for (const workout of response.workouts) {
      if (!workout.exercises || !Array.isArray(workout.exercises)) {
        errors.push(`Workout "${workout.dayLabel || workout.dayNumber}" has no exercises array`);
        continue;
      }

      if (workout.exercises.length < 3) {
        errors.push(`Workout "${workout.dayLabel}" has only ${workout.exercises.length} exercises (minimum 3)`);
      }

      if (workout.exercises.length > 10) {
        errors.push(`Workout "${workout.dayLabel}" has ${workout.exercises.length} exercises (maximum 10)`);
      }

      for (const exercise of workout.exercises) {
        // Validate exercise ID exists in catalog
        if (!exerciseIds.has(exercise.exerciseId)) {
          errors.push(`Invalid exerciseId: ${exercise.exerciseId} in "${workout.dayLabel}"`);
        }

        // Validate equipment match
        const catalogExercise = exerciseCatalog.get(exercise.exerciseId);
        if (catalogExercise && catalogExercise.equipment && !equipment.includes(catalogExercise.equipment)) {
          errors.push(`Exercise ${catalogExercise.name} requires ${catalogExercise.equipment} which user doesn't have`);
        }

        // Validate numeric ranges
        if (typeof exercise.workingSets !== 'number' || exercise.workingSets < 1 || exercise.workingSets > 10) {
          errors.push(`Invalid workingSets: ${exercise.workingSets} for exercise in "${workout.dayLabel}"`);
        }
        if (typeof exercise.restSeconds !== 'number' || exercise.restSeconds < 15 || exercise.restSeconds > 600) {
          errors.push(`Invalid restSeconds: ${exercise.restSeconds} for exercise in "${workout.dayLabel}"`);
        }
        if (typeof exercise.warmupSets !== 'number' || exercise.warmupSets < 0 || exercise.warmupSets > 5) {
          errors.push(`Invalid warmupSets: ${exercise.warmupSets} for exercise in "${workout.dayLabel}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Save the AI-generated program to the database.
   * Creates: workoutProgram, workoutTemplates, templateExercises, programWeeks.
   */
  private static async saveProgramToDatabase(
    userId: string,
    geminiResponse: GeminiProgramResponse,
    request: GenerateProgramRequest,
    exerciseMap: Map<string, ExerciseCatalogEntry>,
    generationTimeMs: number
  ): Promise<{
    id: string;
    workouts: GenerationResult['program']['workouts'];
  }> {
    // Create the program
    const [program] = await db.insert(workoutPrograms).values({
      userId,
      name: geminiResponse.programName,
      description: geminiResponse.programDescription,
      durationWeeks: null, // AI programs are ongoing
      isAiGenerated: true,
      aiPrompt: request.inspirationSource,
      aiModel: aiConfig.gemini.model,
      aiGenerationTimeMs: generationTimeMs,
    }).returning();

    const workoutsResult: GenerationResult['program']['workouts'] = [];

    // Create templates and link them to program weeks
    for (const workout of geminiResponse.workouts) {
      // Create template
      const [template] = await db.insert(workoutTemplates).values({
        userId,
        name: workout.templateName,
        description: workout.templateDescription,
        isAiGenerated: true,
        aiPrompt: request.inspirationSource,
      }).returning();

      // Create template exercises
      const exerciseResults: GenerationResult['program']['workouts'][0]['template']['exercises'] = [];

      for (const ex of workout.exercises) {
        const catalogEntry = exerciseMap.get(ex.exerciseId);
        await db.insert(templateExercises).values({
          templateId: template.id,
          exerciseId: ex.exerciseId,
          orderIndex: ex.orderIndex,
          warmupSets: ex.warmupSets,
          workingSets: ex.workingSets,
          targetReps: ex.targetReps,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
        });

        exerciseResults.push({
          exerciseId: ex.exerciseId,
          name: catalogEntry?.name || 'Unknown',
          warmupSets: ex.warmupSets,
          workingSets: ex.workingSets,
          targetReps: ex.targetReps,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
        });
      }

      // Link template to program via programWeeks (weekNumber 1 for repeating programs)
      await db.insert(programWeeks).values({
        programId: program.id,
        weekNumber: 1,
        dayNumber: workout.dayNumber,
        templateId: template.id,
      });

      workoutsResult.push({
        dayNumber: workout.dayNumber,
        dayLabel: workout.dayLabel,
        template: {
          id: template.id,
          name: workout.templateName,
          exerciseCount: workout.exercises.length,
          exercises: exerciseResults,
        },
      });
    }

    return {
      id: program.id,
      workouts: workoutsResult,
    };
  }

  /**
   * Log a generation attempt (success or failure) to ai_generation_logs.
   */
  private static async logGeneration(
    userId: string,
    request: GenerateProgramRequest,
    result: {
      success: boolean;
      programId?: string;
      errorMessage?: string;
      retryCount: number;
      generationTimeMs: number;
      personalizationSource: 'training_history' | 'manual_profile' | 'none';
      promptTokens?: number;
      completionTokens?: number;
    }
  ): Promise<void> {
    try {
      await db.insert(aiGenerationLogs).values({
        userId,
        inspirationSource: request.inspirationSource,
        daysPerWeek: request.daysPerWeek,
        sessionDurationMinutes: request.sessionDurationMinutes,
        experienceLevel: request.experienceLevel,
        goal: request.goal,
        equipment: request.equipment,
        usedTrainingHistory: request.useTrainingHistory,
        freeTextPreferences: request.freeTextPreferences || null,
        personalizationSource: result.personalizationSource,
        programId: result.programId || null,
        success: result.success,
        errorMessage: result.errorMessage || null,
        retryCount: result.retryCount,
        generationTimeMs: result.generationTimeMs,
        promptTokens: result.promptTokens || null,
        completionTokens: result.completionTokens || null,
      });
    } catch (error) {
      // Don't let logging failures break the main flow
      console.error('[AI] Failed to log generation attempt:', error);
    }
  }

  /**
   * Save manual strength data to user_strength_profiles.
   * Attempts to match exercise names to catalog entries.
   */
  private static async saveManualStrengthProfile(
    userId: string,
    entries: Array<{
      exerciseName: string;
      weight: number;
      unit: 'lb' | 'kg';
      reps: number;
      sets: number;
    }>,
    catalog: ExerciseCatalogEntry[]
  ): Promise<void> {
    const enrichedEntries = entries.map(entry => {
      const matched = this.fuzzyMatchExercise(entry.exerciseName, catalog);
      return {
        exerciseId: matched?.id || '',
        exerciseName: matched?.name || entry.exerciseName,
        weight: entry.weight,
        unit: entry.unit,
        reps: entry.reps,
        sets: entry.sets,
      };
    });

    // Upsert: delete existing and insert new
    const existing = await db.select().from(userStrengthProfiles)
      .where(eq(userStrengthProfiles.userId, userId)).limit(1);

    if (existing.length > 0) {
      await db.update(userStrengthProfiles)
        .set({
          strengthEntries: enrichedEntries,
          updatedAt: new Date(),
        })
        .where(eq(userStrengthProfiles.userId, userId));
    } else {
      await db.insert(userStrengthProfiles).values({
        userId,
        strengthEntries: enrichedEntries,
      });
    }
  }

  /**
   * Fuzzy match an exercise name to a catalog entry.
   * Case-insensitive substring match; picks the shortest matching name.
   */
  static fuzzyMatchExercise(
    name: string,
    catalog: ExerciseCatalogEntry[]
  ): ExerciseCatalogEntry | null {
    const lower = name.toLowerCase().trim();

    // Exact match first
    const exact = catalog.find(e => e.name.toLowerCase() === lower);
    if (exact) return exact;

    // Substring match: catalog names that contain the search term
    const matches = catalog.filter(e =>
      e.name.toLowerCase().includes(lower) || lower.includes(e.name.toLowerCase())
    );

    if (matches.length === 0) return null;

    // Pick shortest name (most specific match)
    return matches.sort((a, b) => a.name.length - b.name.length)[0];
  }

  /**
   * Rate an AI-generated program.
   */
  static async rateProgram(
    userId: string,
    programId: string,
    rating: number,
    feedback?: string
  ): Promise<void> {
    // Verify program exists and belongs to user
    const programRows = await db.select()
      .from(workoutPrograms)
      .where(
        and(
          eq(workoutPrograms.id, programId),
          eq(workoutPrograms.userId, userId),
          eq(workoutPrograms.isAiGenerated, true)
        )
      )
      .limit(1);

    if (programRows.length === 0) {
      throw new AiGenerationError('AI-generated program not found.', 404);
    }

    // Update rating on workoutPrograms
    await db.update(workoutPrograms)
      .set({ rating, updatedAt: new Date() })
      .where(eq(workoutPrograms.id, programId));

    // Update rating + feedback on the generation log
    const logRows = await db.select()
      .from(aiGenerationLogs)
      .where(eq(aiGenerationLogs.programId, programId))
      .limit(1);

    if (logRows.length > 0) {
      await db.update(aiGenerationLogs)
        .set({
          userRating: rating,
          userFeedback: feedback || null,
        })
        .where(eq(aiGenerationLogs.id, logRows[0].id));
    }
  }

  /**
   * Get or create the user's strength profile.
   */
  static async getStrengthProfile(userId: string): Promise<{
    entries: Array<{
      exerciseId: string;
      exerciseName: string;
      weight: number;
      unit: 'lb' | 'kg';
      reps: number;
      sets: number;
    }>;
    updatedAt: Date;
  } | null> {
    const rows = await db.select()
      .from(userStrengthProfiles)
      .where(eq(userStrengthProfiles.userId, userId))
      .limit(1);

    if (rows.length === 0) return null;

    return {
      entries: (rows[0].strengthEntries as any) || [],
      updatedAt: rows[0].updatedAt,
    };
  }

  /**
   * Save or update a user's strength profile from the dedicated endpoint.
   */
  static async upsertStrengthProfile(
    userId: string,
    entries: Array<{
      exerciseName: string;
      weight: number;
      unit: 'lb' | 'kg';
      reps: number;
      sets: number;
    }>
  ): Promise<{
    entries: Array<{
      exerciseId: string;
      exerciseName: string;
      weight: number;
      unit: 'lb' | 'kg';
      reps: number;
      sets: number;
    }>;
    updatedAt: Date;
  }> {
    const catalog = await db.select({
      id: exercises.id,
      name: exercises.name,
      muscleGroups: exercises.muscleGroups,
      equipment: exercises.equipment,
    }).from(exercises);

    const enrichedEntries = entries.map(entry => {
      const matched = this.fuzzyMatchExercise(entry.exerciseName, catalog);
      return {
        exerciseId: matched?.id || '',
        exerciseName: matched?.name || entry.exerciseName,
        weight: entry.weight,
        unit: entry.unit,
        reps: entry.reps,
        sets: entry.sets,
      };
    });

    const existing = await db.select().from(userStrengthProfiles)
      .where(eq(userStrengthProfiles.userId, userId)).limit(1);

    const now = new Date();

    if (existing.length > 0) {
      await db.update(userStrengthProfiles)
        .set({
          strengthEntries: enrichedEntries,
          updatedAt: now,
        })
        .where(eq(userStrengthProfiles.userId, userId));
    } else {
      await db.insert(userStrengthProfiles).values({
        userId,
        strengthEntries: enrichedEntries,
      });
    }

    return {
      entries: enrichedEntries,
      updatedAt: now,
    };
  }
}

// Custom error class for AI generation errors
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
