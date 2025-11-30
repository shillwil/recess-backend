# Firebase Project Setup Guide

## 🏗️ Project Structure

Create **3 separate Firebase projects** for proper environment isolation:

### 1. Development Project: `recess-dev`
- **Purpose**: Local development and testing
- **Database**: Uses local Docker PostgreSQL
- **Auth**: Firebase Auth for user management
- **Usage**: Your local machine only

### 2. Staging Project: `recess-staging` 
- **Purpose**: Pre-production testing
- **Database**: Hosted PostgreSQL (Railway, Supabase, etc.)
- **Auth**: Firebase Auth (separate user base)
- **Usage**: Testing deployments before production

### 3. Production Project: `recess-production`
- **Purpose**: Live application
- **Database**: Production PostgreSQL
- **Auth**: Firebase Auth (real users)
- **Usage**: End users

## 🔧 Setup Steps

### Step 1: Create Firebase Projects

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create three projects:
   - `recess-dev`
   - `recess-staging` 
   - `recess-production`

### Step 2: Enable Authentication

For each project:
1. Go to **Authentication** → **Sign-in method**
2. Enable desired providers:
   - Email/Password
   - Google (recommended)
   - Apple (for iOS)
   - Anonymous (for guest users)

### Step 3: Generate Service Account Keys

For each project:
1. Go to **Project Settings** → **Service Accounts**
2. Click **Generate new private key**
3. Download the JSON file
4. Convert to base64:
   ```bash
   cat serviceAccountKey.json | base64
   ```
5. Add to respective `.env` file

### Step 4: Configure Environment Files

Create environment files for each environment:

#### `.env.development` (Local)
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/recess_development"
FIREBASE_SERVICE_ACCOUNT_BASE64="[dev-project-base64]"
NODE_ENV=development
PORT=3000
```

#### `.env.staging` (Staging Server)
```bash
DATABASE_URL="[staging-database-url]"
FIREBASE_SERVICE_ACCOUNT_BASE64="[staging-project-base64]"
NODE_ENV=staging
PORT=3000
```

#### `.env.production` (Production Server)
```bash
DATABASE_URL="[production-database-url]"
FIREBASE_SERVICE_ACCOUNT_BASE64="[production-project-base64]"
NODE_ENV=production
PORT=3000
```

## 🔐 Security Best Practices

1. **Never commit** `.env` files to git
2. **Use environment variables** in deployment platforms
3. **Rotate keys** regularly
4. **Restrict service account permissions** to minimum required
5. **Use different Firebase projects** for each environment
6. **Monitor Firebase usage** in console

## 📱 Mobile App Configuration

### iOS (Nippardation Integration)
1. Download `GoogleService-Info.plist` for each environment
2. Use different bundle IDs:
   - `com.recess.dev` (development)
   - `com.recess.staging` (staging)
   - `com.recess.app` (production)

### Build Configurations
Create different build schemes in Xcode:
- **Debug**: Uses dev Firebase project
- **Staging**: Uses staging Firebase project  
- **Release**: Uses production Firebase project

## 🧪 Testing Strategy

### Development
- Test with local Docker database
- Use dev Firebase for auth
- Mock external services

### Staging  
- Test with staging database
- Use staging Firebase
- Real external service integrations
- Automated testing pipeline

### Production
- Real users and data
- Production Firebase
- Full monitoring and alerting

## 🚀 Deployment Flow

```
Local Development → Staging → Production
     ↓               ↓           ↓
  recess-dev    recess-staging  recess-production
     ↓               ↓           ↓
 Local Docker   Hosted DB     Production DB
```

## 📋 Checklist

- [ ] Create 3 Firebase projects
- [ ] Enable Authentication in all projects
- [ ] Generate service account keys
- [ ] Set up environment files
- [ ] Configure mobile app builds
- [ ] Test authentication flow
- [ ] Set up monitoring and alerts