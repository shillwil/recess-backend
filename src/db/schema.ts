import { 
  integer, 
  pgTable, 
  uuid, 
  timestamp, 
  varchar, 
  boolean, 
  numeric, 
  text, 
  jsonb,
  real,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const unitPreferenceEnum = pgEnum('unit_preference', ['metric', 'imperial']);
export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'prefer_not_to_say']);
export const setTypeEnum = pgEnum('set_type', ['warmup', 'working']);
export const privacyLevelEnum = pgEnum('privacy_level', ['private', 'friends', 'public']);
export const competitionTypeEnum = pgEnum('competition_type', ['individual', 'group', 'team']);
export const competitionStatusEnum = pgEnum('competition_status', ['draft', 'active', 'completed', 'cancelled']);
export const muscleGroupEnum = pgEnum('muscle_group', [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
  'forearms', 'traps', 'lats'
]);

// Users table - Core user data with sync tracking
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  firebaseUid: varchar('firebase_uid', { length: 255 }).unique().notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  handle: varchar('handle', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }),
  profilePictureUrl: text('profile_picture_url'),
  bio: text('bio'),
  
  // Physical attributes
  height: real('height'), // in inches
  weight: real('weight'), // in lbs
  age: integer('age'),
  gender: genderEnum('gender'),
  
  // Preferences
  unitPreference: unitPreferenceEnum('unit_preference').default('imperial'),
  isPublicProfile: boolean('is_public_profile').default(true),
  
  // Stats
  totalVolumeLiftedLbs: numeric('total_volume_lifted_lbs', { precision: 12, scale: 2 }).default('0'),
  totalWorkouts: integer('total_workouts').default(0),
  currentWorkoutStreak: integer('current_workout_streak').default(0),
  longestWorkoutStreak: integer('longest_workout_streak').default(0),
  lastWorkoutDate: timestamp('last_workout_date'),
  
  // Push notifications
  pushNotificationTokens: jsonb('push_notification_tokens').$type<string[]>().default([]),
  notificationsEnabled: boolean('notifications_enabled').default(true),
  
  // Sync tracking
  lastSyncedAt: timestamp('last_synced_at'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  firebaseUidIdx: index('users_firebase_uid_idx').on(table.firebaseUid),
  handleIdx: index('users_handle_idx').on(table.handle),
  emailIdx: index('users_email_idx').on(table.email)
}));

// Exercise library - Pre-defined exercises
export const exercises = pgTable('exercises', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  muscleGroups: jsonb('muscle_groups').$type<string[]>().notNull(),
  equipment: varchar('equipment', { length: 50 }),
  instructions: text('instructions'),
  videoUrl: text('video_url'),
  isCustom: boolean('is_custom').default(false),
  createdBy: uuid('created_by').references(() => users.id),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  nameIdx: index('exercises_name_idx').on(table.name)
}));

// Workout templates - For saved/AI-generated workout plans
export const workoutTemplates = pgTable('workout_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  
  // Privacy and sharing
  isPublic: boolean('is_public').default(false),
  privacyLevel: privacyLevelEnum('privacy_level').default('private'),
  
  // AI-generated metadata
  isAiGenerated: boolean('is_ai_generated').default(false),
  aiPrompt: text('ai_prompt'),
  
  // Stats
  downloadCount: integer('download_count').default(0),
  likeCount: integer('like_count').default(0),
  
  // Sync tracking
  lastSyncedAt: timestamp('last_synced_at'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdIdx: index('workout_templates_user_id_idx').on(table.userId),
  isPublicIdx: index('workout_templates_is_public_idx').on(table.isPublic)
}));

// Template exercises - Exercises within a workout template
export const templateExercises = pgTable('template_exercises', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').references(() => workoutTemplates.id, { onDelete: 'cascade' }).notNull(),
  exerciseId: uuid('exercise_id').references(() => exercises.id).notNull(),
  orderIndex: integer('order_index').notNull(),
  
  // Default values for the exercise
  warmupSets: integer('warmup_sets').default(0),
  workingSets: integer('working_sets').notNull(),
  targetReps: varchar('target_reps', { length: 20 }), // e.g., "8-12" or "10"
  restSeconds: integer('rest_seconds'),
  notes: text('notes'),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  templateIdIdx: index('template_exercises_template_id_idx').on(table.templateId),
  templateOrderIdx: index('template_exercises_template_order_idx').on(table.templateId, table.orderIndex)
}));

// Workout programs - Multi-week training programs
export const workoutPrograms = pgTable('workout_programs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  durationWeeks: integer('duration_weeks').notNull(),
  
  // Privacy and sharing
  isPublic: boolean('is_public').default(false),
  privacyLevel: privacyLevelEnum('privacy_level').default('private'),
  
  // AI-generated metadata
  isAiGenerated: boolean('is_ai_generated').default(false),
  aiPrompt: text('ai_prompt'),
  
  // Stats
  downloadCount: integer('download_count').default(0),
  likeCount: integer('like_count').default(0),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdIdx: index('workout_programs_user_id_idx').on(table.userId)
}));

// Program weeks - Links templates to specific weeks in a program
export const programWeeks = pgTable('program_weeks', {
  id: uuid('id').defaultRandom().primaryKey(),
  programId: uuid('program_id').references(() => workoutPrograms.id, { onDelete: 'cascade' }).notNull(),
  weekNumber: integer('week_number').notNull(),
  dayNumber: integer('day_number').notNull(),
  templateId: uuid('template_id').references(() => workoutTemplates.id).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  programWeekDayIdx: uniqueIndex('program_week_day_idx').on(table.programId, table.weekNumber, table.dayNumber)
}));

// Workouts - Actual workout sessions
export const workouts = pgTable('workouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  templateId: uuid('template_id').references(() => workoutTemplates.id),
  
  // Workout data
  date: timestamp('date').notNull(),
  name: varchar('name', { length: 200 }),
  durationSeconds: integer('duration_seconds'),
  isCompleted: boolean('is_completed').default(false),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  
  // Calculated stats
  totalVolumeLbs: numeric('total_volume_lbs', { precision: 10, scale: 2 }),
  totalSets: integer('total_sets'),
  totalReps: integer('total_reps'),
  
  // Sync tracking
  lastSyncedAt: timestamp('last_synced_at'),
  clientUpdatedAt: timestamp('client_updated_at'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  userIdIdx: index('workouts_user_id_idx').on(table.userId),
  dateIdx: index('workouts_date_idx').on(table.date),
  userDateIdx: index('workouts_user_date_idx').on(table.userId, table.date)
}));

// Workout exercises - Exercises performed in a workout
export const workoutExercises = pgTable('workout_exercises', {
  id: uuid('id').defaultRandom().primaryKey(),
  workoutId: uuid('workout_id').references(() => workouts.id, { onDelete: 'cascade' }).notNull(),
  exerciseId: uuid('exercise_id').references(() => exercises.id).notNull(),
  orderIndex: integer('order_index').notNull(),
  
  // Exercise metadata
  exerciseName: varchar('exercise_name', { length: 100 }).notNull(), // Denormalized for performance
  muscleGroups: jsonb('muscle_groups').$type<string[]>().notNull(), // Denormalized for performance
  
  // Sync tracking
  lastSyncedAt: timestamp('last_synced_at'),
  clientUpdatedAt: timestamp('client_updated_at'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  workoutIdIdx: index('workout_exercises_workout_id_idx').on(table.workoutId),
  workoutOrderIdx: index('workout_exercises_workout_order_idx').on(table.workoutId, table.orderIndex)
}));

// Sets - Individual sets within an exercise
export const sets = pgTable('sets', {
  id: uuid('id').defaultRandom().primaryKey(),
  workoutExerciseId: uuid('workout_exercise_id').references(() => workoutExercises.id, { onDelete: 'cascade' }).notNull(),
  
  // Set data
  setNumber: integer('set_number').notNull(),
  reps: integer('reps').notNull(),
  weightLbs: numeric('weight_lbs', { precision: 6, scale: 2 }).notNull(),
  setType: setTypeEnum('set_type').notNull(),
  
  // Additional data
  rpe: real('rpe'), // Rate of Perceived Exertion (1-10)
  notes: text('notes'),
  
  // Sync tracking
  lastSyncedAt: timestamp('last_synced_at'),
  clientUpdatedAt: timestamp('client_updated_at'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  workoutExerciseIdIdx: index('sets_workout_exercise_id_idx').on(table.workoutExerciseId),
  workoutExerciseSetIdx: index('sets_workout_exercise_set_idx').on(table.workoutExerciseId, table.setNumber)
}));

// Personal records
export const personalRecords = pgTable('personal_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  exerciseId: uuid('exercise_id').references(() => exercises.id).notNull(),
  
  // Record data
  recordType: varchar('record_type', { length: 20 }).notNull(), // '1rm', '3rm', '5rm', 'max_reps', 'max_volume'
  value: numeric('value', { precision: 8, scale: 2 }).notNull(),
  unit: varchar('unit', { length: 10 }), // 'kg', 'lbs', 'reps'
  
  // Reference to the set that achieved this PR
  setId: uuid('set_id').references(() => sets.id),
  achievedAt: timestamp('achieved_at').notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  userExerciseTypeIdx: uniqueIndex('personal_records_user_exercise_type_idx').on(
    table.userId, 
    table.exerciseId, 
    table.recordType
  )
}));

// User follows - Social connections
export const userFollows = pgTable('user_follows', {
  followerId: uuid('follower_id').references(() => users.id).notNull(),
  followingId: uuid('following_id').references(() => users.id).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.followerId, table.followingId] }),
  followerIdx: index('user_follows_follower_idx').on(table.followerId),
  followingIdx: index('user_follows_following_idx').on(table.followingId)
}));

// Progress photos
export const progressPhotos = pgTable('progress_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  
  photoUrl: text('photo_url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  caption: text('caption'),
  weight: real('weight'), // User's weight at time of photo (in lbs)
  
  privacyLevel: privacyLevelEnum('privacy_level').default('private'),
  
  takenAt: timestamp('taken_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  userIdIdx: index('progress_photos_user_id_idx').on(table.userId),
  userTakenAtIdx: index('progress_photos_user_taken_at_idx').on(table.userId, table.takenAt)
}));

// Competitions
export const competitions = pgTable('competitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id').references(() => users.id).notNull(),
  
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  type: competitionTypeEnum('type').notNull(),
  status: competitionStatusEnum('status').default('draft').notNull(),
  
  // Competition rules
  metric: varchar('metric', { length: 50 }).notNull(), // 'total_volume', 'workout_count', 'exercise_prs', etc.
  targetExerciseId: uuid('target_exercise_id').references(() => exercises.id), // For exercise-specific competitions
  
  // Dates
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  
  // Settings
  maxParticipants: integer('max_participants'),
  isPublic: boolean('is_public').default(true),
  entryCode: varchar('entry_code', { length: 10 }), // For private competitions
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  creatorIdIdx: index('competitions_creator_id_idx').on(table.creatorId),
  statusIdx: index('competitions_status_idx').on(table.status),
  startDateIdx: index('competitions_start_date_idx').on(table.startDate)
}));

// Competition participants
export const competitionParticipants = pgTable('competition_participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  competitionId: uuid('competition_id').references(() => competitions.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  teamId: uuid('team_id'), // For team competitions
  
  // Stats
  currentScore: numeric('current_score', { precision: 12, scale: 2 }).default('0'),
  rank: integer('rank'),
  
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  lastUpdatedAt: timestamp('last_updated_at').defaultNow().notNull()
}, (table) => ({
  competitionUserIdx: uniqueIndex('competition_participants_comp_user_idx').on(table.competitionId, table.userId),
  competitionIdIdx: index('competition_participants_competition_idx').on(table.competitionId)
}));

// Template likes - Track which templates users like
export const templateLikes = pgTable('template_likes', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  templateId: uuid('template_id').references(() => workoutTemplates.id, { onDelete: 'cascade' }).notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.templateId] }),
  templateIdIdx: index('template_likes_template_idx').on(table.templateId)
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  workouts: many(workouts),
  workoutTemplates: many(workoutTemplates),
  workoutPrograms: many(workoutPrograms),
  personalRecords: many(personalRecords),
  progressPhotos: many(progressPhotos),
  followers: many(userFollows, { relationName: 'followers' }),
  following: many(userFollows, { relationName: 'following' }),
  competitions: many(competitions),
  competitionParticipations: many(competitionParticipants),
  templateLikes: many(templateLikes)
}));

export const exercisesRelations = relations(exercises, ({ many }) => ({
  templateExercises: many(templateExercises),
  workoutExercises: many(workoutExercises),
  personalRecords: many(personalRecords)
}));

export const workoutTemplatesRelations = relations(workoutTemplates, ({ one, many }) => ({
  user: one(users, {
    fields: [workoutTemplates.userId],
    references: [users.id]
  }),
  exercises: many(templateExercises),
  workouts: many(workouts),
  likes: many(templateLikes)
}));

export const workoutsRelations = relations(workouts, ({ one, many }) => ({
  user: one(users, {
    fields: [workouts.userId],
    references: [users.id]
  }),
  template: one(workoutTemplates, {
    fields: [workouts.templateId],
    references: [workoutTemplates.id]
  }),
  exercises: many(workoutExercises)
}));

export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, {
    fields: [workoutExercises.workoutId],
    references: [workouts.id]
  }),
  exercise: one(exercises, {
    fields: [workoutExercises.exerciseId],
    references: [exercises.id]
  }),
  sets: many(sets)
}));

export const setsRelations = relations(sets, ({ one }) => ({
  workoutExercise: one(workoutExercises, {
    fields: [sets.workoutExerciseId],
    references: [workoutExercises.id]
  })
}));