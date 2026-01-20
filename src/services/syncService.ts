import crypto from 'crypto';
import { db } from '../db';
import {
  workouts,
  workoutExercises,
  sets,
  syncMetadata,
  syncConflictLog,
  userDevices
} from '../db/schema';
import { eq, and, gt, asc, inArray } from 'drizzle-orm';

export interface SyncPayload {
  deviceId: string;
  deviceInfo?: {
    name?: string;
    type: string; // 'ios', 'android', 'web'
    appVersion: string;
    osVersion?: string;
  };
  lastSyncTimestamp?: string; // ISO string
  workouts: WorkoutSyncData[];
}

export interface WorkoutSyncData {
  clientId: string;
  userId: string;
  date: string; // ISO string
  name?: string;
  durationSeconds?: number;
  isCompleted: boolean;
  startTime?: string; // ISO string
  endTime?: string; // ISO string
  templateName?: string; // Maps to workoutTemplate field from Core Data
  exercises: ExerciseSyncData[];
  updatedAt: string; // ISO string - client timestamp
}

export interface ExerciseSyncData {
  clientId: string;
  exerciseName: string;
  primaryMuscles: string[];
  muscleGroups?: string[]; // Deprecated: for backwards compatibility with older iOS clients
  sets: SetSyncData[];
  updatedAt: string; // ISO string
}

export interface SetSyncData {
  clientId: string;
  reps: number;
  weight: number; // in lbs
  setType: 'warmup' | 'working';
  exerciseTypeName: string;
  exerciseTypePrimaryMuscles: string[];
  exerciseTypeMuscleGroups?: string[]; // Deprecated: for backwards compatibility with older iOS clients
  updatedAt: string; // ISO string
}

export interface SyncResponse {
  success: boolean;
  syncedAt: string;
  conflicts?: ConflictData[];
  serverData?: {
    workouts: WorkoutSyncData[];
    lastServerSync: string;
  };
  stats?: {
    uploaded: number;
    downloaded: number;
    conflicts: number;
  };
}

export interface ConflictData {
  entityType: 'workout' | 'exercise' | 'set';
  entityId: string;
  clientData: WorkoutSyncData | ExerciseSyncData | SetSyncData;
  serverData: WorkoutRecord | ExerciseRecord | SetRecord;
  resolution: 'client_wins' | 'server_wins' | 'merged';
}

// Type for workout record from database
interface WorkoutRecord {
  id: string;
  userId: string;
  clientId: string | null;
  date: Date;
  name: string | null;
  durationSeconds: number | null;
  isCompleted: boolean;
  startTime: Date | null;
  endTime: Date | null;
  updatedAt: Date;
  clientUpdatedAt: Date | null;
  lastSyncedAt: Date | null;
}

// Type for exercise record from database
interface ExerciseRecord {
  id: string;
  workoutId: string;
  clientId: string | null;
  exerciseId: string;
  orderIndex: number;
  exerciseName: string;
  primaryMuscles: string[];
  updatedAt: Date;
}

// Type for set record from database
interface SetRecord {
  id: string;
  workoutExerciseId: string;
  clientId: string | null;
  setNumber: number;
  reps: number | null;
  weightLbs: string | null;
  setType: string | null;
  updatedAt: Date;
}

import { normalizeExerciseData } from './syncHelpers';
import { recordExerciseUsage } from './exerciseService';
import { logWarn } from '../utils/errorResponse';

export class SyncService {
  private static readonly CONFLICT_THRESHOLD_MS = 5000; // 5 seconds

  static async syncUserData(userId: string, payload: SyncPayload): Promise<SyncResponse> {
    const syncStartTime = new Date();

    try {
      // Update device info
      await this.updateDeviceInfo(userId, payload.deviceId, payload.deviceInfo);

      // Start sync tracking
      await this.updateSyncMetadata(userId, 'syncing', payload.deviceId);

      const conflicts: ConflictData[] = [];
      const stats = { uploaded: 0, downloaded: 0, conflicts: 0 };

      // FIX N+1: Pre-fetch all existing workouts for this user's clientIds in one query
      const clientIds = payload.workouts.map(w => w.clientId);
      const existingWorkoutsMap = await this.getExistingWorkoutsMap(userId, clientIds);

      // Process incoming workouts from client using pre-fetched data
      for (const workoutData of payload.workouts) {
        const existingWorkout = existingWorkoutsMap.get(workoutData.clientId);
        const result = await this.processWorkoutSyncWithExisting(
          userId,
          workoutData,
          existingWorkout || null
        );
        if (result.conflict) {
          conflicts.push(result.conflict);
          stats.conflicts++;
        } else {
          stats.uploaded++;
        }
      }

      // Get server data that client doesn't have
      const lastSyncTimestamp = payload.lastSyncTimestamp
        ? new Date(payload.lastSyncTimestamp)
        : new Date(0);

      const serverWorkouts = await this.getServerWorkoutsSince(userId, lastSyncTimestamp);
      stats.downloaded = serverWorkouts.length;

      // Complete sync
      await this.updateSyncMetadata(userId, 'completed', payload.deviceId);

      return {
        success: true,
        syncedAt: syncStartTime.toISOString(),
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        serverData: {
          workouts: serverWorkouts,
          lastServerSync: syncStartTime.toISOString()
        },
        stats
      };

    } catch (error) {
      await this.updateSyncMetadata(userId, 'failed', payload.deviceId, error as Error);
      throw error;
    }
  }

  /**
   * Pre-fetch all existing workouts for a user's clientIds in a single query
   * This fixes the N+1 query problem by batching the lookup
   */
  private static async getExistingWorkoutsMap(
    userId: string,
    clientIds: string[]
  ): Promise<Map<string, WorkoutRecord>> {
    if (clientIds.length === 0) {
      return new Map();
    }

    const existingWorkouts = await db.select()
      .from(workouts)
      .where(and(
        eq(workouts.userId, userId),
        inArray(workouts.clientId, clientIds)
      ));

    const map = new Map<string, WorkoutRecord>();
    for (const workout of existingWorkouts) {
      if (workout.clientId) {
        map.set(workout.clientId, workout as WorkoutRecord);
      }
    }
    return map;
  }
  
  /**
   * Process a workout sync with pre-fetched existing workout data
   * This avoids the N+1 query problem
   */
  private static async processWorkoutSyncWithExisting(
    userId: string,
    workoutData: WorkoutSyncData,
    existingWorkout: WorkoutRecord | null
  ) {
    const clientTimestamp = new Date(workoutData.updatedAt);

    if (existingWorkout) {
      // Handle update/conflict
      return await this.handleWorkoutUpdate(existingWorkout, workoutData, clientTimestamp);
    } else {
      // Create new workout
      return await this.createWorkoutFromSync(userId, workoutData, clientTimestamp);
    }
  }

  private static async handleWorkoutUpdate(
    existingWorkout: WorkoutRecord,
    clientData: WorkoutSyncData,
    clientTimestamp: Date
  ) {
    const serverTimestamp = existingWorkout.updatedAt;

    // Symmetric resolution: prefer the version with the newer timestamp
    if (clientTimestamp > serverTimestamp) {
      // Client has newer timestamp - update server data
      await this.updateWorkoutFromSync(existingWorkout.id, clientData, clientTimestamp);
      return { conflict: null };
    } else {
      // Server has newer or equal timestamp - log conflict
      const conflict: ConflictData = {
        entityType: 'workout',
        entityId: existingWorkout.id,
        clientData,
        serverData: existingWorkout,
        resolution: 'server_wins'
      };
      
      await this.logSyncConflict(
        existingWorkout.userId,
        'workout',
        existingWorkout.id,
        clientData,
        existingWorkout,
        clientTimestamp,
        serverTimestamp,
        'server_wins'
      );
      
      return { conflict };
    }
  }
  
  /**
   * Creates a new workout from sync data within a transaction
   * This ensures all related data (workout, exercises, sets) is inserted atomically.
   * Handles race conditions where exercises might be deleted between lookup and use.
   */
  private static async createWorkoutFromSync(
    userId: string,
    workoutData: WorkoutSyncData,
    clientTimestamp: Date,
    retryCount = 0
  ): Promise<{ conflict: ConflictData | null }> {
    const MAX_RETRIES = 2;
    const workoutId = crypto.randomUUID();

    // Pre-fetch or create all exercise IDs outside the transaction to avoid nested transactions
    const exerciseLibraryIds: string[] = [];
    for (const exerciseData of workoutData.exercises) {
      const normalized = normalizeExerciseData(exerciseData);
      const libraryExerciseId = await this.getOrCreateExerciseId(
        exerciseData.exerciseName,
        normalized.normalizedPrimaryMuscles
      );
      exerciseLibraryIds.push(libraryExerciseId);
    }

    try {
      // Use transaction to ensure atomicity of workout creation
      await db.transaction(async (tx) => {
        // Insert workout
        await tx.insert(workouts).values({
          id: workoutId,
          userId,
          clientId: workoutData.clientId,
          date: new Date(workoutData.date),
          name: workoutData.name,
          durationSeconds: workoutData.durationSeconds,
          isCompleted: workoutData.isCompleted,
          startTime: workoutData.startTime ? new Date(workoutData.startTime) : null,
          endTime: workoutData.endTime ? new Date(workoutData.endTime) : null,
          clientUpdatedAt: clientTimestamp,
          lastSyncedAt: new Date(),
          // TODO: Look up templateId by templateName if provided
        });

        // Insert exercises and sets
        for (const [exerciseIndex, exerciseData] of workoutData.exercises.entries()) {
          const exerciseId = crypto.randomUUID();
          const normalized = normalizeExerciseData(exerciseData);
          const libraryExerciseId = exerciseLibraryIds[exerciseIndex];

          await tx.insert(workoutExercises).values({
            id: exerciseId,
            workoutId,
            clientId: exerciseData.clientId,
            exerciseId: libraryExerciseId,
            orderIndex: exerciseIndex,
            exerciseName: exerciseData.exerciseName,
            primaryMuscles: normalized.normalizedPrimaryMuscles,
            clientUpdatedAt: new Date(exerciseData.updatedAt),
            lastSyncedAt: new Date(),
          });

          // Insert sets
          for (const [setIndex, setData] of exerciseData.sets.entries()) {
            await tx.insert(sets).values({
              id: crypto.randomUUID(),
              workoutExerciseId: exerciseId,
              clientId: setData.clientId,
              setNumber: setIndex + 1,
              reps: setData.reps,
              weightLbs: setData.weight.toString(),
              setType: setData.setType,
              clientUpdatedAt: new Date(setData.updatedAt),
              lastSyncedAt: new Date(),
            });
          }
        }
      });

      // Record exercise usage outside transaction (non-critical, can fail independently)
      for (const libraryExerciseId of exerciseLibraryIds) {
        try {
          await recordExerciseUsage(userId, libraryExerciseId);
        } catch (usageError) {
          // Non-critical - log and continue
          logWarn('SyncService', `Failed to record usage for exercise ${libraryExerciseId}`, 'sync-usage', {
            exerciseId: libraryExerciseId,
            error: usageError instanceof Error ? usageError.message : 'Unknown error'
          });
        }
      }

      return { conflict: null };
    } catch (error) {
      // Check if this is a foreign key violation (exercise was deleted between lookup and insert)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isForeignKeyError = errorMessage.includes('foreign key') ||
                                errorMessage.includes('violates foreign key constraint') ||
                                errorMessage.includes('FOREIGN KEY');

      if (isForeignKeyError && retryCount < MAX_RETRIES) {
        // Retry with fresh exercise lookups
        logWarn('SyncService', `Foreign key error during sync, retrying`, 'sync-retry', {
          attempt: retryCount + 1,
          maxRetries: MAX_RETRIES
        });
        return this.createWorkoutFromSync(userId, workoutData, clientTimestamp, retryCount + 1);
      }

      // Re-throw if not a foreign key error or max retries exceeded
      throw error;
    }
  }

  /**
   * Updates an existing workout from sync data with full nested entity conflict resolution.
   * Uses timestamp-based conflict resolution at each level (workout, exercise, set).
   * All updates happen within a transaction for atomicity.
   */
  private static async updateWorkoutFromSync(
    workoutId: string,
    workoutData: WorkoutSyncData,
    clientTimestamp: Date
  ) {
    // Pre-fetch exercise IDs outside transaction (to avoid nested transaction issues)
    const exerciseLibraryIds: Map<string, string> = new Map();
    for (const exerciseData of workoutData.exercises) {
      const normalized = normalizeExerciseData(exerciseData);
      const libraryExerciseId = await this.getOrCreateExerciseId(
        exerciseData.exerciseName,
        normalized.normalizedPrimaryMuscles
      );
      exerciseLibraryIds.set(exerciseData.clientId, libraryExerciseId);
    }

    await db.transaction(async (tx) => {
      // 1. Update workout-level fields
      await tx.update(workouts)
        .set({
          date: new Date(workoutData.date),
          name: workoutData.name,
          durationSeconds: workoutData.durationSeconds,
          isCompleted: workoutData.isCompleted,
          startTime: workoutData.startTime ? new Date(workoutData.startTime) : null,
          endTime: workoutData.endTime ? new Date(workoutData.endTime) : null,
          clientUpdatedAt: clientTimestamp,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workouts.id, workoutId));

      // 2. Fetch existing exercises for this workout
      const existingExercises = await tx.select()
        .from(workoutExercises)
        .where(eq(workoutExercises.workoutId, workoutId));

      const existingExerciseMap = new Map<string, typeof existingExercises[0]>();
      for (const ex of existingExercises) {
        if (ex.clientId) {
          existingExerciseMap.set(ex.clientId, ex);
        }
      }

      // Track which client exercises we've processed (for deletion detection)
      const processedExerciseClientIds = new Set<string>();

      // 3. Process each exercise from client data
      for (const [exerciseIndex, exerciseData] of workoutData.exercises.entries()) {
        processedExerciseClientIds.add(exerciseData.clientId);
        const clientExerciseTimestamp = new Date(exerciseData.updatedAt);
        const normalized = normalizeExerciseData(exerciseData);
        const libraryExerciseId = exerciseLibraryIds.get(exerciseData.clientId)!;

        const existingExercise = existingExerciseMap.get(exerciseData.clientId);

        if (existingExercise) {
          // Exercise exists - check if client version is newer
          const serverExerciseTimestamp = existingExercise.updatedAt;

          if (clientExerciseTimestamp > serverExerciseTimestamp) {
            // Client is newer - update exercise
            await tx.update(workoutExercises)
              .set({
                exerciseId: libraryExerciseId,
                orderIndex: exerciseIndex,
                exerciseName: exerciseData.exerciseName,
                primaryMuscles: normalized.normalizedPrimaryMuscles,
                clientUpdatedAt: clientExerciseTimestamp,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(workoutExercises.id, existingExercise.id));
          }
          // If server is newer, keep server version (don't update)

          // 4. Process sets for this exercise (regardless of exercise update outcome)
          await this.syncExerciseSets(tx, existingExercise.id, exerciseData.sets, clientExerciseTimestamp);
        } else {
          // New exercise - insert it
          const newExerciseId = crypto.randomUUID();
          await tx.insert(workoutExercises).values({
            id: newExerciseId,
            workoutId,
            clientId: exerciseData.clientId,
            exerciseId: libraryExerciseId,
            orderIndex: exerciseIndex,
            exerciseName: exerciseData.exerciseName,
            primaryMuscles: normalized.normalizedPrimaryMuscles,
            clientUpdatedAt: clientExerciseTimestamp,
            lastSyncedAt: new Date(),
          });

          // Insert all sets for new exercise
          for (const [setIndex, setData] of exerciseData.sets.entries()) {
            await tx.insert(sets).values({
              id: crypto.randomUUID(),
              workoutExerciseId: newExerciseId,
              clientId: setData.clientId,
              setNumber: setIndex + 1,
              reps: setData.reps,
              weightLbs: setData.weight.toString(),
              setType: setData.setType,
              clientUpdatedAt: new Date(setData.updatedAt),
              lastSyncedAt: new Date(),
            });
          }
        }
      }

      // 5. Handle exercises that exist on server but not in client data
      // (These were deleted on client - remove them if client timestamp is newer)
      for (const [clientId, existingExercise] of existingExerciseMap) {
        if (!processedExerciseClientIds.has(clientId)) {
          // Exercise was deleted on client - check if deletion is newer than server update
          // Use the workout's client timestamp as the deletion timestamp
          if (clientTimestamp > existingExercise.updatedAt) {
            // Delete sets first (foreign key constraint)
            await tx.delete(sets)
              .where(eq(sets.workoutExerciseId, existingExercise.id));
            // Delete exercise
            await tx.delete(workoutExercises)
              .where(eq(workoutExercises.id, existingExercise.id));
          }
        }
      }
    });
  }

  /**
   * Syncs sets for an existing exercise with conflict resolution.
   * Called within a transaction context.
   * @param exerciseClientTimestamp - The exercise's client timestamp, used for deletion reference when no sets remain
   */
  private static async syncExerciseSets(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    workoutExerciseId: string,
    clientSets: SetSyncData[],
    exerciseClientTimestamp: Date
  ) {
    // Fetch existing sets
    const existingSets = await tx.select()
      .from(sets)
      .where(eq(sets.workoutExerciseId, workoutExerciseId));

    const existingSetMap = new Map<string, typeof existingSets[0]>();
    for (const set of existingSets) {
      if (set.clientId) {
        existingSetMap.set(set.clientId, set);
      }
    }

    // Track processed sets for deletion detection
    const processedSetClientIds = new Set<string>();

    // Process each set from client
    for (const [setIndex, setData] of clientSets.entries()) {
      processedSetClientIds.add(setData.clientId);
      const clientSetTimestamp = new Date(setData.updatedAt);
      const existingSet = existingSetMap.get(setData.clientId);

      if (existingSet) {
        // Set exists - check if client is newer
        const serverSetTimestamp = existingSet.updatedAt;

        if (clientSetTimestamp > serverSetTimestamp) {
          // Client is newer - update set
          await tx.update(sets)
            .set({
              setNumber: setIndex + 1,
              reps: setData.reps,
              weightLbs: setData.weight.toString(),
              setType: setData.setType,
              clientUpdatedAt: clientSetTimestamp,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(sets.id, existingSet.id));
        }
        // If server is newer, keep server version
      } else {
        // New set - insert it
        await tx.insert(sets).values({
          id: crypto.randomUUID(),
          workoutExerciseId,
          clientId: setData.clientId,
          setNumber: setIndex + 1,
          reps: setData.reps,
          weightLbs: setData.weight.toString(),
          setType: setData.setType,
          clientUpdatedAt: clientSetTimestamp,
          lastSyncedAt: new Date(),
        });
      }
    }

    // Handle sets deleted on client
    // Use the newest client set timestamp as deletion reference, or fall back to exercise timestamp
    // (consistent with exercise deletion logic which uses the parent workout's timestamp)
    const newestClientSetTime = clientSets.length > 0
      ? new Date(Math.max(...clientSets.map(s => new Date(s.updatedAt).getTime())))
      : exerciseClientTimestamp;

    for (const [clientId, existingSet] of existingSetMap) {
      if (!processedSetClientIds.has(clientId)) {
        // Set was deleted on client
        if (newestClientSetTime > existingSet.updatedAt) {
          await tx.delete(sets)
            .where(eq(sets.id, existingSet.id));
        }
      }
    }
  }
  
  private static async getServerWorkoutsSince(userId: string, since: Date): Promise<WorkoutSyncData[]> {
    const serverWorkouts = await db.select()
      .from(workouts)
      .leftJoin(workoutExercises, eq(workouts.id, workoutExercises.workoutId))
      .leftJoin(sets, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(and(
        eq(workouts.userId, userId),
        gt(workouts.updatedAt, since)
      ))
      .orderBy(asc(workouts.date));
    
    // Transform to client format
    return this.transformServerDataToClientFormat(serverWorkouts);
  }
  
  // Type for joined workout data from the database query
  private static transformServerDataToClientFormat(
    serverData: Array<{
      workouts: typeof workouts.$inferSelect | null;
      workout_exercises: typeof workoutExercises.$inferSelect | null;
      sets: typeof sets.$inferSelect | null;
    }>
  ): WorkoutSyncData[] {
    const workoutMap = new Map<string, WorkoutSyncData>();
    const exerciseMap = new Map<string, Map<string, ExerciseSyncData>>();
    
    for (const row of serverData) {
      if (!row.workouts) continue;
      
      const workoutId = row.workouts.id;
      
      // Create workout if not exists
      if (!workoutMap.has(workoutId)) {
        workoutMap.set(workoutId, {
          clientId: row.workouts.clientId || workoutId,
          userId: row.workouts.userId,
          date: row.workouts.date.toISOString(),
          name: row.workouts.name ?? undefined,
          durationSeconds: row.workouts.durationSeconds ?? undefined,
          isCompleted: row.workouts.isCompleted ?? false,
          startTime: row.workouts.startTime?.toISOString(),
          endTime: row.workouts.endTime?.toISOString(),
          exercises: [],
          updatedAt: row.workouts.updatedAt.toISOString(),
        });
        exerciseMap.set(workoutId, new Map());
      }
      
      // Add exercise if exists
      if (row.workout_exercises) {
        const exerciseId = row.workout_exercises.id;
        const workoutExercises = exerciseMap.get(workoutId)!;
        
        if (!workoutExercises.has(exerciseId)) {
          workoutExercises.set(exerciseId, {
            clientId: row.workout_exercises.clientId || exerciseId,
            exerciseName: row.workout_exercises.exerciseName,
            primaryMuscles: row.workout_exercises.primaryMuscles,
            sets: [],
            updatedAt: row.workout_exercises.updatedAt.toISOString(),
          });
        }
        
        // Add set if exists
        if (row.sets) {
          const exercise = workoutExercises.get(exerciseId)!;
          exercise.sets.push({
            clientId: row.sets.clientId || row.sets.id,
            reps: row.sets.reps,
            weight: parseFloat(row.sets.weightLbs),
            setType: row.sets.setType as 'warmup' | 'working',
            exerciseTypeName: row.workout_exercises.exerciseName,
            exerciseTypePrimaryMuscles: row.workout_exercises.primaryMuscles,
            updatedAt: row.sets.updatedAt.toISOString(),
          });
        }
      }
    }
    
    // Convert exercise maps to arrays
    for (const [workoutId, workout] of workoutMap) {
      const exercises = exerciseMap.get(workoutId);
      if (exercises) {
        workout.exercises = Array.from(exercises.values());
      }
    }
    
    return Array.from(workoutMap.values());
  }
  
  private static async getOrCreateExerciseId(name: string, primaryMuscles: string[]): Promise<string> {
    const { exercises } = await import('../db/schema');

    // Try to find existing exercise by name
    const existingExercise = await db.select()
      .from(exercises)
      .where(eq(exercises.name, name))
      .limit(1);

    if (existingExercise.length > 0) {
      return existingExercise[0].id;
    }

    // Create new exercise
    const exerciseId = crypto.randomUUID();
    await db.insert(exercises).values({
      id: exerciseId,
      name,
      primaryMuscles,
      isCustom: true, // Mark as custom since it came from client
    });

    return exerciseId;
  }
  
  private static async updateDeviceInfo(
    userId: string, 
    deviceId: string, 
    deviceInfo?: SyncPayload['deviceInfo']
  ) {
    const existingDevice = await db.select()
      .from(userDevices)
      .where(and(
        eq(userDevices.userId, userId),
        eq(userDevices.deviceId, deviceId)
      ))
      .limit(1);
    
    if (existingDevice.length > 0) {
      await db.update(userDevices)
        .set({
          deviceName: deviceInfo?.name,
          deviceType: deviceInfo?.type,
          appVersion: deviceInfo?.appVersion,
          osVersion: deviceInfo?.osVersion,
          lastActiveAt: new Date(),
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userDevices.id, existingDevice[0].id));
    } else {
      await db.insert(userDevices).values({
        userId,
        deviceId,
        deviceName: deviceInfo?.name,
        deviceType: deviceInfo?.type || 'unknown',
        appVersion: deviceInfo?.appVersion || 'unknown',
        osVersion: deviceInfo?.osVersion,
        lastActiveAt: new Date(),
        lastSyncAt: new Date(),
      });
    }
  }
  
  private static async updateSyncMetadata(
    userId: string,
    status: 'syncing' | 'completed' | 'failed',
    deviceId: string,
    error?: Error
  ) {
    const existingMetadata = await db.select()
      .from(syncMetadata)
      .where(eq(syncMetadata.userId, userId))
      .limit(1);

    // Type for sync metadata update - matches schema enum values
    interface SyncMetadataUpdate {
      currentSyncStatus: 'pending' | 'syncing' | 'completed' | 'failed';
      lastSyncDeviceId: string;
      updatedAt: Date;
      lastSyncStarted?: Date;
      lastSyncCompleted?: Date;
      lastSyncFailed?: Date;
      totalSyncs?: number;
      successfulSyncs?: number;
      failedSyncs?: number;
      lastSyncError?: { code: string; message: string; timestamp: string } | null;
    }

    const updateData: SyncMetadataUpdate = {
      currentSyncStatus: status as 'pending' | 'syncing' | 'completed' | 'failed',
      lastSyncDeviceId: deviceId,
      updatedAt: new Date(),
    };
    
    if (status === 'syncing') {
      updateData.lastSyncStarted = new Date();
    } else if (status === 'completed') {
      updateData.lastSyncCompleted = new Date();
      const existing = existingMetadata[0] ?? { totalSyncs: 0, successfulSyncs: 0 };
      updateData.totalSyncs = (existing.totalSyncs ?? 0) + 1;
      updateData.successfulSyncs = (existing.successfulSyncs ?? 0) + 1;
    } else if (status === 'failed') {
      updateData.lastSyncFailed = new Date();
      const existing = existingMetadata[0] ?? { failedSyncs: 0, totalSyncs: 0 };
      updateData.totalSyncs = (existing.totalSyncs ?? 0) + 1;
      updateData.failedSyncs = (existing.failedSyncs ?? 0) + 1;
      updateData.lastSyncError = error ? {
        code: 'SYNC_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
      } : null;
    }
    
    if (existingMetadata.length > 0) {
      await db.update(syncMetadata)
        .set(updateData)
        .where(eq(syncMetadata.id, existingMetadata[0].id));
    } else {
      await db.insert(syncMetadata).values({
        userId,
        ...updateData,
      });
    }
  }
  
  private static async logSyncConflict(
    userId: string,
    entityType: 'workout' | 'exercise' | 'set',
    entityId: string,
    clientData: WorkoutSyncData | ExerciseSyncData | SetSyncData,
    serverData: WorkoutRecord | ExerciseRecord | SetRecord,
    clientTimestamp: Date,
    serverTimestamp: Date,
    resolution: 'client_wins' | 'server_wins' | 'merged'
  ) {
    await db.insert(syncConflictLog).values({
      userId,
      entityType,
      entityId,
      clientData,
      serverData,
      clientTimestamp,
      serverTimestamp,
      resolution,
      resolvedAt: new Date(),
      resolvedBy: 'system',
    });
  }
}