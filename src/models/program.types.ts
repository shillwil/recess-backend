/**
 * TypeScript types for workout programs API
 */

// ============ Query Types ============

/**
 * Query parameters for listing programs
 */
export interface ProgramListQuery {
  cursor?: string;
  limit?: number;
  sort?: ProgramSortOption;
  order?: 'asc' | 'desc';
}

export type ProgramSortOption = 'name' | 'createdAt' | 'updatedAt';

// ============ Response Types ============

/**
 * Program data for list view (minimal fields)
 */
export interface ProgramListItem {
  id: string;
  name: string;
  description: string | null;
  daysPerWeek: number;
  durationWeeks: number | null;
  isActive: boolean;
  currentDayIndex: number;
  timesCompleted: number;
  workoutCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full program detail with workouts
 */
export interface ProgramDetail {
  id: string;
  name: string;
  description: string | null;
  daysPerWeek: number;
  durationWeeks: number | null;
  isActive: boolean;
  currentDayIndex: number;
  timesCompleted: number;
  isPublic: boolean;
  isAiGenerated: boolean;
  workouts: ProgramWorkoutDetail[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Workout (day) within a program
 */
export interface ProgramWorkoutDetail {
  id: string;
  dayNumber: number;
  dayLabel: string | null;
  templateId: string;
  template: {
    id: string;
    name: string;
    description: string | null;
    exerciseCount: number;
  };
}

/**
 * Response for program list endpoint
 */
export interface ProgramListResponse {
  programs: ProgramListItem[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Active program with next workout info
 */
export interface ActiveProgramResponse {
  program: ProgramDetail;
  nextWorkout: {
    dayNumber: number;
    dayLabel: string | null;
    template: {
      id: string;
      name: string;
      description: string | null;
      exerciseCount: number;
    };
  } | null;
  isCompleted: boolean; // true if timesCompleted >= durationWeeks (for finite programs)
}

// ============ Input Types ============

/**
 * Workout input when creating/updating a program
 */
export interface ProgramWorkoutInput {
  dayNumber: number; // 0-based day index
  templateId: string;
  dayLabel?: string;
}

/**
 * Input for creating a new program
 */
export interface CreateProgramInput {
  name: string;
  description?: string;
  daysPerWeek: number; // 1-7
  durationWeeks?: number; // null = indefinite
  workouts: ProgramWorkoutInput[];
}

/**
 * Input for updating program metadata
 */
export interface UpdateProgramInput {
  name?: string;
  description?: string;
  daysPerWeek?: number;
  durationWeeks?: number | null;
}

/**
 * Input for bulk updating program workouts
 */
export interface UpdateProgramWorkoutsInput {
  workouts: ProgramWorkoutInput[];
}

// ============ Cursor Types ============

/**
 * Cursor data for pagination
 */
export interface ProgramCursorData {
  id: string;
  sortValue: string | number | null;
  sortField: ProgramSortOption;
}
