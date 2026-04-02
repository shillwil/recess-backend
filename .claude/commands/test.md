---
name: test
description: Test suite validation and maintenance for recess-backend. Use when tests fail, when new endpoints need coverage, when Drizzle schema changes break tests, or when verifying test integrity. Node.js/Express with PostgreSQL/Drizzle ORM. Triggers on /test command or test failures.
---

# Test Validation - recess-backend

## Stack Context
- Runtime: Node.js/Express
- Database: PostgreSQL with Drizzle ORM
- Deployment: Railway
- Test runner: Jest or Vitest

## Workflow

### 1. Run Tests & Capture Failures

```bash
# Full suite
npm test

# Verbose output
npm test -- --verbose

# Single file
npm test -- routes/videos.test.js

# Watch mode for iteration
npm test -- --watch
```

### 2. Diagnose Root Cause

Before touching any test, determine:

**Is the code broken?**
```bash
git diff HEAD~3 -- src/ routes/ services/
```
- Check if recent changes broke expected behavior
- Verify the test's expectation matches requirements
- If code is broken → fix the code, not the test

**Is the test outdated?**
- Drizzle schema changed (new columns, renamed fields)
- API response shape changed
- Route path changed
- If test is outdated → update the test

**Is it environment/flaky?**
- Database connection issues
- Port conflicts
- Missing env vars
- Race conditions in async tests

### 3. Common Failure Patterns

#### Drizzle Schema Changes

```typescript
// Schema added new field
// Before
expect(movement).toEqual({
  id: 1,
  name: 'Bench Press',
  muscleGroup: 'chest'
})

// After: schema added videoUrl, thumbnailUrl
expect(movement).toMatchObject({
  id: 1,
  name: 'Bench Press',
  muscleGroup: 'chest'
})
// Or update to include new fields explicitly
```

#### API Response Shape Changes

```typescript
// Before: flat response
expect(res.body.name).toBe('Push Day')

// After: wrapped in data object
expect(res.body.data.name).toBe('Push Day')

// After: added metadata
expect(res.body).toMatchObject({
  data: { name: 'Push Day' },
  success: true
})
```

#### Route Changes

```typescript
// Before
const res = await request(app).get('/movements/1')

// After: API prefix added
const res = await request(app).get('/api/movements/1')
```

#### Database Test Isolation

```typescript
// PROBLEM: Tests pollute each other
beforeAll(async () => {
  await db.insert(movements).values(testData)
})

// BETTER: Clean state per test
beforeEach(async () => {
  await db.delete(movements)
  await db.insert(movements).values(testData)
})

afterAll(async () => {
  await db.delete(movements)
})
```

### 4. Test Structure for Express/Drizzle

```typescript
import request from 'supertest'
import { app } from '../app'
import { db } from '../db'
import { movements } from '../schema'

describe('GET /api/movements', () => {
  const testMovement = {
    id: 1,
    name: 'Test Exercise',
    muscleGroup: 'chest',
    equipment: 'barbell',
    videoUrl: null,
    thumbnailUrl: null
  }

  beforeEach(async () => {
    await db.delete(movements)
    await db.insert(movements).values(testMovement)
  })

  afterAll(async () => {
    await db.delete(movements)
  })

  it('returns all movements', async () => {
    const res = await request(app)
      .get('/api/movements')
      .expect(200)

    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      name: 'Test Exercise',
      muscleGroup: 'chest'
    })
  })

  it('returns 404 for missing movement', async () => {
    await request(app)
      .get('/api/movements/999')
      .expect(404)
  })
})
```

### 5. Mocking External Services

#### R2/S3 Upload Mocking

```typescript
import { mockClient } from 'aws-sdk-client-mock'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3Mock = mockClient(S3Client)

beforeEach(() => {
  s3Mock.reset()
  s3Mock.on(PutObjectCommand).resolves({
    ETag: '"mock-etag"'
  })
})

it('uploads video to R2', async () => {
  const res = await request(app)
    .post('/api/videos/upload')
    .attach('video', Buffer.from('fake-video'), 'test.mp4')
    .field('movementId', '1')
    .expect(200)

  expect(res.body.success).toBe(true)
  expect(s3Mock.calls()).toHaveLength(1)
})
```

### 6. Verification

After updates:
```bash
# Run affected tests
npm test -- --testPathPattern="movements|videos"

# Full suite
npm test

# Check coverage
npm test -- --coverage
```

Confirm:
- [ ] Previously failing tests pass
- [ ] No new failures
- [ ] Assertions match current API contract

## Anti-Patterns

- **Don't delete failing tests without understanding why**
- **Don't weaken assertions** (`toMatchObject` when you meant `toEqual`)
- **Don't skip database cleanup** - tests must be isolated
- **Don't forget async/await** - leads to false passes
- **Don't mock the database in integration tests** - use test DB

## Quick Reference

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Property undefined | Schema/response changed | Update test expectations |
| 404 unexpected | Route path changed | Check route registration |
| Connection refused | DB not running | Start PostgreSQL |
| Timeout | Missing await | Add await to async calls |
| Flaky pass/fail | Test isolation issue | Add proper beforeEach cleanup |
