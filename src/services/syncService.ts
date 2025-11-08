import { db } from '../db';
import { 
  workouts, 
  workoutExercises, 
  sets, 
  syncMetadata, 
  syncQueue, 
  syncConflictLog,
  userDevices 
} from '../db/schema';
import { eq, and, gt, desc, asc } from 'drizzle-orm';

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
  muscleGroups: string[];
  sets: SetSyncData[];
  updatedAt: string; // ISO string
}

export interface SetSyncData {
  clientId: string;
  reps: number;
  weight: number; // in lbs
  setType: 'warmup' | 'working';
  exerciseTypeName: string;
  exerciseTypeMuscleGroups: string[];
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
  clientData: any;
  serverData: any;
  resolution: 'client_wins' | 'server_wins' | 'merged';
}

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
      
      // Process incoming workouts from client
      for (const workoutData of payload.workouts) {
        const result = await this.processWorkoutSync(userId, workoutData);
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
  
  private static async processWorkoutSync(userId: string, workoutData: WorkoutSyncData) {
    const clientTimestamp = new Date(workoutData.updatedAt);
    
    // Check if workout exists on server
    const existingWorkout = await db.select()
      .from(workouts)
      .where(and(
        eq(workouts.userId, userId),
        eq(workouts.clientId, workoutData.clientId)
      ))
      .limit(1);
    
    if (existingWorkout.length > 0) {
      // Handle update/conflict
      return await this.handleWorkoutUpdate(existingWorkout[0], workoutData, clientTimestamp);
    } else {
      // Create new workout
      return await this.createWorkoutFromSync(userId, workoutData, clientTimestamp);
    }
  }
  
  private static async handleWorkoutUpdate(
    existingWorkout: any, 
    clientData: WorkoutSyncData, 
    clientTimestamp: Date
  ) {
    const serverTimestamp = existingWorkout.updatedAt;
    const timeDiff = Math.abs(clientTimestamp.getTime() - serverTimestamp.getTime());
    
    // If timestamps are very close, prefer client data
    if (timeDiff <= this.CONFLICT_THRESHOLD_MS || clientTimestamp > serverTimestamp) {
      // Client wins - update server data
      await this.updateWorkoutFromSync(existingWorkout.id, clientData, clientTimestamp);
      return { conflict: null };
    } else {
      // Server data is newer - log conflict
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
  
  private static async createWorkoutFromSync(
    userId: string, 
    workoutData: WorkoutSyncData, 
    clientTimestamp: Date
  ) {
    const workoutId = crypto.randomUUID();
    
    // Insert workout
    await db.insert(workouts).values({
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
      
      await db.insert(workoutExercises).values({
        id: exerciseId,
        workoutId,
        clientId: exerciseData.clientId,
        exerciseId: await this.getOrCreateExerciseId(exerciseData.exerciseName, exerciseData.muscleGroups),
        orderIndex: exerciseIndex,
        exerciseName: exerciseData.exerciseName,
        muscleGroups: exerciseData.muscleGroups,
        clientUpdatedAt: new Date(exerciseData.updatedAt),
        lastSyncedAt: new Date(),
      });
      
      // Insert sets
      for (const [setIndex, setData] of exerciseData.sets.entries()) {
        await db.insert(sets).values({
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
    
    return { conflict: null };
  }
  
  private static async updateWorkoutFromSync(
    workoutId: string, 
    workoutData: WorkoutSyncData, 
    clientTimestamp: Date
  ) {
    // Update workout
    await db.update(workouts)
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
    
    // TODO: Update exercises and sets with conflict resolution
    // This would involve similar logic for each nested entity
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
  
  private static transformServerDataToClientFormat(serverData: any[]): WorkoutSyncData[] {
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
          name: row.workouts.name,
          durationSeconds: row.workouts.durationSeconds,
          isCompleted: row.workouts.isCompleted,
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
            muscleGroups: row.workout_exercises.muscleGroups,
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
            exerciseTypeMuscleGroups: row.workout_exercises.muscleGroups,
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
  
  private static async getOrCreateExerciseId(name: string, muscleGroups: string[]): Promise<string> {
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
      muscleGroups,
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
    
    const updateData: any = {
      currentSyncStatus: status,
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
      const existing = existingMetadata[0] ?? { failedSyncs: 0 };
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
    entityType: string,
    entityId: string,
    clientData: any,
    serverData: any,
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