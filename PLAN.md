# Phase 1: AI Program Generation — Implementation Plan

## Summary

Build a backend endpoint (`POST /api/ai/generate-program`) that uses Google Gemini 2.5 Flash to generate personalized workout programs based on user preferences, plus supporting endpoints for rating, generation status, and strength profiles.

## Key Architecture Decisions

1. **Reuse existing template & program services** — Extend `createTemplate()` and `createProgram()` to accept `isAiGenerated` and `aiPrompt` fields rather than building parallel services
2. **Pre-filter exercise catalog** by equipment before sending to Gemini — reduces token cost and prevents equipment-mismatch errors
3. **Normalize equipment at API boundary** — map `smith_machine` → `smith machine`; silently ignore `bands`/`kettlebell` if no exercises exist for them
4. **Generated programs are NOT auto-activated** — left for user review

---

## Step 1: Install Dependencies

```bash
npm install @google/generative-ai
```

## Step 2: Database Schema Changes

**File: `src/db/schema.ts`**

### Add columns to `users` table:
- `aiGenerationsThisMonth` (integer, default 0)
- `aiGenerationsResetAt` (timestamp, nullable)
- `subscriptionTier` (varchar(20), default 'free')

### Add columns to `workoutPrograms` table:
- `rating` (integer, nullable) — 1-5 user rating
- `aiModel` (varchar(50), nullable) — e.g. "gemini-2.5-flash"
- `aiGenerationTimeMs` (integer, nullable) — performance tracking

### New table: `userStrengthProfiles`
- `id` (uuid PK)
- `userId` (uuid FK → users, unique, cascade delete)
- `strengthEntries` (jsonb array of strength entry objects)
- `updatedAt`, `createdAt` (timestamps)

### New table: `aiGenerationLogs`
- `id` (uuid PK)
- `userId` (uuid FK → users)
- Request fields: `inspirationSource`, `daysPerWeek`, `sessionDurationMinutes`, `experienceLevel`, `goal`, `equipment` (jsonb), `usedTrainingHistory`, `freeTextPreferences`
- Response fields: `programId` (FK → workoutPrograms), `success`, `errorMessage`, `retryCount`, `generationTimeMs`, `promptTokens`, `completionTokens`
- Feedback fields: `userRating`, `userFeedback`, `personalizationSource`
- `createdAt` (timestamp)
- Indexes on `userId` and `createdAt`

### Run migrations after schema changes:
```bash
npm run db:generate
npm run db:migrate
```

## Step 3: Extend Existing Services

**File: `src/models/template.types.ts`** — Add `isAiGenerated` and `aiPrompt` to `CreateTemplateInput`

**File: `src/services/templateService.ts`** — Update `createTemplate()` to pass `isAiGenerated` and `aiPrompt` through to the insert

**File: `src/models/program.types.ts`** — Add `isAiGenerated`, `aiPrompt`, `aiModel`, `aiGenerationTimeMs` to `CreateProgramInput`

**File: `src/services/programService.ts`** — Update `createProgram()` to pass AI-related fields through to the insert; also update the ownership validation to allow AI service to create templates owned by the user

## Step 4: Create AI Config

**File: `src/config/ai.ts`** (NEW)
- Gemini API key, model name from env vars
- Rate limit constants from env vars (free: 3/mo, paid: 20/mo)
- Max retries (2), request timeout (30s)
- Equipment normalization map (`smith_machine` → `smith machine`)

## Step 5: Create Prompt Template

**File: `src/prompts/programGeneration.ts`** (NEW)
- `buildProgramGenerationPrompt()` function as specified
- Training philosophy guidance for named athletes/styles
- Structured JSON output format specification
- Exercise catalog injection
- Rules for exercise count, equipment constraints, rep ranges, etc.

## Step 6: Create Training History Service

**File: `src/services/trainingHistoryService.ts`** (NEW)
- `getTrainingHistorySummary(userId: string): Promise<string | null>`
- Query last 30 days of workouts from `workouts` + `workoutExercises` + `sets`
- Return `null` if <5 workouts found
- Compute: frequency, top exercises, estimated working weights (major compounds), volume distribution by muscle group, weak points
- Format as ~300 word text block for prompt injection

## Step 7: Create AI Service

**File: `src/services/aiService.ts`** (NEW)

### Core function: `generateProgram(userId, input)`
1. Check monthly rate limit (don't increment yet)
2. Fetch exercise catalog from DB (filtered by user's equipment)
3. Optionally fetch training history or manual strength profile
4. Build Gemini prompt using `buildProgramGenerationPrompt()`
5. Call Gemini 2.5 Flash with structured JSON output
6. Validate response (exercise IDs exist, schema matches, equipment OK, workout count matches)
7. On validation failure: retry up to 2x with error feedback appended to prompt
8. On success:
   - Create templates via existing `templateService.createTemplate()` (one per workout day)
   - Create program via existing `programService.createProgram()` (linking all templates)
   - Increment user's monthly generation counter (only on success)
   - Log to `ai_generation_logs`
9. On final failure: log to `ai_generation_logs`, return 502/503 (do NOT increment counter)

### Validation function: `validateGeneratedProgram()`
- Check structure (programName, workouts array)
- Check workout count matches `daysPerWeek`
- Validate every `exerciseId` exists in catalog
- Validate equipment matches (should be pre-filtered, but double-check)
- Validate numeric ranges (workingSets 1-10, restSeconds 15-600)

### Rate limit function: `checkAiRateLimit(userId)`
- Read user's `aiGenerationsThisMonth` and `aiGenerationsResetAt`
- If reset time passed or never set → reset counter, set next month's 1st
- Check against tier limit (free=3, paid=20)
- Return `{ allowed, remaining, resetsAt, limit }`

### Increment function: `incrementAiGeneration(userId)`
- Only called on successful generation
- Increments `aiGenerationsThisMonth` by 1

## Step 8: Create Strength Profile Service

**File: `src/services/strengthProfileService.ts`** (NEW)
- `upsertStrengthProfile(userId, entries)` — fuzzy-match exercise names to IDs, upsert into `userStrengthProfiles`
- `getStrengthProfile(userId)` — fetch existing profile
- `formatStrengthDataForPrompt(entries)` — convert profile to text for Gemini prompt

## Step 9: Create Route Handlers

**File: `src/routes/ai.ts`** (NEW)

### `POST /api/ai/generate-program`
- Auth required (Firebase)
- Validate request body (all field constraints from spec)
- Call `aiService.generateProgram()`
- Return 201 with program data + generation metadata
- Error responses: 400, 429, 502, 503

### `POST /api/ai/rate-program/:programId`
- Auth required
- Validate program exists, belongs to user, is AI-generated
- Update `rating` on `workoutPrograms`
- Store `userRating` and `userFeedback` on `ai_generation_logs`
- Return 200

### `GET /api/ai/generation-status`
- Auth required
- Return current generation count, limit, remaining, reset date, tier

### `PUT /api/me/strength-profile`
- Auth required
- Validate entries (1-20, valid weights/reps/sets)
- Fuzzy-match exercise names → exercise IDs
- Upsert into `userStrengthProfiles`
- Return matched profile

### `GET /api/me/strength-profile`
- Auth required
- Return profile or 404

## Step 10: Register Routes

**File: `src/index.ts`**
- Import and mount AI routes at `/api/ai`
- Add strength profile routes at `/api/me/strength-profile`

## Step 11: Update Environment Config

**File: `.env.example`** — Add Gemini/AI env vars
**File: `src/config/index.ts`** — Add AI config validation (optional in dev, required in staging/prod)

## Step 12: Testing

Write unit/integration tests:
1. **Validation tests** — request body validation, exercise ID validation, equipment matching
2. **Rate limiting tests** — monthly limit enforcement, counter reset, failed generations not counting
3. **Training history tests** — summary computation, <5 workout threshold
4. **Strength profile tests** — CRUD, fuzzy name matching, exercise resolution
5. **Program generation flow** — mock Gemini, verify template/program creation, retry logic
6. **Error handling tests** — invalid JSON retry, timeout handling, all error response codes

---

## Files Created (7)
| File | Purpose |
|------|---------|
| `src/config/ai.ts` | Gemini API config, rate limits, equipment normalization |
| `src/prompts/programGeneration.ts` | System prompt template + archetype definitions |
| `src/services/aiService.ts` | Gemini client, prompt builder, response validator, retry logic |
| `src/services/trainingHistoryService.ts` | Fetches + summarizes user's recent training data |
| `src/services/strengthProfileService.ts` | Strength profile CRUD + fuzzy matching |
| `src/routes/ai.ts` | Express route handlers for all AI + strength profile endpoints |
| `src/__tests__/ai.test.ts` | Tests for the AI generation flow |

## Files Modified (6)
| File | Change |
|------|--------|
| `src/db/schema.ts` | Add columns to users/workoutPrograms, add userStrengthProfiles + aiGenerationLogs tables |
| `src/models/template.types.ts` | Add `isAiGenerated`, `aiPrompt` to CreateTemplateInput |
| `src/models/program.types.ts` | Add AI fields to CreateProgramInput |
| `src/services/templateService.ts` | Pass `isAiGenerated`/`aiPrompt` through in createTemplate() |
| `src/services/programService.ts` | Pass AI fields through in createProgram() |
| `src/index.ts` | Register `/api/ai` and strength profile routes |
| `package.json` | Add `@google/generative-ai` dependency |
| `.env.example` | Add Gemini/AI env vars |

## Critical Constraints
- Failed generations NEVER count against monthly limit
- Only exercises from the DB catalog are used (pre-filtered by equipment)
- Retry up to 2x on invalid Gemini responses with error feedback
- Log all attempts (success + failure) to `ai_generation_logs`
- Generated programs left inactive — user reviews first
- Equipment normalization: `smith_machine` ↔ `smith machine` at API boundary
- Gemini API key never exposed to client
