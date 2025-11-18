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
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: Install only production deps and copy built artifacts
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist/scripts ./dist/scripts
COPY drizzle/migrations ./drizzle/migrations
EXPOSE 3000
CMD ["node", "dist/index.js"]