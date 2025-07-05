import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

// Example table - you can modify this based on your needs
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// You can add more tables here as needed
// export const posts = pgTable('posts', {
//   id: serial('id').primaryKey(),
//   title: text('title').notNull(),
//   content: text('content'),
//   authorId: integer('author_id').references(() => users.id),
//   createdAt: timestamp('created_at').defaultNow(),
// });
