---
name: code-review
description: Principal engineer-level code review for recess-backend. Examines Node.js/Express code for security vulnerabilities, Drizzle ORM misuse, API design issues, and deviation from established patterns. Use on PRs, before merges, or with /code-review command.
---

# Code Review - recess-backend

Review with the mindset: "Would I approve this for production?"

## Review Checklist

### 1. Security (Block-Worthy)

**SQL Injection:**
```typescript
// BLOCK: Raw query with user input
await db.execute(`SELECT * FROM movements WHERE id = ${req.params.id}`)

// CORRECT: Parameterized via Drizzle
await db.select().from(movements).where(eq(movements.id, parseInt(req.params.id)))
```

**Secrets Exposure:**
```typescript
// BLOCK: Hardcoded credentials
const R2_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'

// BLOCK: Logging secrets
console.log('Config:', process.env)

// CORRECT: Environment variables, no logging
const r2Client = new S3Client({
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})
```

**Input Validation:**
```typescript
// BLOCK: No validation
app.post('/api/videos/upload', async (req, res) => {
  const { movementId } = req.body  // Could be anything
  await db.update(movements).set({ videoUrl }).where(eq(movements.id, movementId))
})

// CORRECT: Validate and sanitize
app.post('/api/videos/upload', async (req, res) => {
  const movementId = parseInt(req.body.movementId)
  if (isNaN(movementId) || movementId < 1) {
    return res.status(400).json({ error: 'Invalid movementId' })
  }
  // proceed...
})
```

**File Upload Security:**
```typescript
// BLOCK: No file type validation
multer({ storage: multer.memoryStorage() })

// CORRECT: Validate file type and size
multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new Error('Only MP4 files allowed'))
    }
    cb(null, true)
  }
})
```

**CORS:**
```typescript
// BLOCK: Wide open
app.use(cors())

// CORRECT: Explicit origins
app.use(cors({
  origin: ['https://recessfitness.com', 'capacitor://localhost'],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}))
```

### 2. Drizzle ORM Issues

**Missing Error Handling:**
```typescript
// WARN: Silent failures
const result = await db.select().from(movements)
res.json(result)

// CORRECT: Handle errors
try {
  const result = await db.select().from(movements)
  res.json(result)
} catch (error) {
  console.error('Database error:', error)
  res.status(500).json({ error: 'Database error' })
}
```

**N+1 Queries:**
```typescript
// BLOCK: N+1 pattern
const workouts = await db.select().from(workouts)
for (const w of workouts) {
  w.exercises = await db.select().from(exercises).where(eq(exercises.workoutId, w.id))
}

// CORRECT: Join or batch
const workoutsWithExercises = await db
  .select()
  .from(workouts)
  .leftJoin(exercises, eq(workouts.id, exercises.workoutId))
```

**Missing Transactions:**
```typescript
// WARN: Multiple writes without transaction
await db.insert(workouts).values(workoutData)
await db.insert(exercises).values(exerciseData)  // If this fails, workout orphaned

// CORRECT: Transaction
await db.transaction(async (tx) => {
  const [workout] = await tx.insert(workouts).values(workoutData).returning()
  await tx.insert(exercises).values(exerciseData.map(e => ({ ...e, workoutId: workout.id })))
})
```

### 3. Express Patterns

**Fat Route Handlers:**
```typescript
// WARN: Business logic in route
app.post('/api/workouts', async (req, res) => {
  // 50+ lines of validation, business logic, database calls
})

// CORRECT: Extract to service
// services/workout.service.js
export async function createWorkout(data) {
  // Business logic here
}

// routes/workouts.js
app.post('/api/workouts', async (req, res) => {
  const workout = await createWorkout(req.body)
  res.json(workout)
})
```

**Missing Async Error Handling:**
```typescript
// BLOCK: Unhandled promise rejection crashes server
app.get('/api/movements', async (req, res) => {
  const data = await db.select().from(movements)  // If this throws, 💥
  res.json(data)
})

// CORRECT: Try-catch or wrapper
app.get('/api/movements', async (req, res, next) => {
  try {
    const data = await db.select().from(movements)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// Or use express-async-errors package
```

**Inconsistent Response Format:**
```typescript
// WARN: Mixed formats
res.json(movements)           // Array
res.json({ data: workout })   // Wrapped object
res.send({ success: true })   // Different shape

// CORRECT: Consistent envelope
res.json({ data: movements, success: true })
res.json({ data: workout, success: true })
res.json({ error: 'Not found', success: false })
```

### 4. R2/S3 Integration

**Missing Upload Error Handling:**
```typescript
// WARN: Assumes upload succeeds
const upload = new Upload({ client, params })
await upload.done()
await db.update(movements).set({ videoUrl })

// CORRECT: Handle upload failure
try {
  await upload.done()
} catch (error) {
  console.error('R2 upload failed:', error)
  return res.status(500).json({ error: 'Upload failed' })
}
// Only update DB after confirmed upload
await db.update(movements).set({ videoUrl })
```

**Hardcoded URLs:**
```typescript
// WARN: Hardcoded R2 URL
const url = `https://pub-abc123.r2.dev/movements/${filename}`

// CORRECT: Environment variable
const url = `${process.env.R2_PUBLIC_URL}/movements/${filename}`
```

### 5. Error Handling

**Generic Errors:**
```typescript
// WARN: Unhelpful error
res.status(500).json({ error: 'Error occurred' })

// CORRECT: Specific, actionable
res.status(400).json({ error: 'movementId must be a positive integer' })
res.status(404).json({ error: 'Movement not found', movementId: id })
res.status(500).json({ error: 'Database connection failed' })
```

**Swallowed Errors:**
```typescript
// BLOCK: Silent failure
try {
  await db.update(movements).set({ videoUrl })
} catch (e) {
  // nothing
}
res.json({ success: true })  // Lies

// CORRECT: Log and respond appropriately
try {
  await db.update(movements).set({ videoUrl })
  res.json({ success: true })
} catch (error) {
  console.error('DB update failed:', error)
  res.status(500).json({ success: false, error: 'Failed to update movement' })
}
```

### 6. TypeScript (if applicable)

```typescript
// BLOCK: any types
function processData(data: any) { ... }

// CORRECT: Proper types
interface MovementInput {
  name: string
  muscleGroup: string
  equipment: string | null
}
function processData(data: MovementInput) { ... }
```

## Review Output Format

```markdown
## Code Review: [PR/Feature Name]

### 🚫 Blockers (Must Fix)
1. [Security/Critical issue] - `file:line` - [Why dangerous]

### ⚠️ Concerns (Should Fix)
1. [Issue] - [Suggestion]

### 💡 Suggestions (Nice to Have)
1. [Improvement idea]

### ✅ Looks Good
- [Positive observations]
```

## Severity Guide

| Severity | Action | Examples |
|----------|--------|----------|
| 🚫 Blocker | Cannot merge | SQL injection, exposed secrets, data loss |
| ⚠️ Concern | Fix before next release | Missing validation, N+1 queries, no error handling |
| 💡 Suggestion | Optional | Naming, minor refactor, documentation |
