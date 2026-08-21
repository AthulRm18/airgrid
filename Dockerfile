# ---------------------------------------------------------------------------
# CONFLUX Fullstack Multi-Stage Container (Google Cloud Run / Render / Docker)
# ---------------------------------------------------------------------------

# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI runtime
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies (libgomp1 is required by LightGBM)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application code
COPY backend/ ./backend/

# Copy built frontend distribution from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Set working directory to backend
WORKDIR /app/backend

# Default port for Cloud Run and Render
ENV PORT=8000
EXPOSE 8000

# Start Uvicorn
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
