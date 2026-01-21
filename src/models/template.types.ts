/**
 * TypeScript types for workout templates API
 */

// ============ Query Types ============

/**
 * Query parameters for listing templates
 */
export interface TemplateListQuery {
  cursor?: string;
  limit?: number;
  sort?: TemplateSortOption;
  order?: 'asc' | 'desc';
}

export type TemplateSortOption = 'name' | 'createdAt' | 'updatedAt';

// ============ Response Types ============

/**
 * Template data for list view (minimal fields)
 */
export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  exerciseCount: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full template detail with exercises
 */
export interface TemplateDetail {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isAiGenerated: boolean;
  exercises: TemplateExerciseDetail[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Exercise within a template (with exercise details)
 */
export interface TemplateExerciseDetail {
  id: string;
  exerciseId: string;
  orderIndex: number;
  warmupSets: number;
  workingSets: number;
  targetReps: string | null;
  restSeconds: number | null;
  notes: string | null;
  exercise: {
    id: string;
    name: string;
    primaryMuscles: string[];
    equipment: string | null;
    thumbnailUrl: string | null;
  };
}

/**
 * Response for template list endpoint
 */
export interface TemplateListResponse {
  templates: TemplateListItem[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

// ============ Input Types ============

/**
 * Exercise input when creating/updating a template
 */
export interface TemplateExerciseInput {
  exerciseId: string;
  orderIndex: number;
  workingSets: number;
  warmupSets?: number;
  targetReps?: string;
  restSeconds?: number;
  notes?: string;
}

/**
 * Input for creating a new template
 */
export interface CreateTemplateInput {
  name: string;
  description?: string;
  exercises: TemplateExerciseInput[];
}

/**
 * Input for updating template metadata
 */
export interface UpdateTemplateInput {
  name?: string;
  description?: string;
}

/**
 * Input for cloning a template
 */
export interface CloneTemplateInput {
  name?: string;
}

/**
 * Input for bulk updating template exercises
 */
export interface UpdateTemplateExercisesInput {
  exercises: TemplateExerciseInput[];
}

// ============ Cursor Types ============

/**
 * Cursor data for pagination
 */
export interface TemplateCursorData {
  id: string;
  sortValue: string | number | null;
  sortField: TemplateSortOption;
}
