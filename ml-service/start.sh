#!/usr/bin/env bash
# Production start script for Render
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
