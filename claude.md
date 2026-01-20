# CLAUDE.md - Recess Backend

> This file provides context for Claude Code to understand the Recess backend project. Update this file as the project evolves.

## Project Overview

**Recess** is a fitness tracking startup application. This repository contains the backend REST API that powers the iOS mobile app (Swift/Core Data), with plans for an Android (Kotlin) client in the future.

**Core Functionality:**
- User authentication via Firebase
- Workout tracking (exercises, sets, reps, weight, RPE)
- Multi-device synchronization with conflict resolution
- Personal records tracking
- Workout templates and multi-week programs
- Social features (following, public templates)
- Competitions

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js with TypeScript |
| Framework | Express.js |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Authentication | Firebase Admin SDK |
| Build | esbuild, tsc |
| Testing | Jest with ts-jest |

## Project Structure

```
src/
├── index.ts              # Express app entry point, route definitions
├── config/               # Environment configuration & validation
├── db/
│   ├── index.ts          # Database connection (direct & proxy modes)
│   └── schema.ts         # Drizzle ORM schema (25+ tables)
├── middleware/
│   └── auth.ts           # Firebase JWT verification middleware
├── services/
│   ├── firebase.ts       # Firebase Admin SDK initialization
│   ├── userService.ts    # User CRUD operations
│   └── syncService.ts    # Multi-device sync & conflict resolution
└── models/
    └── index.ts          # TypeScript interfaces
```

## Architecture

This project follows a **service-based layered architecture**:

```
Routes (index.ts) → Middleware (auth) → Services → Database (Drizzle)
```

- **Routes**: Define API endpoints, handle HTTP request/response
- **Middleware**: Authentication, validation, error handling
- **Services**: Business logic, data transformation
- **Database**: Drizzle ORM queries, transactions

## Protected Files - CONFIRM BEFORE MODIFYING

**Always ask for confirmation before modifying these files:**

1. **`src/db/schema.ts`** - Database schema changes require migrations and can break production data
2. **`drizzle/migrations/*`** - Never manually edit migration files
3. **`.env*` files** - Environment configuration
4. **`src/config/index.ts`** - Configuration validation
5. **`drizzle.config.ts`** - Drizzle Kit configuration

**When schema changes are needed:**
1. Discuss the change first
2. Modify `schema.ts` only after approval
3. Generate migration with `npm run db:generate`
4. Review generated migration before applying

## Code Style & Conventions

**Follow existing patterns in the codebase:**

- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **Files**: kebab-case for file names (e.g., `user-service.ts`)
- **Async/Await**: Prefer async/await over raw Promises
- **Error Handling**: Balanced approach - validate at API boundaries, trust internal code
- **Types**: Use Drizzle's inferred types where possible (`typeof users.$inferSelect`)

**API Response Patterns:**
```typescript
// Success
res.json({ user: userData });

// Error
res.status(400).json({ error: 'Descriptive error message' });
```

## Testing Requirements

**All new features and bug fixes must include tests.**

- Test files: `*.test.ts` alongside source files or in `__tests__/` directories
- Framework: Jest with ts-jest
- Run tests: `npm test`

**What to test:**
- Service functions (unit tests)
- API endpoints (integration tests)
- Edge cases and error conditions

## Common Commands

```bash
# Development
npm run dev              # Start with hot reload (nodemon)

# Build & Production
npm run build            # Compile TypeScript
npm run start            # Run compiled JS
npm run start:staging    # Run with migrations for staging
npm run start:prod       # Run with migrations for production

# Database
npm run db:generate      # Generate new migration from schema changes
npm run db:migrate       # Apply pending migrations
npm run db:seed          # Seed exercises table with predefined exercises

# Docker
docker-compose up -d     # Start PostgreSQL + backend
docker-compose down      # Stop services
```

## Local Development with Docker

**Prerequisites:** Docker and Docker Compose installed

### Quick Start

```bash
# 1. Start PostgreSQL container
docker start recess_postgres_dev || docker-compose up -d postgres

# 2. Install dependencies (if not already done)
npm install

# 3. Run migrations
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_dev" npm run db:migrate

# 4. Seed the exercises table (optional, for exercise data)
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_dev" npm run db:seed

# 5. Start the development server
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_dev" npm run dev
```

### Database Connection Details

| Property | Value |
|----------|-------|
| Host | `localhost` |
| Port | `5432` |
| Database | `recess_dev` |
| User | `postgres` |
| Password | `password` |
| Full URL | `postgresql://postgres:password@localhost:5432/recess_dev` |

### Troubleshooting Docker

**Container name conflict:**
```bash
# If you see "container name already in use" error
docker start recess_postgres_dev  # Try starting existing container first
# Or remove and recreate
docker rm recess_postgres_dev && docker-compose up -d postgres
```

**Check if PostgreSQL is running:**
```bash
docker ps | grep recess_postgres
```

**View PostgreSQL logs:**
```bash
docker logs recess_postgres_dev
```

**Reset database (delete all data):**
```bash
docker-compose down -v  # -v removes volumes
docker-compose up -d postgres
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_dev" npm run db:migrate
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_dev" npm run db:seed
```

## API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/health` | No | Health check |
| POST | `/api/auth/login` | Firebase Token | Login/register user |
| GET | `/api/me` | Yes | Get current user profile |
| PUT | `/api/me` | Yes | Update user profile |
| POST | `/api/sync` | Yes | Sync workout data from mobile |

## Database Schema Overview

**Core Entities:**
- `users` - User accounts and profiles
- `exercises` - Exercise library (predefined + custom)
- `workouts` - Individual workout sessions
- `workoutExercises` - Exercises performed in a workout
- `sets` - Individual sets with reps/weight/RPE
- `workoutTemplates` - Reusable workout plans
- `personalRecords` - PRs (1RM, 3RM, 5RM, etc.)

**Sync Infrastructure:**
- `syncMetadata` - Per-user sync tracking
- `userDevices` - Device registry for multi-device support
- `syncConflictLog` - Conflict resolution history

**Social:**
- `userFollows` - Following relationships
- `templateLikes` - Liked workout templates
- `competitions` - Fitness competitions

## Sync System

The sync service (`src/services/syncService.ts`) handles bidirectional data sync with iOS Core Data. Key concepts:

- **clientId**: UUID from iOS Core Data, maps to PostgreSQL records
- **Conflict Resolution**: Timestamp-based (newer wins), with 5-second threshold
- **Device Tracking**: Each device is registered in `userDevices`

**When modifying sync logic:**
- Preserve `clientId` mapping behavior
- Maintain backward compatibility with existing iOS clients
- Test with multiple devices scenario

## Environment Configuration

Required variables (see `.env.example`):
- `DATABASE_URL` - PostgreSQL connection string
- `FIREBASE_SERVICE_ACCOUNT_BASE64` - Base64-encoded Firebase credentials
- `NODE_ENV` - development | staging | production
- `PORT` - Server port (default: 3000)

## Planned Features (Consider in Architecture Decisions)

When making architectural decisions, keep these planned features in mind:

1. **AI Workout Generation** - OpenAI/LLM integration for personalized workout plans
2. **Payments/Subscriptions** - Stripe integration for premium features
3. **Social Features Expansion** - Enhanced community functionality
4. **Android Client** - Kotlin native app (same API contract as iOS)

## Do's and Don'ts

### DO:
- Write tests for all new code
- Use TypeScript strict types
- Follow existing code patterns
- Validate input at API boundaries
- Use Drizzle's type-safe query builders
- Keep services focused and single-purpose
- Handle Firebase auth errors gracefully

### DON'T:
- Modify `schema.ts` without confirmation
- Write raw SQL (use Drizzle ORM)
- Bypass authentication middleware
- Store secrets in code
- Make breaking API changes without versioning
- Ignore TypeScript errors
- Skip error handling on external service calls
- Add "Co-Authored-By" lines to git commits

## Troubleshooting

**Database connection issues:**
- Check `DATABASE_URL` format
- For Railway: ensure `DATABASE_PROXY` is set if using proxy mode
- Local dev: ensure Docker PostgreSQL is running

**Firebase auth failures:**
- Verify `FIREBASE_SERVICE_ACCOUNT_BASE64` is correctly encoded
- Check Firebase project configuration
- In development, Firebase is optional

**Migration issues:**
- Never manually edit files in `drizzle/migrations/`
- If stuck, check `drizzle/meta/_journal.json` for state
- Use `db:generate` to create new migrations, not manual edits
