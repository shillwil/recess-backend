/**
 * TypeScript types for the Share API
 */

import { TemplateDetail } from './template.types';
import { ProgramDetail } from './program.types';

// ============ Core Types ============

export type ShareType = 'program' | 'template';

// ============ Input Types ============

export interface CreateShareInput {
  type: ShareType;
  itemId: string;
}

// ============ Response Types ============

export interface CreateShareResponse {
  token: string;
  shareUrl: string;
  expiresAt: string | null;
}

/**
 * Sharer info included in the GET response.
 * Note: DB column is `profilePictureUrl` but the API returns `avatarUrl`.
 */
export interface SharedByInfo {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Program snapshot with full template exercises (not just counts).
 * Unlike ProgramDetail which only has exerciseCount per workout,
 * the share snapshot includes the full TemplateDetail for each workout.
 */
export interface ProgramShareSnapshot {
  id: string;
  name: string;
  description: string | null;
  daysPerWeek: number;
  durationWeeks: number | null;
  isAiGenerated: boolean;
  workouts: ProgramWorkoutShareSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface ProgramWorkoutShareSnapshot {
  id: string;
  dayNumber: number;
  dayLabel: string | null;
  templateId: string;
  template: TemplateDetail;
}

/**
 * Full GET /api/shares/:token response.
 * One of `template` or `program` will be populated, the other null.
 */
export interface ShareResponse {
  token: string;
  type: ShareType;
  sharedBy: SharedByInfo;
  sharedAt: string;
  expiresAt: string | null;
  template: TemplateDetail | null;
  program: ProgramShareSnapshot | null;
}
