import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import * as admin from 'firebase-admin';

/**
 * Finds a user in the database by their Firebase UID or creates a new one if not found.
 * This function is the bridge between Firebase Authentication and the local user database.
 * @param decodedToken The decoded Firebase ID token containing user information.
 * @returns The existing or newly created user record from the database.
 */
export const getOrCreateUser = async (decodedToken: admin.auth.DecodedIdToken) => {
  // 1. Check if the user already exists in our database
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.firebase_uid, decodedToken.uid))
    .limit(1);

  if (existingUser.length > 0) {
    return existingUser[0];
  }

  // 2. If the user does not exist, create a new record
  if (!decodedToken.email) {
    throw new Error('Cannot create user without an email.');
  }

  // Generate a simple unique handle from the email.
  // e.g., 'john.doe@email.com' -> 'john.doe1234'
  const handle = `${decodedToken.email.split('@')[0]}${Math.floor(1000 + Math.random() * 9000)}`;

  const newUser = {
    firebase_uid: decodedToken.uid,
    email: decodedToken.email,
    handle: handle,
    name: decodedToken.name || null, // Use name from token, or null
    profile_picture_url: decodedToken.picture || null, // Use picture from token, or null
  };

  const insertedUsers = await db.insert(users).values(newUser).returning();

  if (insertedUsers.length === 0) {
    throw new Error('Failed to create new user in the database.');
  }

  return insertedUsers[0];
};
