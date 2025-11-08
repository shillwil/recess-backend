// Core user types
export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  handle: string;
  displayName?: string;
  profilePictureUrl?: string;
  bio?: string;
  height?: number; // inches
  weight?: number; // lbs
  age?: number;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  unitPreference: 'metric' | 'imperial';
  isPublicProfile: boolean;
  totalVolumeLiftedLbs: number;
  totalWorkouts: number;
  currentWorkoutStreak: number;
  longestWorkoutStreak: number;
  lastWorkoutDate?: string;
  pushNotificationTokens: string[];
  notificationsEnabled: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Exercise library
export interface Exercise {
  id: string;
  name: string;
  muscleGroups: string[];
  equipment?: string;
  instructions?: string;
  videoUrl?: string;
  isCustom: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// Workout templates
export interface WorkoutTemplate {
  id: string;
  userId: string;
  name: string;
  description?: string;
  isPublic: boolean;
  privacyLevel: 'private' | 'friends' | 'public';
  isAiGenerated: boolean;
  aiPrompt?: string;
  downloadCount: number;
  likeCount: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateExercise {
  id: string;
  templateId: string;
  exerciseId: string;
  orderIndex: number;
  warmupSets: number;
  workingSets: number;
  targetReps?: string; // e.g., "8-12"
  restSeconds?: number;
  notes?: string;
  createdAt: string;
}

// Actual workouts
export interface Workout {
  id: string;
  userId: string;
  templateId?: string;
  date: string;
  name?: string;
  durationSeconds?: number;
  isCompleted: boolean;
  startTime?: string;
  endTime?: string;
  totalVolumeLbs?: number;
  totalSets?: number;
  totalReps?: number;
  lastSyncedAt?: string;
  clientUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutExercise {
  id: string;
  workoutId: string;
  exerciseId: string;
  orderIndex: number;
  exerciseName: string; // Denormalized
  muscleGroups: string[]; // Denormalized
  lastSyncedAt?: string;
  clientUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Set {
  id: string;
  workoutExerciseId: string;
  setNumber: number;
  reps: number;
  weightLbs: number; // pounds
  setType: 'warmup' | 'working';
  rpe?: number; // Rate of Perceived Exertion (1-10)
  notes?: string;
  lastSyncedAt?: string;
  clientUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Social and progress tracking
export interface PersonalRecord {
  id: string;
  userId: string;
  exerciseId: string;
  recordType: string; // '1rm', '3rm', '5rm', 'max_reps', 'max_volume'
  value: number;
  unit?: string; // 'kg', 'lbs', 'reps'
  setId?: string;
  achievedAt: string;
  createdAt: string;
}

export interface ProgressPhoto {
  id: string;
  userId: string;
  photoUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  weight?: number; // lbs
  privacyLevel: 'private' | 'friends' | 'public';
  takenAt: string;
  createdAt: string;
}

export interface UserFollow {
  followerId: string;
  followingId: string;
  createdAt: string;
}

// Competition system
export interface Competition {
  id: string;
  creatorId: string;
  name: string;
  description?: string;
  type: 'individual' | 'group' | 'team';
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  metric: string; // 'total_volume', 'workout_count', 'exercise_prs', etc.
  targetExerciseId?: string;
  startDate: string;
  endDate: string;
  maxParticipants?: number;
  isPublic: boolean;
  entryCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitionParticipant {
  id: string;
  competitionId: string;
  userId: string;
  teamId?: string;
  currentScore: number;
  rank?: number;
  joinedAt: string;
  lastUpdatedAt: string;
}

// Multi-week programs
export interface WorkoutProgram {
  id: string;
  userId: string;
  name: string;
  description?: string;
  durationWeeks: number;
  isPublic: boolean;
  privacyLevel: 'private' | 'friends' | 'public';
  isAiGenerated: boolean;
  aiPrompt?: string;
  downloadCount: number;
  likeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramWeek {
  id: string;
  programId: string;
  weekNumber: number;
  dayNumber: number;
  templateId: string;
  createdAt: string;
}
