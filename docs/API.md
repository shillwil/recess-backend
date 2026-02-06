# Recess Backend API Documentation

## Base URL

- **Staging:** `https://recess-backend-staging.up.railway.app`
- **Production:** `https://recess-backend.up.railway.app`

---

## Authentication

All protected endpoints require a Firebase ID token in the `Authorization` header.

```
Authorization: Bearer <firebase_id_token>
```

### How to obtain a Firebase ID token (iOS)

```swift
let user = Auth.auth().currentUser
user?.getIDToken { token, error in
    guard let token = token else { return }
    // Use this token in the Authorization header
}
```

### Authentication Errors

| Status | Response |
|--------|----------|
| 401 | `{ "message": "Unauthorized: Missing or invalid Authorization header." }` |
| 401 | `{ "message": "Unauthorized: Bearer token is missing." }` |
| 401 | `{ "message": "Unauthorized: Invalid token.", "error": "<details>" }` |

---

## Response Format

All API responses follow this structure:

### Success Response
```json
{
  "success": true,
  "message": "Optional success message",
  "data": { ... },
  "user": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (development only)"
}
```

---

## Endpoints

### Health & Status

#### `GET /health`

Health check endpoint (no authentication required).

**Response (200):**
```json
{
  "status": "healthy",
  "environment": "production",
  "timestamp": "2026-02-06T12:00:00.000Z",
  "version": "1.0.0"
}
```

#### `GET /`

Root endpoint (no authentication required).

**Response (200):**
```
Recess backend is running in production mode.
```

---

### Authentication

#### `POST /api/auth/login`

Authenticates a user with Firebase and creates/retrieves their database record.

**Headers:**
```
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

**Request Body:** None required

**Response (200):**
```json
{
  "success": true,
  "message": "Authentication successful",
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid-string",
    "email": "user@example.com",
    "handle": "username1234",
    "displayName": "John Doe",
    "profilePictureUrl": "https://...",
    "bio": null,
    "height": null,
    "weight": null,
    "age": null,
    "gender": null,
    "unitPreference": "imperial",
    "isPublicProfile": true,
    "totalVolumeLiftedLbs": "0",
    "totalWorkouts": 0,
    "currentWorkoutStreak": 0,
    "longestWorkoutStreak": 0,
    "lastWorkoutDate": null,
    "pushNotificationTokens": [],
    "notificationsEnabled": true,
    "lastSyncedAt": "2026-02-06T12:00:00.000Z",
    "createdAt": "2026-02-06T12:00:00.000Z",
    "updatedAt": "2026-02-06T12:00:00.000Z"
  }
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Failed to authenticate user",
  "error": "Error details"
}
```

---

### User Profile

#### `GET /api/me`

Retrieves the current user's profile.

**Headers:**
```
Authorization: Bearer <firebase_id_token>
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid-string",
    "email": "user@example.com",
    "handle": "username1234",
    "displayName": "John Doe",
    "profilePictureUrl": "https://...",
    "bio": "Fitness enthusiast",
    "height": 72,
    "weight": 180,
    "age": 28,
    "gender": "male",
    "unitPreference": "imperial",
    "isPublicProfile": true,
    "totalVolumeLiftedLbs": "125000.50",
    "totalWorkouts": 45,
    "currentWorkoutStreak": 5,
    "longestWorkoutStreak": 14,
    "lastWorkoutDate": "2026-02-05T18:30:00.000Z",
    "pushNotificationTokens": ["token1", "token2"],
    "notificationsEnabled": true,
    "lastSyncedAt": "2026-02-06T12:00:00.000Z",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-02-06T12:00:00.000Z"
  }
}
```

#### `PUT /api/me`

Updates the current user's profile.

**Headers:**
```
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "displayName": "John Doe",
  "bio": "Fitness enthusiast",
  "height": 72,
  "weight": 180,
  "age": 28,
  "gender": "male",
  "unitPreference": "imperial",
  "isPublicProfile": true,
  "notificationsEnabled": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | User's display name |
| `bio` | string | User's bio/description |
| `height` | number | Height in inches |
| `weight` | number | Weight in pounds |
| `age` | number | User's age |
| `gender` | enum | `"male"`, `"female"`, `"other"`, `"prefer_not_to_say"` |
| `unitPreference` | enum | `"metric"` or `"imperial"` |
| `isPublicProfile` | boolean | Whether profile is publicly visible |
| `notificationsEnabled` | boolean | Whether push notifications are enabled |

All fields are optional. Only include fields you want to update.

**Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": { ... }
}
```

---

### Exercises

#### `GET /api/exercises`

Search and browse the exercise library with pagination.

**Headers:**
```
Authorization: Bearer <firebase_id_token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | - | Search query (case-insensitive name match) |
| `page` | number | 1 | Page number |
| `per_page` | number | 20 | Results per page (max: 100) |

**Example Request:**
```
GET /api/exercises?q=Barbell&page=1&per_page=10
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Barbell Bench Press",
      "muscleGroups": ["chest", "triceps", "shoulders"],
      "equipment": "barbell",
      "instructions": "Lie on a flat bench...",
      "videoUrl": "https://...",
      "isCustom": false,
      "createdBy": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "uuid",
      "name": "Barbell Squat",
      "muscleGroups": ["quads", "glutes", "hamstrings"],
      "equipment": "barbell",
      "instructions": "Stand with feet shoulder-width apart...",
      "videoUrl": null,
      "isCustom": false,
      "createdBy": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "perPage": 10,
    "total": 25,
    "totalPages": 3
  }
}
```

**Exercise Object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Unique exercise identifier |
| `name` | string | Exercise name |
| `muscleGroups` | string[] | Array of muscle groups targeted |
| `equipment` | string? | Equipment required (e.g., "barbell", "dumbbell") |
| `instructions` | string? | How to perform the exercise |
| `videoUrl` | string? | URL to instructional video |
| `isCustom` | boolean | Whether this is a user-created exercise |
| `createdBy` | uuid? | User ID if custom exercise |
| `createdAt` | timestamp | Creation timestamp |
| `updatedAt` | timestamp | Last update timestamp |

**Valid Muscle Groups:**
- `chest`, `back`, `shoulders`, `biceps`, `triceps`
- `quads`, `hamstrings`, `glutes`, `calves`, `abs`
- `forearms`, `traps`, `lats`

---

### Data Sync

#### `POST /api/sync`

Synchronizes workout data between the client and server. Supports bidirectional sync with conflict resolution.

**Headers:**
```
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "unique-device-identifier",
  "deviceInfo": {
    "name": "iPhone 15 Pro",
    "type": "ios",
    "appVersion": "1.2.0",
    "osVersion": "17.2"
  },
  "lastSyncTimestamp": "2026-02-05T12:00:00.000Z",
  "workouts": [
    {
      "clientId": "client-generated-uuid",
      "userId": "user-uuid",
      "date": "2026-02-06T10:00:00.000Z",
      "name": "Push Day",
      "durationSeconds": 3600,
      "isCompleted": true,
      "startTime": "2026-02-06T10:00:00.000Z",
      "endTime": "2026-02-06T11:00:00.000Z",
      "templateName": "Push Pull Legs - Push",
      "exercises": [
        {
          "clientId": "exercise-client-uuid",
          "exerciseName": "Barbell Bench Press",
          "muscleGroups": ["chest", "triceps", "shoulders"],
          "sets": [
            {
              "clientId": "set-client-uuid",
              "reps": 10,
              "weight": 135,
              "setType": "warmup",
              "exerciseTypeName": "Barbell Bench Press",
              "exerciseTypeMuscleGroups": ["chest", "triceps", "shoulders"],
              "updatedAt": "2026-02-06T10:05:00.000Z"
            },
            {
              "clientId": "set-client-uuid-2",
              "reps": 8,
              "weight": 185,
              "setType": "working",
              "exerciseTypeName": "Barbell Bench Press",
              "exerciseTypeMuscleGroups": ["chest", "triceps", "shoulders"],
              "updatedAt": "2026-02-06T10:10:00.000Z"
            }
          ],
          "updatedAt": "2026-02-06T10:10:00.000Z"
        }
      ],
      "updatedAt": "2026-02-06T11:00:00.000Z"
    }
  ]
}
```

**Request Body Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceId` | string | **Yes** | Unique identifier for the client device |
| `deviceInfo` | object | No | Device metadata |
| `deviceInfo.name` | string | No | Device name (e.g., "iPhone 15 Pro") |
| `deviceInfo.type` | string | No | `"ios"`, `"android"`, or `"web"` |
| `deviceInfo.appVersion` | string | No | App version string |
| `deviceInfo.osVersion` | string | No | OS version string |
| `lastSyncTimestamp` | string | No | ISO timestamp of last successful sync |
| `workouts` | array | **Yes** | Array of workouts to sync |

**Workout Object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | **Yes** | Client-generated UUID for this workout |
| `userId` | string | **Yes** | User's UUID |
| `date` | string | **Yes** | Workout date (ISO string) |
| `name` | string | No | Workout name |
| `durationSeconds` | number | No | Total workout duration |
| `isCompleted` | boolean | **Yes** | Whether workout is finished |
| `startTime` | string | No | When workout started (ISO string) |
| `endTime` | string | No | When workout ended (ISO string) |
| `templateName` | string | No | Name of template used |
| `exercises` | array | **Yes** | Array of exercises |
| `updatedAt` | string | **Yes** | Last modified timestamp (ISO string) |

**Exercise Object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | **Yes** | Client-generated UUID |
| `exerciseName` | string | **Yes** | Name of the exercise |
| `muscleGroups` | string[] | **Yes** | Targeted muscle groups |
| `sets` | array | **Yes** | Array of sets |
| `updatedAt` | string | **Yes** | Last modified timestamp |

**Set Object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | **Yes** | Client-generated UUID |
| `reps` | number | **Yes** | Number of repetitions |
| `weight` | number | **Yes** | Weight in pounds |
| `setType` | enum | **Yes** | `"warmup"` or `"working"` |
| `exerciseTypeName` | string | **Yes** | Exercise name (denormalized) |
| `exerciseTypeMuscleGroups` | string[] | **Yes** | Muscle groups (denormalized) |
| `updatedAt` | string | **Yes** | Last modified timestamp |

**Response (200):**
```json
{
  "success": true,
  "message": "Sync completed successfully",
  "data": {
    "success": true,
    "syncedAt": "2026-02-06T12:00:00.000Z",
    "conflicts": [
      {
        "entityType": "workout",
        "entityId": "server-workout-uuid",
        "clientData": { ... },
        "serverData": { ... },
        "resolution": "server_wins"
      }
    ],
    "serverData": {
      "workouts": [
        {
          "clientId": "workout-uuid",
          "userId": "user-uuid",
          "date": "2026-02-04T10:00:00.000Z",
          "name": "Leg Day",
          "durationSeconds": 4500,
          "isCompleted": true,
          "startTime": "2026-02-04T10:00:00.000Z",
          "endTime": "2026-02-04T11:15:00.000Z",
          "exercises": [ ... ],
          "updatedAt": "2026-02-04T11:15:00.000Z"
        }
      ],
      "lastServerSync": "2026-02-06T12:00:00.000Z"
    },
    "stats": {
      "uploaded": 1,
      "downloaded": 2,
      "conflicts": 0
    }
  }
}
```

**Sync Response Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether sync completed |
| `syncedAt` | string | Server timestamp of sync completion |
| `conflicts` | array? | Array of conflicts encountered |
| `serverData` | object? | Data from server since last sync |
| `serverData.workouts` | array | Workouts updated on server |
| `serverData.lastServerSync` | string | Timestamp to use for next sync |
| `stats` | object? | Sync statistics |
| `stats.uploaded` | number | Workouts uploaded to server |
| `stats.downloaded` | number | Workouts downloaded from server |
| `stats.conflicts` | number | Number of conflicts |

**Conflict Resolution:**

The server uses **timestamp-based conflict resolution**:
- If client timestamp is newer → client data wins
- If server timestamp is newer or equal → server data wins
- Conflicts are logged and returned in the response

**Error Response (400):**
```json
{
  "success": false,
  "message": "Device ID is required for sync"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Failed to sync user data",
  "error": "Error details"
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid auth token |
| 404 | Not Found - Endpoint doesn't exist |
| 500 | Internal Server Error |

### 404 Response
```json
{
  "success": false,
  "message": "Endpoint not found",
  "path": "/api/nonexistent"
}
```

### 500 Response
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Detailed message (development only)"
}
```

---

## iOS Client Implementation Notes

### Native App Considerations

Native iOS apps using `URLSession` don't send `Origin` headers (that's a browser concept). The backend automatically handles this - no special configuration needed on the client side.

### Recommended Request Configuration

```swift
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("Bearer \(firebaseToken)", forHTTPHeaderField: "Authorization")
```

### Sync Strategy

1. **On app launch:** Call `POST /api/auth/login` to ensure user exists
2. **Fetch user profile:** Call `GET /api/me`
3. **Sync workouts:** Call `POST /api/sync` with local changes and `lastSyncTimestamp`
4. **Search exercises:** Call `GET /api/exercises?q=<search>` for exercise lookup
5. **Store `lastServerSync`** from sync response for next sync call

### Generating Client IDs

Use UUIDs for all `clientId` fields:

```swift
let clientId = UUID().uuidString
```

---

## Data Types Reference

### User

```typescript
interface User {
  id: string;                    // UUID
  firebaseUid: string;           // Firebase UID
  email: string;
  handle: string;                // Unique username
  displayName?: string;
  profilePictureUrl?: string;
  bio?: string;
  height?: number;               // inches
  weight?: number;               // lbs
  age?: number;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  unitPreference: 'metric' | 'imperial';
  isPublicProfile: boolean;
  totalVolumeLiftedLbs: string;  // Decimal as string
  totalWorkouts: number;
  currentWorkoutStreak: number;
  longestWorkoutStreak: number;
  lastWorkoutDate?: string;      // ISO timestamp
  pushNotificationTokens: string[];
  notificationsEnabled: boolean;
  lastSyncedAt?: string;         // ISO timestamp
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

### Exercise

```typescript
interface Exercise {
  id: string;                    // UUID
  name: string;
  muscleGroups: string[];
  equipment?: string;
  instructions?: string;
  videoUrl?: string;
  isCustom: boolean;
  createdBy?: string;            // User UUID if custom
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

### Enums

**Gender:**
- `male`
- `female`
- `other`
- `prefer_not_to_say`

**Unit Preference:**
- `metric`
- `imperial`

**Set Type:**
- `warmup`
- `working`

**Device Type:**
- `ios`
- `android`
- `web`

**Muscle Groups:**
- `chest`, `back`, `shoulders`, `biceps`, `triceps`
- `quads`, `hamstrings`, `glutes`, `calves`, `abs`
- `forearms`, `traps`, `lats`
