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

  // Generate a simple unique handle from the email.
  // e.g., 'john.doe@email.com' -> 'john.doe1234'
  let handle = `${decodedToken.email.split('@')[0]}${Math.floor(1000 + Math.random() * 9000)}`;
  
  // Ensure handle is unique
  let attempts = 0;
  while (attempts < 5) {
    const existingHandle = await db
      .select()
      .from(users)
      .where(eq(users.handle, handle))
      .limit(1);
    
    if (existingHandle.length === 0) break;
    
    handle = `${decodedToken.email.split('@')[0]}${Math.floor(1000 + Math.random() * 9000)}`;
    attempts++;
  }

  const newUser = {
    firebaseUid: decodedToken.uid,
    email: decodedToken.email,
    handle: handle,
    displayName: decodedToken.name || undefined,
    profilePictureUrl: decodedToken.picture || undefined,
    lastSyncedAt: new Date(),
  };


  try {
    const insertedUsers = await db.insert(users).values(newUser).returning();

    if (insertedUsers.length === 0) {
      throw new Error('Failed to create new user in the database.');
    }

    return insertedUsers[0];
  } catch (error) {
    throw error;
  }
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
