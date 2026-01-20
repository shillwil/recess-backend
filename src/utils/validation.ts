/**
 * Validation utilities for request input
 */

// Valid difficulty levels
export const VALID_DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type DifficultyLevel = typeof VALID_DIFFICULTY_LEVELS[number];

// Valid movement patterns
export const VALID_MOVEMENT_PATTERNS = ['push', 'pull', 'hinge', 'squat', 'lunge', 'carry', 'rotation', 'core'] as const;
export type MovementPattern = typeof VALID_MOVEMENT_PATTERNS[number];

// Valid exercise types
export const VALID_EXERCISE_TYPES = ['compound', 'isolation', 'cardio', 'plyometric', 'stretch'] as const;
export type ExerciseType = typeof VALID_EXERCISE_TYPES[number];

// Valid genders for user profile
export const VALID_GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export type Gender = typeof VALID_GENDERS[number];

// Valid unit preferences
export const VALID_UNIT_PREFERENCES = ['metric', 'imperial'] as const;
export type UnitPreference = typeof VALID_UNIT_PREFERENCES[number];

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: Record<string, unknown>;
}

/**
 * Validates and sanitizes user profile update data
 * Only allows known fields with proper types
 */
export function validateUserProfileUpdate(data: unknown): ValidationResult {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const input = data as Record<string, unknown>;

  // Allowed fields with their validation rules
  const allowedFields: Record<string, (value: unknown) => { valid: boolean; sanitized?: unknown; error?: string }> = {
    displayName: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'string') return { valid: false, error: 'displayName must be a string' };
      const trimmed = v.trim();
      if (trimmed.length === 0) return { valid: false, error: 'displayName cannot be empty' };
      if (trimmed.length > 100) return { valid: false, error: 'displayName cannot exceed 100 characters' };
      return { valid: true, sanitized: trimmed };
    },
    bio: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'string') return { valid: false, error: 'bio must be a string' };
      const trimmed = v.trim();
      if (trimmed.length > 500) return { valid: false, error: 'bio cannot exceed 500 characters' };
      return { valid: true, sanitized: trimmed };
    },
    height: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'number' || isNaN(v)) return { valid: false, error: 'height must be a number' };
      // Database stores height in inches (schema: real('height'), // in inches)
      // Max 108 inches = 9 feet (reasonable upper bound for human height)
      if (v < 0 || v > 108) return { valid: false, error: 'height must be between 0 and 108 inches' };
      return { valid: true, sanitized: v };
    },
    weight: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'number' || isNaN(v)) return { valid: false, error: 'weight must be a number' };
      // Database stores weight in lbs (schema: real('weight'), // in lbs)
      if (v < 0 || v > 1000) return { valid: false, error: 'weight must be between 0 and 1000 lbs' };
      return { valid: true, sanitized: v };
    },
    age: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'number' || !Number.isInteger(v)) return { valid: false, error: 'age must be an integer' };
      if (v < 0 || v > 150) return { valid: false, error: 'age must be between 0 and 150' };
      return { valid: true, sanitized: v };
    },
    gender: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'string') return { valid: false, error: 'gender must be a string' };
      if (!VALID_GENDERS.includes(v as Gender)) {
        return { valid: false, error: `gender must be one of: ${VALID_GENDERS.join(', ')}` };
      }
      return { valid: true, sanitized: v };
    },
    unitPreference: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'string') return { valid: false, error: 'unitPreference must be a string' };
      if (!VALID_UNIT_PREFERENCES.includes(v as UnitPreference)) {
        return { valid: false, error: `unitPreference must be one of: ${VALID_UNIT_PREFERENCES.join(', ')}` };
      }
      return { valid: true, sanitized: v };
    },
    isPublicProfile: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'boolean') return { valid: false, error: 'isPublicProfile must be a boolean' };
      return { valid: true, sanitized: v };
    },
    notificationsEnabled: (v) => {
      if (v === undefined) return { valid: true };
      if (typeof v !== 'boolean') return { valid: false, error: 'notificationsEnabled must be a boolean' };
      return { valid: true, sanitized: v };
    }
  };

  // Check for unknown fields
  const knownFields = Object.keys(allowedFields);
  const inputFields = Object.keys(input);
  const unknownFields = inputFields.filter(f => !knownFields.includes(f));

  if (unknownFields.length > 0) {
    errors.push(`Unknown fields: ${unknownFields.join(', ')}. Allowed fields: ${knownFields.join(', ')}`);
  }

  // Validate each allowed field
  for (const [field, validator] of Object.entries(allowedFields)) {
    const result = validator(input[field]);
    if (!result.valid && result.error) {
      errors.push(result.error);
    } else if (result.sanitized !== undefined) {
      sanitized[field] = result.sanitized;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

/**
 * Validates exercise list query parameters
 */
export interface ExerciseQueryValidationResult extends ValidationResult {
  sanitized?: {
    cursor?: string;
    limit?: number;
    muscleGroup?: string | string[];
    difficulty?: DifficultyLevel | DifficultyLevel[];
    equipment?: string | string[];
    movementPattern?: MovementPattern | MovementPattern[];
    exerciseType?: ExerciseType | ExerciseType[];
    search?: string;
    sort?: 'name' | 'popularity' | 'recently_used' | 'difficulty';
    order?: 'asc' | 'desc';
  };
}

export function validateExerciseListQuery(query: Record<string, unknown>): ExerciseQueryValidationResult {
  const errors: string[] = [];
  const sanitized: ExerciseQueryValidationResult['sanitized'] = {};

  // Cursor validation
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string') {
      errors.push('cursor must be a string');
    } else {
      sanitized.cursor = query.cursor;
    }
  }

  // Limit validation with bounds checking
  if (query.limit !== undefined) {
    const limitStr = String(query.limit);
    const limit = parseInt(limitStr, 10);
    if (isNaN(limit)) {
      errors.push('limit must be a valid integer');
    } else if (limit < 1) {
      errors.push('limit must be at least 1');
    } else if (limit > 100) {
      errors.push('limit cannot exceed 100');
    } else {
      sanitized.limit = limit;
    }
  }

  // Difficulty validation
  if (query.difficulty !== undefined) {
    const difficulties = Array.isArray(query.difficulty) ? query.difficulty : [query.difficulty];
    const validDifficulties: DifficultyLevel[] = [];

    for (const d of difficulties) {
      if (typeof d !== 'string') {
        errors.push('difficulty values must be strings');
        break;
      }
      if (!VALID_DIFFICULTY_LEVELS.includes(d as DifficultyLevel)) {
        errors.push(`Invalid difficulty: "${d}". Valid options: ${VALID_DIFFICULTY_LEVELS.join(', ')}`);
      } else {
        validDifficulties.push(d as DifficultyLevel);
      }
    }

    if (validDifficulties.length > 0) {
      sanitized.difficulty = validDifficulties.length === 1 ? validDifficulties[0] : validDifficulties;
    }
  }

  // Movement pattern validation
  if (query.movementPattern !== undefined) {
    const patterns = Array.isArray(query.movementPattern) ? query.movementPattern : [query.movementPattern];
    const validPatterns: MovementPattern[] = [];

    for (const p of patterns) {
      if (typeof p !== 'string') {
        errors.push('movementPattern values must be strings');
        break;
      }
      if (!VALID_MOVEMENT_PATTERNS.includes(p as MovementPattern)) {
        errors.push(`Invalid movementPattern: "${p}". Valid options: ${VALID_MOVEMENT_PATTERNS.join(', ')}`);
      } else {
        validPatterns.push(p as MovementPattern);
      }
    }

    if (validPatterns.length > 0) {
      sanitized.movementPattern = validPatterns.length === 1 ? validPatterns[0] : validPatterns;
    }
  }

  // Exercise type validation
  if (query.exerciseType !== undefined) {
    const types = Array.isArray(query.exerciseType) ? query.exerciseType : [query.exerciseType];
    const validTypes: ExerciseType[] = [];

    for (const t of types) {
      if (typeof t !== 'string') {
        errors.push('exerciseType values must be strings');
        break;
      }
      if (!VALID_EXERCISE_TYPES.includes(t as ExerciseType)) {
        errors.push(`Invalid exerciseType: "${t}". Valid options: ${VALID_EXERCISE_TYPES.join(', ')}`);
      } else {
        validTypes.push(t as ExerciseType);
      }
    }

    if (validTypes.length > 0) {
      sanitized.exerciseType = validTypes.length === 1 ? validTypes[0] : validTypes;
    }
  }

  // Muscle group - pass through (these are validated against DB values)
  if (query.muscleGroup !== undefined) {
    if (typeof query.muscleGroup === 'string') {
      sanitized.muscleGroup = query.muscleGroup;
    } else if (Array.isArray(query.muscleGroup)) {
      const validMuscles = query.muscleGroup.filter(m => typeof m === 'string') as string[];
      if (validMuscles.length > 0) {
        sanitized.muscleGroup = validMuscles;
      }
    }
  }

  // Equipment - pass through
  if (query.equipment !== undefined) {
    if (typeof query.equipment === 'string') {
      sanitized.equipment = query.equipment;
    } else if (Array.isArray(query.equipment)) {
      const validEquipment = query.equipment.filter(e => typeof e === 'string') as string[];
      if (validEquipment.length > 0) {
        sanitized.equipment = validEquipment;
      }
    }
  }

  // Search validation
  if (query.search !== undefined) {
    if (typeof query.search !== 'string') {
      errors.push('search must be a string');
    } else {
      const trimmed = query.search.trim();
      if (trimmed.length > 100) {
        errors.push('search query cannot exceed 100 characters');
      } else if (trimmed.length > 0) {
        sanitized.search = trimmed;
      }
    }
  }

  // Sort validation
  const VALID_SORTS = ['name', 'popularity', 'recently_used', 'difficulty'] as const;
  if (query.sort !== undefined) {
    if (typeof query.sort !== 'string') {
      errors.push('sort must be a string');
    } else if (!VALID_SORTS.includes(query.sort as typeof VALID_SORTS[number])) {
      errors.push(`Invalid sort option: "${query.sort}". Valid options: ${VALID_SORTS.join(', ')}`);
    } else {
      sanitized.sort = query.sort as typeof VALID_SORTS[number];
    }
  }

  // Order validation
  if (query.order !== undefined) {
    if (typeof query.order !== 'string') {
      errors.push('order must be a string');
    } else if (!['asc', 'desc'].includes(query.order)) {
      errors.push('order must be "asc" or "desc"');
    } else {
      sanitized.order = query.order as 'asc' | 'desc';
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

/**
 * Validates cursor data structure after decoding
 */
export interface CursorData {
  id: string;
  sortValue: string | number | null;
  sortField: string;
}

export function validateCursorData(data: unknown): data is CursorData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const cursor = data as Record<string, unknown>;

  // id must be a non-empty string
  if (typeof cursor.id !== 'string' || cursor.id.length === 0) {
    return false;
  }

  // sortValue must be string, number, or null
  if (cursor.sortValue !== null &&
      typeof cursor.sortValue !== 'string' &&
      typeof cursor.sortValue !== 'number') {
    return false;
  }

  // sortField must be a valid sort option
  const validSortFields = ['name', 'popularity', 'recently_used', 'difficulty'];
  if (typeof cursor.sortField !== 'string' || !validSortFields.includes(cursor.sortField)) {
    return false;
  }

  return true;
}

// ============ Sync Payload Validation ============

/**
 * Sync payload size limits to prevent DoS attacks
 */
export const SYNC_LIMITS = {
  MAX_WORKOUTS_PER_SYNC: 100,
  MAX_EXERCISES_PER_WORKOUT: 50,
  MAX_SETS_PER_EXERCISE: 20,
  MAX_EXERCISE_NAME_LENGTH: 100,
  MAX_WORKOUT_NAME_LENGTH: 100,
  MAX_WEIGHT_LBS: 10000,
  MAX_REPS: 10000,
} as const;

/**
 * Sync payload validation result
 */
export interface SyncPayloadValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates sync payload size and basic structure to prevent DoS attacks
 * Does not validate all fields - just ensures payload is within safe limits
 */
export function validateSyncPayload(payload: unknown): SyncPayloadValidationResult {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, errors: ['Sync payload must be an object'] };
  }

  const data = payload as Record<string, unknown>;

  // Validate deviceId
  if (!data.deviceId || typeof data.deviceId !== 'string') {
    errors.push('deviceId is required and must be a string');
  } else if (data.deviceId.length > 100) {
    errors.push('deviceId cannot exceed 100 characters');
  }

  // Validate workouts array
  if (!Array.isArray(data.workouts)) {
    errors.push('workouts must be an array');
    return { valid: false, errors };
  }

  // Check workout count limit
  if (data.workouts.length > SYNC_LIMITS.MAX_WORKOUTS_PER_SYNC) {
    errors.push(`Too many workouts: ${data.workouts.length}. Maximum allowed: ${SYNC_LIMITS.MAX_WORKOUTS_PER_SYNC}`);
    return { valid: false, errors };
  }

  // Validate each workout
  for (let i = 0; i < data.workouts.length; i++) {
    const workout = data.workouts[i] as Record<string, unknown>;

    if (typeof workout !== 'object' || workout === null) {
      errors.push(`workouts[${i}] must be an object`);
      continue;
    }

    // Validate clientId
    if (!workout.clientId || typeof workout.clientId !== 'string') {
      errors.push(`workouts[${i}].clientId is required and must be a string`);
    }

    // Validate workout name length
    if (workout.name && typeof workout.name === 'string' && workout.name.length > SYNC_LIMITS.MAX_WORKOUT_NAME_LENGTH) {
      errors.push(`workouts[${i}].name cannot exceed ${SYNC_LIMITS.MAX_WORKOUT_NAME_LENGTH} characters`);
    }

    // Validate exercises array
    if (!Array.isArray(workout.exercises)) {
      errors.push(`workouts[${i}].exercises must be an array`);
      continue;
    }

    // Check exercises count limit
    if (workout.exercises.length > SYNC_LIMITS.MAX_EXERCISES_PER_WORKOUT) {
      errors.push(`workouts[${i}] has too many exercises: ${workout.exercises.length}. Maximum: ${SYNC_LIMITS.MAX_EXERCISES_PER_WORKOUT}`);
      continue;
    }

    // Validate each exercise
    for (let j = 0; j < workout.exercises.length; j++) {
      const exercise = workout.exercises[j] as Record<string, unknown>;

      if (typeof exercise !== 'object' || exercise === null) {
        errors.push(`workouts[${i}].exercises[${j}] must be an object`);
        continue;
      }

      // Validate exercise clientId
      if (!exercise.clientId || typeof exercise.clientId !== 'string') {
        errors.push(`workouts[${i}].exercises[${j}].clientId is required and must be a string`);
      }

      // Validate exercise name
      if (!exercise.exerciseName || typeof exercise.exerciseName !== 'string') {
        errors.push(`workouts[${i}].exercises[${j}].exerciseName is required`);
      } else if (exercise.exerciseName.length > SYNC_LIMITS.MAX_EXERCISE_NAME_LENGTH) {
        errors.push(`workouts[${i}].exercises[${j}].exerciseName cannot exceed ${SYNC_LIMITS.MAX_EXERCISE_NAME_LENGTH} characters`);
      }

      // Validate sets array
      if (!Array.isArray(exercise.sets)) {
        errors.push(`workouts[${i}].exercises[${j}].sets must be an array`);
        continue;
      }

      // Check sets count limit
      if (exercise.sets.length > SYNC_LIMITS.MAX_SETS_PER_EXERCISE) {
        errors.push(`workouts[${i}].exercises[${j}] has too many sets: ${exercise.sets.length}. Maximum: ${SYNC_LIMITS.MAX_SETS_PER_EXERCISE}`);
        continue;
      }

      // Validate each set
      for (let k = 0; k < exercise.sets.length; k++) {
        const set = exercise.sets[k] as Record<string, unknown>;

        if (typeof set !== 'object' || set === null) {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}] must be an object`);
          continue;
        }

        // Validate set clientId
        if (!set.clientId || typeof set.clientId !== 'string') {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}].clientId is required and must be a string`);
        }

        // Validate weight is required and within bounds
        if (typeof set.weight !== 'number' || isNaN(set.weight as number)) {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}].weight is required and must be a number`);
        } else if (set.weight < 0 || set.weight > SYNC_LIMITS.MAX_WEIGHT_LBS) {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}].weight must be between 0 and ${SYNC_LIMITS.MAX_WEIGHT_LBS}`);
        }

        // Validate reps is required and within bounds
        if (typeof set.reps !== 'number' || isNaN(set.reps as number)) {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}].reps is required and must be a number`);
        } else if (set.reps < 0 || set.reps > SYNC_LIMITS.MAX_REPS) {
          errors.push(`workouts[${i}].exercises[${j}].sets[${k}].reps must be between 0 and ${SYNC_LIMITS.MAX_REPS}`);
        }
      }
    }

    // Stop early if too many errors
    if (errors.length > 20) {
      errors.push('Too many validation errors. Stopping validation.');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============ Template Validation ============

/**
 * Template size limits
 */
export const TEMPLATE_LIMITS = {
  MAX_NAME_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_EXERCISES_PER_TEMPLATE: 30,
  MAX_WORKING_SETS: 20,
  MAX_WARMUP_SETS: 10,
  MAX_REST_SECONDS: 600,
  MAX_NOTES_LENGTH: 500,
  MAX_TARGET_REPS_LENGTH: 20,
} as const;

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates UUID format
 */
export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Template list query validation result
 */
export interface TemplateQueryValidationResult extends ValidationResult {
  sanitized?: {
    cursor?: string;
    limit?: number;
    sort?: 'name' | 'createdAt' | 'updatedAt';
    order?: 'asc' | 'desc';
  };
}

/**
 * Validates template list query parameters
 */
export function validateTemplateListQuery(query: Record<string, unknown>): TemplateQueryValidationResult {
  const errors: string[] = [];
  const sanitized: TemplateQueryValidationResult['sanitized'] = {};

  // Cursor validation
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string') {
      errors.push('cursor must be a string');
    } else {
      sanitized.cursor = query.cursor;
    }
  }

  // Limit validation with bounds checking
  if (query.limit !== undefined) {
    const limitStr = String(query.limit);
    const limit = parseInt(limitStr, 10);
    if (isNaN(limit)) {
      errors.push('limit must be a valid integer');
    } else if (limit < 1) {
      errors.push('limit must be at least 1');
    } else if (limit > 100) {
      errors.push('limit cannot exceed 100');
    } else {
      sanitized.limit = limit;
    }
  }

  // Sort validation
  const VALID_TEMPLATE_SORTS = ['name', 'createdAt', 'updatedAt'] as const;
  if (query.sort !== undefined) {
    if (typeof query.sort !== 'string') {
      errors.push('sort must be a string');
    } else if (!VALID_TEMPLATE_SORTS.includes(query.sort as typeof VALID_TEMPLATE_SORTS[number])) {
      errors.push(`Invalid sort option: "${query.sort}". Valid options: ${VALID_TEMPLATE_SORTS.join(', ')}`);
    } else {
      sanitized.sort = query.sort as typeof VALID_TEMPLATE_SORTS[number];
    }
  }

  // Order validation
  if (query.order !== undefined) {
    if (typeof query.order !== 'string') {
      errors.push('order must be a string');
    } else if (!['asc', 'desc'].includes(query.order)) {
      errors.push('order must be "asc" or "desc"');
    } else {
      sanitized.order = query.order as 'asc' | 'desc';
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined
  };
}

/**
 * Create template validation result
 */
export interface CreateTemplateValidationResult extends ValidationResult {
  sanitized?: {
    name: string;
    description?: string;
    exercises: Array<{
      exerciseId: string;
      orderIndex: number;
      workingSets: number;
      warmupSets?: number;
      targetReps?: string;
      restSeconds?: number;
      notes?: string;
    }>;
  };
}

/**
 * Validates create template input
 */
export function validateCreateTemplate(data: unknown): CreateTemplateValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const input = data as Record<string, unknown>;

  // Validate name (required)
  if (!input.name || typeof input.name !== 'string') {
    errors.push('name is required and must be a string');
  } else {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      errors.push('name cannot be empty');
    } else if (trimmed.length > TEMPLATE_LIMITS.MAX_NAME_LENGTH) {
      errors.push(`name cannot exceed ${TEMPLATE_LIMITS.MAX_NAME_LENGTH} characters`);
    }
  }

  // Validate description (optional)
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') {
      errors.push('description must be a string');
    } else if (input.description.length > TEMPLATE_LIMITS.MAX_DESCRIPTION_LENGTH) {
      errors.push(`description cannot exceed ${TEMPLATE_LIMITS.MAX_DESCRIPTION_LENGTH} characters`);
    }
  }

  // Validate exercises array (required)
  if (!Array.isArray(input.exercises)) {
    errors.push('exercises must be an array');
    return { valid: false, errors };
  }

  if (input.exercises.length === 0) {
    errors.push('exercises array cannot be empty');
  } else if (input.exercises.length > TEMPLATE_LIMITS.MAX_EXERCISES_PER_TEMPLATE) {
    errors.push(`exercises array cannot exceed ${TEMPLATE_LIMITS.MAX_EXERCISES_PER_TEMPLATE} items`);
  }

  // Validate each exercise
  const exerciseErrors = validateTemplateExercisesArray(input.exercises);
  errors.push(...exerciseErrors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Build sanitized output
  const sanitized: CreateTemplateValidationResult['sanitized'] = {
    name: (input.name as string).trim(),
    exercises: (input.exercises as Array<Record<string, unknown>>).map((e, i) => ({
      exerciseId: e.exerciseId as string,
      orderIndex: typeof e.orderIndex === 'number' ? e.orderIndex : i,
      workingSets: e.workingSets as number,
      warmupSets: typeof e.warmupSets === 'number' ? e.warmupSets : undefined,
      targetReps: typeof e.targetReps === 'string' ? e.targetReps.trim() : undefined,
      restSeconds: typeof e.restSeconds === 'number' ? e.restSeconds : undefined,
      notes: typeof e.notes === 'string' ? e.notes.trim() : undefined,
    }))
  };

  if (typeof input.description === 'string' && input.description.trim().length > 0) {
    sanitized.description = input.description.trim();
  }

  return { valid: true, errors: [], sanitized };
}

/**
 * Validates an array of template exercises
 */
function validateTemplateExercisesArray(exercises: unknown[]): string[] {
  const errors: string[] = [];
  const seenOrderIndices = new Set<number>();

  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i] as Record<string, unknown>;

    if (typeof exercise !== 'object' || exercise === null) {
      errors.push(`exercises[${i}] must be an object`);
      continue;
    }

    // Validate exerciseId (required UUID)
    if (!exercise.exerciseId || typeof exercise.exerciseId !== 'string') {
      errors.push(`exercises[${i}].exerciseId is required and must be a string`);
    } else if (!isValidUuid(exercise.exerciseId)) {
      errors.push(`exercises[${i}].exerciseId must be a valid UUID`);
    }

    // Validate orderIndex (optional, defaults to array index)
    // Use the final orderIndex value (explicit or defaulted) for duplicate detection
    let finalOrderIndex: number = i; // Default to array index
    if (exercise.orderIndex !== undefined) {
      if (typeof exercise.orderIndex !== 'number' || !Number.isInteger(exercise.orderIndex)) {
        errors.push(`exercises[${i}].orderIndex must be an integer`);
      } else if (exercise.orderIndex < 0) {
        errors.push(`exercises[${i}].orderIndex must be >= 0`);
      } else {
        finalOrderIndex = exercise.orderIndex;
      }
    }
    // Check for duplicate using the final value (explicit or defaulted)
    if (seenOrderIndices.has(finalOrderIndex)) {
      errors.push(`exercises[${i}].orderIndex ${finalOrderIndex} is duplicated`);
    }
    seenOrderIndices.add(finalOrderIndex);

    // Validate workingSets (required)
    if (exercise.workingSets === undefined || typeof exercise.workingSets !== 'number') {
      errors.push(`exercises[${i}].workingSets is required and must be a number`);
    } else if (!Number.isInteger(exercise.workingSets) || exercise.workingSets < 1) {
      errors.push(`exercises[${i}].workingSets must be an integer >= 1`);
    } else if (exercise.workingSets > TEMPLATE_LIMITS.MAX_WORKING_SETS) {
      errors.push(`exercises[${i}].workingSets cannot exceed ${TEMPLATE_LIMITS.MAX_WORKING_SETS}`);
    }

    // Validate warmupSets (optional)
    if (exercise.warmupSets !== undefined) {
      if (typeof exercise.warmupSets !== 'number' || !Number.isInteger(exercise.warmupSets)) {
        errors.push(`exercises[${i}].warmupSets must be an integer`);
      } else if (exercise.warmupSets < 0) {
        errors.push(`exercises[${i}].warmupSets must be >= 0`);
      } else if (exercise.warmupSets > TEMPLATE_LIMITS.MAX_WARMUP_SETS) {
        errors.push(`exercises[${i}].warmupSets cannot exceed ${TEMPLATE_LIMITS.MAX_WARMUP_SETS}`);
      }
    }

    // Validate targetReps (optional)
    if (exercise.targetReps !== undefined && exercise.targetReps !== null) {
      if (typeof exercise.targetReps !== 'string') {
        errors.push(`exercises[${i}].targetReps must be a string`);
      } else if (exercise.targetReps.length > TEMPLATE_LIMITS.MAX_TARGET_REPS_LENGTH) {
        errors.push(`exercises[${i}].targetReps cannot exceed ${TEMPLATE_LIMITS.MAX_TARGET_REPS_LENGTH} characters`);
      }
    }

    // Validate restSeconds (optional)
    if (exercise.restSeconds !== undefined && exercise.restSeconds !== null) {
      if (typeof exercise.restSeconds !== 'number' || !Number.isInteger(exercise.restSeconds)) {
        errors.push(`exercises[${i}].restSeconds must be an integer`);
      } else if (exercise.restSeconds < 0) {
        errors.push(`exercises[${i}].restSeconds must be >= 0`);
      } else if (exercise.restSeconds > TEMPLATE_LIMITS.MAX_REST_SECONDS) {
        errors.push(`exercises[${i}].restSeconds cannot exceed ${TEMPLATE_LIMITS.MAX_REST_SECONDS}`);
      }
    }

    // Validate notes (optional)
    if (exercise.notes !== undefined && exercise.notes !== null) {
      if (typeof exercise.notes !== 'string') {
        errors.push(`exercises[${i}].notes must be a string`);
      } else if (exercise.notes.length > TEMPLATE_LIMITS.MAX_NOTES_LENGTH) {
        errors.push(`exercises[${i}].notes cannot exceed ${TEMPLATE_LIMITS.MAX_NOTES_LENGTH} characters`);
      }
    }

    // Stop early if too many errors
    if (errors.length > 20) {
      errors.push('Too many validation errors. Stopping validation.');
      break;
    }
  }

  return errors;
}

/**
 * Update template validation result
 */
export interface UpdateTemplateValidationResult extends ValidationResult {
  sanitized?: {
    name?: string;
    description?: string;
  };
}

/**
 * Validates update template input
 */
export function validateUpdateTemplate(data: unknown): UpdateTemplateValidationResult {
  const errors: string[] = [];
  const sanitized: UpdateTemplateValidationResult['sanitized'] = {};

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const input = data as Record<string, unknown>;

  // Check for unknown fields
  const allowedFields = ['name', 'description'];
  const inputFields = Object.keys(input);
  const unknownFields = inputFields.filter(f => !allowedFields.includes(f));

  if (unknownFields.length > 0) {
    errors.push(`Unknown fields: ${unknownFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`);
  }

  // Validate name (optional)
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      errors.push('name must be a string');
    } else {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        errors.push('name cannot be empty');
      } else if (trimmed.length > TEMPLATE_LIMITS.MAX_NAME_LENGTH) {
        errors.push(`name cannot exceed ${TEMPLATE_LIMITS.MAX_NAME_LENGTH} characters`);
      } else {
        sanitized.name = trimmed;
      }
    }
  }

  // Validate description (optional, can be set to empty string to clear)
  if (input.description !== undefined) {
    if (input.description === null) {
      sanitized.description = '';
    } else if (typeof input.description !== 'string') {
      errors.push('description must be a string or null');
    } else if (input.description.length > TEMPLATE_LIMITS.MAX_DESCRIPTION_LENGTH) {
      errors.push(`description cannot exceed ${TEMPLATE_LIMITS.MAX_DESCRIPTION_LENGTH} characters`);
    } else {
      sanitized.description = input.description.trim();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Check if there's anything to update
  if (Object.keys(sanitized).length === 0) {
    return { valid: false, errors: ['No valid fields to update'] };
  }

  return { valid: true, errors: [], sanitized };
}

/**
 * Template exercises update validation result
 */
export interface UpdateTemplateExercisesValidationResult extends ValidationResult {
  sanitized?: {
    exercises: Array<{
      exerciseId: string;
      orderIndex: number;
      workingSets: number;
      warmupSets?: number;
      targetReps?: string;
      restSeconds?: number;
      notes?: string;
    }>;
  };
}

/**
 * Validates template exercises update input
 */
export function validateTemplateExercises(data: unknown): UpdateTemplateExercisesValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const input = data as Record<string, unknown>;

  // Validate exercises array (required)
  if (!Array.isArray(input.exercises)) {
    errors.push('exercises must be an array');
    return { valid: false, errors };
  }

  if (input.exercises.length === 0) {
    errors.push('exercises array cannot be empty');
    return { valid: false, errors };
  }

  if (input.exercises.length > TEMPLATE_LIMITS.MAX_EXERCISES_PER_TEMPLATE) {
    errors.push(`exercises array cannot exceed ${TEMPLATE_LIMITS.MAX_EXERCISES_PER_TEMPLATE} items`);
    return { valid: false, errors };
  }

  // Validate each exercise
  const exerciseErrors = validateTemplateExercisesArray(input.exercises);
  errors.push(...exerciseErrors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Build sanitized output
  const sanitized: UpdateTemplateExercisesValidationResult['sanitized'] = {
    exercises: (input.exercises as Array<Record<string, unknown>>).map((e, i) => ({
      exerciseId: e.exerciseId as string,
      orderIndex: typeof e.orderIndex === 'number' ? e.orderIndex : i,
      workingSets: e.workingSets as number,
      warmupSets: typeof e.warmupSets === 'number' ? e.warmupSets : undefined,
      targetReps: typeof e.targetReps === 'string' ? e.targetReps.trim() : undefined,
      restSeconds: typeof e.restSeconds === 'number' ? e.restSeconds : undefined,
      notes: typeof e.notes === 'string' ? e.notes.trim() : undefined,
    }))
  };

  return { valid: true, errors: [], sanitized };
}

/**
 * Clone template validation result
 */
export interface CloneTemplateValidationResult extends ValidationResult {
  sanitized?: {
    name?: string;
  };
}

/**
 * Validates clone template input
 */
export function validateCloneTemplate(data: unknown): CloneTemplateValidationResult {
  const sanitized: CloneTemplateValidationResult['sanitized'] = {};

  // Allow empty body (name will be auto-generated)
  if (data === undefined || data === null) {
    return { valid: true, errors: [], sanitized };
  }

  if (typeof data !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const input = data as Record<string, unknown>;

  // Validate name (optional)
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      return { valid: false, errors: ['name must be a string'] };
    }

    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      return { valid: false, errors: ['name cannot be empty'] };
    }

    if (trimmed.length > TEMPLATE_LIMITS.MAX_NAME_LENGTH) {
      return { valid: false, errors: [`name cannot exceed ${TEMPLATE_LIMITS.MAX_NAME_LENGTH} characters`] };
    }

    sanitized.name = trimmed;
  }

  return { valid: true, errors: [], sanitized };
}
