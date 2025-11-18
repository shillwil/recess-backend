# # Use the official Node.js runtime as the base image
# FROM node:18-alpine

# # Set the working directory inside the container
# WORKDIR /app

# # Copy package.json and package-lock.json (if available)
# COPY package*.json ./

# # Install dependencies
# RUN npm ci --only=production

# # Copy the rest of the application code
# COPY . .

# # Build the TypeScript application
# RUN npm run build

# # Expose the port the app runs on
# EXPOSE 3000

# # Define the command to run the application
# CMD ["npm", "start"]

# Build stage: Install all deps and compile TypeScript
# FROM node:20-alpine as builder
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci
# COPY . .
# RUN npm run build

# # Runtime stage: Install only production deps and copy built artifacts
# FROM node:20-alpine
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --only=production
# COPY --from=builder /app/dist ./dist
# # COPY --from=builder /app/dist/scripts ./dist/scripts
# COPY drizzle/migrations ./drizzle/migrations
# EXPOSE 3000
# CMD ["node", "dist/index.js"]

# ---- Build stage ----
    FROM node:20-alpine AS builder

    # Create app directory
    WORKDIR /app
    
    # Install dependencies (including devDeps to build TypeScript)
    COPY package*.json ./
    RUN npm ci
    
    # Copy the rest of the source code
    COPY . .
    
    # Build the TypeScript project
    # This will run your "build" script, e.g. `tsc` (and any prebuild hooks like db:generate)
    RUN npm run build
    
    
    
    # ---- Runtime stage ----
    FROM node:20-alpine AS runtime
    
    WORKDIR /app
    
    # Set NODE_ENV for runtime
    ENV NODE_ENV=staging
    
    # Copy only package files and install *prod* dependencies
    COPY package*.json ./
    RUN npm ci --omit=dev
    
    # Copy built JS and migrations from builder stage
    COPY --from=builder /app/dist ./dist
    # If your Drizzle migrations are in ./drizzle or ./drizzle/migrations,
    # copy that folder too so `drizzle-kit migrate` can see them:
    COPY --from=builder /app/drizzle ./drizzle
    
    # Expose your app port (change if not 3000)
    EXPOSE 3000
    
    # IMPORTANT:
    # Railway will inject DATABASE_URL into this container at runtime.
    # We now run migrations, then start the server.
    CMD ["npm", "run", "start:staging"]