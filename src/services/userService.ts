import crypto from 'crypto';
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
    .where(eq(users.firebaseUid, decodedToken.uid))
    .limit(1);

  if (existingUser.length > 0) {
    // Update last synced timestamp
    const updatedUser = await db
      .update(users)
      .set({
        lastSyncedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(users.firebaseUid, decodedToken.uid))
      .returning();

    return updatedUser[0] || existingUser[0];
  }

  // 2. If the user does not exist, create a new record
  if (!decodedToken.email) {
    throw new Error('Cannot create user without an email.');
  }

  // Generate a unique handle using email prefix + cryptographically random suffix
  // e.g., 'john.doe@email.com' -> 'john.doe_a1b2c3d4'
  const emailPrefix = decodedToken.email.split('@')[0].substring(0, 20); // Limit prefix length
  const MAX_HANDLE_ATTEMPTS = 10;

  let handle: string | null = null;
  for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt++) {
    // Use crypto for secure random suffix (8 hex chars = 4 bytes = 32 bits of entropy)
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const candidateHandle = `${emailPrefix}_${randomSuffix}`;

    const existingHandle = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, candidateHandle))
      .limit(1);

    if (existingHandle.length === 0) {
      handle = candidateHandle;
      break;
    }
  }

  if (!handle) {
    throw new Error(`Failed to generate unique handle after ${MAX_HANDLE_ATTEMPTS} attempts`);
  }

  const newUser = {
    firebaseUid: decodedToken.uid,
    email: decodedToken.email,
    handle: handle,
    displayName: decodedToken.name || undefined,
    profilePictureUrl: decodedToken.picture || undefined,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const insertedUsers = await db.insert(users).values(newUser).returning();

  if (insertedUsers.length === 0) {
    throw new Error('Failed to create new user in the database.');
  }

  return insertedUsers[0];
};

/**
 * Updates a user's profile information
 * @param firebaseUid The Firebase UID of the user
 * @param updates Object containing the fields to update
 * @returns The updated user record
 */
export const updateUserProfile = async (firebaseUid: string, updates: Partial<{
  displayName: string;
  bio: string;
  height: number;
  weight: number;
  age: number;
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  unitPreference: 'metric' | 'imperial';
  isPublicProfile: boolean;
  notificationsEnabled: boolean;
}>) => {
  // Remove any undefined values and add sync timestamp
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, value]) => value !== undefined)
  );
  
  const updateData = {
    ...cleanUpdates,
    lastSyncedAt: new Date(),
    updatedAt: new Date()
  };

  const updatedUsers = await db
    .update(users)
    .set(updateData)
    .where(eq(users.firebaseUid, firebaseUid))
    .returning();

  if (updatedUsers.length === 0) {
    throw new Error('User not found or update failed.');
  }

  return updatedUsers[0];
};
