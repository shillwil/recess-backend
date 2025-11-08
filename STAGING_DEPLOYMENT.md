# Staging Deployment Guide

## 🎯 Purpose
Deploy to a hosted staging environment that mirrors production setup for:
- Testing Firebase auth integration
- Validating database operations
- Performance testing
- Mobile app integration testing

## 🏗️ Recommended Hosting Platforms

### Option 1: Railway (Recommended)
**Pros**: Easy PostgreSQL + Node.js, automatic deployments
**Pricing**: Free tier available

### Option 2: Vercel + Supabase
**Pros**: Excellent for serverless, built-in PostgreSQL
**Pricing**: Free tiers available

### Option 3: Render
**Pros**: Simple setup, good free tier
**Pricing**: Free tier available

## 🚀 Railway Setup (Recommended)

### 1. Setup Railway Project
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and create project
railway login
railway init recess-backend-staging
```

### 2. Add PostgreSQL Database
1. Go to Railway dashboard
2. Add **PostgreSQL** service
3. Note the connection string

### 3. Configure Environment Variables
In Railway dashboard, add:
```
NODE_ENV=staging
DATABASE_URL=[railway-postgres-url]
FIREBASE_SERVICE_ACCOUNT_BASE64=[staging-firebase-base64]
PORT=3000
```

### 4. Deploy
```bash
# Connect to Railway project
railway link

# Deploy
railway up
```

## 🔧 Manual Deployment Process

### 1. Create Staging Branch
```bash
git checkout -b staging
git push origin staging
```

### 2. Test Locally First
```bash
# Use staging environment locally
cp .env.staging .env.local
npm run dev

# Verify everything works
```

### 3. Deploy to Hosting Platform
```bash
# Push to staging branch
git push origin staging

# Platform-specific deployment commands
```

### 4. Run Database Migrations
```bash
# Set staging DATABASE_URL
export DATABASE_URL="[staging-database-url]"

# Run migrations
npm run db:migrate
```

## 📋 Pre-Deployment Checklist

### Code Quality
- [ ] All tests pass locally
- [ ] TypeScript compiles without errors
- [ ] Linting passes
- [ ] Build succeeds

### Configuration
- [ ] Staging Firebase project created
- [ ] Environment variables configured
- [ ] Database connection tested
- [ ] Migrations applied

### Security
- [ ] No credentials in code
- [ ] Environment variables set correctly
- [ ] CORS configured for staging domain
- [ ] Rate limiting enabled

## 🧪 Staging Testing Process

### 1. Backend API Testing
```bash
# Test health endpoint
curl https://your-staging-url.com/health

# Test auth endpoints
curl -X POST https://your-staging-url.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"idToken": "firebase-id-token"}'
```

### 2. Database Testing
- User creation/authentication
- Workout data CRUD operations
- Data synchronization
- Migration rollbacks

### 3. Mobile App Integration
- Update mobile app config to point to staging
- Test authentication flow
- Test data sync
- Test offline/online scenarios

## 🔄 Update Process

### Regular Updates
```bash
# Development → Staging
git checkout staging
git merge development
git push origin staging

# Deploy automatically triggers (if configured)
```

### Hotfixes
```bash
# Create hotfix branch
git checkout -b hotfix/urgent-fix staging
# Make fixes
git commit -m "hotfix: urgent fix description"
git push origin hotfix/urgent-fix

# Merge to staging and production
```

## 📊 Monitoring

### Health Checks
Set up monitoring for:
- API response times
- Database connection status
- Authentication success rates
- Error rates

### Logging
Configure structured logging:
```javascript
// Example logging setup
console.log({
  level: 'info',
  message: 'User authenticated',
  userId: user.id,
  timestamp: new Date().toISOString(),
  environment: 'staging'
});
```

## 🚨 Troubleshooting

### Common Issues

#### Database Connection Fails
1. Check DATABASE_URL format
2. Verify database is running
3. Check firewall/security groups
4. Test connection string locally

#### Firebase Auth Errors
1. Verify service account key
2. Check Firebase project settings
3. Validate base64 encoding
4. Test with Firebase CLI

#### Deployment Failures
1. Check build logs
2. Verify environment variables
3. Check Node.js version compatibility
4. Review platform-specific requirements

### Debug Commands
```bash
# Check environment variables
printenv | grep -E "(DATABASE|FIREBASE|NODE_ENV)"

# Test database connection
npm run db:studio

# Check application logs
railway logs  # or platform-specific command
```

## 📈 Performance Testing

### Load Testing
```bash
# Install artillery for load testing
npm install -g artillery

# Create load test config
cat > load-test.yml << EOF
config:
  target: 'https://your-staging-url.com'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "API Health Check"
    requests:
      - get:
          url: "/health"
EOF

# Run load test
artillery run load-test.yml
```

### Database Performance
- Monitor query execution times
- Check for slow queries
- Verify proper indexing
- Test with realistic data volumes

## 🔐 Security Testing

### Authentication Testing
- Test invalid tokens
- Test expired tokens
- Test malformed requests
- Verify proper error handling

### Input Validation
- Test SQL injection attempts
- Test XSS attempts
- Test malformed JSON
- Test oversized requests

## ✅ Staging Sign-off Criteria

Before promoting to production:
- [ ] All API endpoints functional
- [ ] Authentication flow works end-to-end
- [ ] Database operations perform adequately
- [ ] Mobile app integration successful
- [ ] Security testing passed
- [ ] Performance meets requirements
- [ ] Error handling works correctly
- [ ] Monitoring and logging operational