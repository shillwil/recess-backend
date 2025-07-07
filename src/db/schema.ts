import { integer, pgTable, serial, timestamp, varchar, boolean, numeric } from 'drizzle-orm/pg-core';

// Example table - you can modify this based on your needs
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  firebase_uid: varchar('firebase_uid', { length: 255 }).unique(),
  handle: varchar('handle', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  profile_picture_url: varchar('profile_picture_url', { length: 255 }),
  total_volume_lifted: numeric('total_volume_lifted'),
  last_workout_date: timestamp('last_workout_date'),
  current_workout_streak: integer('current_workout_streak'),
  unit_preference: varchar('unit_preference', { length: 3 }),
  push_notification_token: varchar('push_notification_token', { length: 255 }),
  notifications_enabled: boolean('notifications_enabled'),
  createdAt: timestamp('created_at').defaultNow()
});

// You can add more tables here as needed
// export const posts = pgTable('posts', {
//   id: serial('id').primaryKey(),
//   title: text('title').notNull(),
//   content: text('content'),
//   authorId: integer('author_id').references(() => users.id),
//   createdAt: timestamp('created_at').defaultNow(),
// });
