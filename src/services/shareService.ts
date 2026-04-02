import crypto from 'crypto';
import { db } from '../db';
import { shares, users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import {
  CreateShareInput,
  CreateShareResponse,
  ShareResponse,
  ProgramShareSnapshot,
  ProgramWorkoutShareSnapshot,
} from '../models/share.types';
import { TemplateDetail } from '../models/template.types';
import { verifyTemplateOwnership, getTemplateById } from './templateService';
import { verifyProgramOwnership, getProgramById } from './programService';

// ============ Token Generation ============

/**
 * Generates a 12-character URL-safe token with 72 bits of entropy.
 * Uses Node's built-in crypto module (same as the rest of the codebase).
 *
 * Why 72 bits: With ~4.7 sextillion possible values, collision probability
 * is negligible even at millions of shares. base64url encoding ensures the
 * token is safe for URLs without escaping.
 */
export function generateShareToken(): string {
  return crypto.randomBytes(9).toString('base64url');
}

// ============ Main Service Functions ============

/**
 * Creates a share with a frozen snapshot of the item.
 *
 * Flow:
 * 1. Verify the user owns the item
 * 2. Build a snapshot (full data frozen at this point in time)
 * 3. Generate a unique token and insert into the shares table
 *
 * The snapshot means edits/deletions of the original don't affect the share.
 */
export async function createShare(
  userId: string,
  input: CreateShareInput
): Promise<CreateShareResponse> {
  const { type, itemId } = input;

  // Step 1: Verify ownership and build snapshot based on type
  let snapshot: TemplateDetail | ProgramShareSnapshot;

  if (type === 'template') {
    const owned = await verifyTemplateOwnership(itemId, userId);
    if (!owned) {
      throw new ShareNotFoundError('Template not found or not owned by user');
    }

    const templateDetail = await getTemplateById(itemId, userId);
    if (!templateDetail) {
      throw new ShareNotFoundError('Template not found');
    }

    snapshot = templateDetail;
  } else {
    // type === 'program'
    const owned = await verifyProgramOwnership(itemId, userId);
    if (!owned) {
      throw new ShareNotFoundError('Program not found or not owned by user');
    }

    snapshot = await buildProgramSnapshot(itemId, userId);
  }

  // Step 2: Generate token and insert, with retry on (astronomically unlikely) collision
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const token = generateShareToken();

    try {
      await db.insert(shares).values({
        token,
        type,
        itemId,
        sharedBy: userId,
        snapshot,
        expiresAt: null,
      });

      return {
        token,
        shareUrl: `nippardation://share/${token}`,
        expiresAt: null,
      };
    } catch (error: unknown) {
      // Retry only on unique constraint violation (token collision)
      const isUniqueViolation =
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === '23505';

      if (isUniqueViolation && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Failed to generate unique share token after retries');
}

/**
 * Retrieves a share by its token. No auth required.
 *
 * Joins with the users table to get sharer info (handle, displayName, avatarUrl).
 * Returns null if the token doesn't exist or the share has expired.
 */
export async function getShareByToken(token: string): Promise<ShareResponse | null> {
  const results = await db
    .select({
      token: shares.token,
      type: shares.type,
      snapshot: shares.snapshot,
      expiresAt: shares.expiresAt,
      createdAt: shares.createdAt,
      sharedByHandle: users.handle,
      sharedByDisplayName: users.displayName,
      sharedByAvatar: users.profilePictureUrl,
    })
    .from(shares)
    .innerJoin(users, eq(shares.sharedBy, users.id))
    .where(eq(shares.token, token))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const row = results[0];

  // Check expiration
  if (row.expiresAt && row.expiresAt < new Date()) {
    return null;
  }

  const sharedBy = {
    handle: row.sharedByHandle,
    displayName: row.sharedByDisplayName,
    avatarUrl: row.sharedByAvatar,
  };

  if (row.type === 'template') {
    return {
      token: row.token,
      type: 'template',
      sharedBy,
      sharedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      template: row.snapshot as TemplateDetail,
      program: null,
    };
  } else {
    return {
      token: row.token,
      type: 'program',
      sharedBy,
      sharedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      template: null,
      program: row.snapshot as ProgramShareSnapshot,
    };
  }
}

// ============ Snapshot Builders ============

/**
 * Builds a full program snapshot with complete template exercises for each workout.
 *
 * getProgramById only returns exercise *counts* per workout (lightweight for list views).
 * For sharing, we need the full exercise details so the recipient can see exactly what
 * each workout contains. So we fetch each workout's template individually.
 *
 * Trade-off: A 7-day program makes 8 queries (1 program + 7 templates). This is
 * acceptable because sharing is infrequent and program size is bounded (max 7 days).
 * Could optimize with a single joined query later if needed.
 */
async function buildProgramSnapshot(
  programId: string,
  userId: string
): Promise<ProgramShareSnapshot> {
  const program = await getProgramById(programId, userId);
  if (!program) {
    throw new ShareNotFoundError('Program not found');
  }

  // Fetch full template details for each workout in parallel
  const workoutSnapshots: ProgramWorkoutShareSnapshot[] = await Promise.all(
    program.workouts.map(async (workout) => {
      const template = await getTemplateById(workout.templateId, userId);
      if (!template) {
        throw new ShareNotFoundError(`Template ${workout.templateId} not found for program workout`);
      }

      return {
        id: workout.id,
        dayNumber: workout.dayNumber,
        dayLabel: workout.dayLabel,
        templateId: workout.templateId,
        template,
      };
    })
  );

  return {
    id: program.id,
    name: program.name,
    description: program.description,
    daysPerWeek: program.daysPerWeek,
    durationWeeks: program.durationWeeks,
    isAiGenerated: program.isAiGenerated,
    workouts: workoutSnapshots,
    createdAt: program.createdAt,
    updatedAt: program.updatedAt,
  };
}

// ============ Custom Errors ============

/**
 * Thrown when the item to share doesn't exist or isn't owned by the user.
 * The route layer maps this to a 404 response.
 */
export class ShareNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareNotFoundError';
  }
}
