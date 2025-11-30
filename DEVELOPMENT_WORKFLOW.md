# Development Workflow Guide

## 🌊 Branch Strategy

```
main (production)
├── staging 
└── development
    ├── feature/firebase-auth-integration
    ├── feature/user-sync-endpoint
    └── feature/workout-tracking-api
```

### Branch Purposes
- **`main`**: Production-ready code only
- **`staging`**: Pre-production testing 
- **`development`**: Integration branch for features
- **`feature/*`**: Individual feature development

## 🚀 Development Workflow

### 1. Local Development Setup

```bash
# Clone repository and navigate to project directory
git clone <repo-url>
cd recess-backend

# Install all Node.js dependencies defined in package.json
# This includes drizzle-orm, express, firebase-admin, and dev tools
npm install

# Create your local environment file from the template
# This prevents accidentally committing real credentials
# You'll need to fill in actual Firebase credentials after copying
cp .env.example .env.development

# Start PostgreSQL database in Docker container
# The -d flag runs it in detached mode (background)
# This creates the database with proper user/password from docker-compose.yml
docker-compose up postgres -d

# Apply database schema to create all tables, indexes, and relationships
# This reads the migrations from drizzle/migrations/ and applies them
# Wait a few seconds after starting postgres to ensure it's ready
npm run db:migrate

# Start the development server with hot reload
# This uses tsx to watch TypeScript files and restart on changes
# Server will be available at http://localhost:3000
npm run dev
```

### 2. Feature Development Process

```bash
# Switch to development branch (the integration branch for all features)
# This ensures you're starting from the latest stable development code
git checkout development

# Pull latest changes from remote to avoid conflicts
# Always do this before creating a new feature branch
git pull origin development

# Create a new feature branch with descriptive name
# Use feature/ prefix for consistency and organization
git checkout -b feature/user-authentication

# Make your code changes and test thoroughly locally
# - Write code following project conventions
# - Test manually with local database and Firebase
# - Ensure TypeScript compiles without errors
# ... development work ...

# Stage all changed files for commit
# Review what you're committing with 'git diff --staged'
git add .

# Commit with semantic commit message following conventional commits
# Include type (feat/fix/docs/etc), scope, and clear description
# Body should explain what and why, not how
git commit -m "feat: implement Firebase user authentication middleware

- Add Firebase admin SDK integration
- Create auth middleware for protected routes
- Add user creation/sync functionality
- Include comprehensive error handling"

# Push your feature branch to remote repository
# This makes it available for pull request creation
git push origin feature/user-authentication

# Create Pull Request through GitHub/GitLab interface
# Target: development branch (not main)
# Include testing notes and screenshots if applicable
```

### 3. Testing Before Commits

```bash
# Check code style and catch common errors
# ESLint will flag syntax errors, unused variables, and style violations
# Fix any issues before committing to maintain code quality
npm run lint

# Verify TypeScript compilation without emitting files
# Catches type errors, missing imports, and interface mismatches
# Essential for catching runtime errors early
npm run typecheck

# Run automated test suite (unit and integration tests)
# Ensures your changes don't break existing functionality
# Add tests for new features before committing
npm test

# Compile TypeScript to JavaScript and verify build succeeds
# This simulates the production build process
# Catches import/export issues and build configuration problems
npm run build

# Open Drizzle Studio to test database operations manually
# Visual interface to verify schema changes and test queries
# Useful for validating migrations and data integrity
npm run db:studio  # Opens browser at http://localhost:3000/drizzle

# Test your specific feature functionality manually
# - API endpoints with curl or Postman
# - Database operations through the app
# - Firebase authentication flow
# - Error handling scenarios
```

## 🏗️ Environment Management

### Local Development (.env.development)
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_development"
FIREBASE_SERVICE_ACCOUNT_BASE64="[dev-firebase-base64]"
NODE_ENV=development
LOG_LEVEL=debug
```

### Staging (.env.staging)
```bash
DATABASE_URL="[staging-database-url]"
FIREBASE_SERVICE_ACCOUNT_BASE64="[staging-firebase-base64]"
NODE_ENV=staging
LOG_LEVEL=info
```

### Production (Environment Variables)
- Set in deployment platform (Vercel, Railway, etc.)
- Never commit production credentials

## 📋 Commit Guidelines

### Commit Message Format
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Formatting, missing semicolons, etc.
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **test**: Adding missing tests
- **chore**: Changes to build process or auxiliary tools

### Examples
```bash
feat(auth): implement Firebase user authentication
fix(db): resolve connection timeout in production
docs(api): add endpoint documentation for user routes
refactor(models): simplify user interface structure
```

## 🔄 Pull Request Process

### 1. Before Creating PR
- [ ] Code passes linting (`npm run lint`)
- [ ] Types are correct (`npm run typecheck`)
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Feature tested locally
- [ ] Documentation updated

### 2. PR Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Local testing completed
- [ ] Manual testing steps documented
- [ ] Automated tests added/updated

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings/errors
```

### 3. Review Process
1. **Development** → Code review required
2. **Staging** → Integration testing + review
3. **Main** → Production deployment review

## 🚀 Deployment Pipeline

### Development to Staging
```bash
# After PR merged to development
git checkout staging
git pull origin staging
git merge development
git push origin staging

# Staging auto-deploys (if configured)
```

### Staging to Production
```bash
# After staging testing complete
git checkout main
git pull origin main
git merge staging
git tag v1.0.0  # Semantic versioning
git push origin main --tags

# Production deployment (manual or automated)
```

## 🧪 Testing Strategy

### 1. Local Testing
- Unit tests for individual functions
- Integration tests for API endpoints
- Database connection tests
- Firebase auth flow tests

### 2. Staging Testing
- Full API endpoint testing
- Database migration testing
- Performance testing
- Security testing
- Mobile app integration testing

### 3. Production Monitoring
- Error tracking (Sentry)
- Performance monitoring
- Database health checks
- API response time monitoring

## 📊 Database Management

### Migrations
```bash
# Generate new migration file from schema changes
# Compares current schema.ts with database state and creates SQL
# Always run this after modifying src/db/schema.ts
npm run db:generate

# Apply pending migrations to database
# Executes SQL files in drizzle/migrations/ folder in order
# Creates tables, indexes, and relationships defined in schema
npm run db:migrate

# Open Drizzle Studio - visual database browser
# Provides GUI to view tables, run queries, and inspect data
# Useful for debugging and manual testing
npm run db:studio

# Drop all tables and reset database (DESTRUCTIVE - development only)
# Use when you need to start fresh or fix corrupted migrations
# Never run this on staging or production!
npm run db:drop
```

### Schema Changes
1. Update `src/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Test migration locally
4. Commit schema + migration files
5. Apply to staging after PR merge
6. Apply to production after staging verification

## 🔒 Security Checklist

### Before Each Commit
- [ ] No credentials in code
- [ ] `.env` files not committed
- [ ] Sensitive data properly handled
- [ ] Input validation implemented
- [ ] Error messages don't leak info

### Before Deployment
- [ ] Environment variables configured
- [ ] Database access restricted
- [ ] API rate limiting enabled
- [ ] CORS properly configured
- [ ] HTTPS enforced

## 🚨 Emergency Procedures

### Rollback Process
```bash
# Quick rollback to previous version
git checkout main
git revert HEAD
git push origin main

# Or rollback to specific commit
git reset --hard <commit-hash>
git push --force-with-lease origin main
```

### Database Issues
```bash
# Rollback migration
npm run db:drop  # Development only
npm run db:migrate

# Production: Manual rollback script
```

## 📈 Performance Monitoring

### Key Metrics
- API response times
- Database query performance
- Memory usage
- Error rates
- User authentication success rates

### Tools
- Database: Built-in PostgreSQL monitoring
- API: Application logs + monitoring service
- Errors: Error tracking service
- Performance: APM tools