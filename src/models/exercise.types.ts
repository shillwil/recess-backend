import { DifficultyLevel, MovementPattern, ExerciseType } from './index';

// ============ Query Parameters ============

export interface ExerciseListQuery {
  // Pagination
  cursor?: string;
  limit?: number; // Default: 20, Max: 100

  // Filters
  muscleGroup?: string | string[]; // Filter by primary or secondary muscles
  difficulty?: DifficultyLevel | DifficultyLevel[];
  equipment?: string | string[];
  movementPattern?: MovementPattern | MovementPattern[];
  exerciseType?: ExerciseType | ExerciseType[];

  // Search
  search?: string; // Fuzzy search on name and aliases

  // Sorting
  sort?: ExerciseSortOption;
  order?: 'asc' | 'desc';
}

export type ExerciseSortOption =
  | 'name' // Alphabetical
  | 'popularity' // By popularityScore
  | 'recently_used' // By user's last use (requires auth)
  | 'difficulty'; // By difficulty level

// ============ Response Types ============

export interface ExerciseListItem {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  difficulty: DifficultyLevel | null;
  movementPattern: MovementPattern | null;
  exerciseType: ExerciseType | null;
  thumbnailUrl: string | null;
  popularityScore: number;
}

export interface ExerciseDetail extends ExerciseListItem {
  instructions: string | null;
  videoUrl: string | null;
  totalTimesUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ExerciseListResponse {
  exercises: ExerciseListItem[];
  pagination: PaginationInfo;
  meta?: {
    searchApplied: boolean;
    filtersApplied: string[];
  };
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterMetadata {
  muscleGroups: FilterOption[];
  difficulties: FilterOption[];
  equipment: FilterOption[];
  movementPatterns: FilterOption[];
  exerciseTypes: FilterOption[];
}

// ============ Cursor Encoding ============

export interface CursorData {
  id: string;
  sortValue: string | number | null;
  sortField: ExerciseSortOption;
}
