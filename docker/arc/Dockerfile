# ARC-AGI-2 Evaluation Environment
# Provides a Python environment for executing grid transformation tasks

FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/workspace

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# Install Python dependencies for ARC tasks
RUN pip install \
    numpy \
    scipy \
    matplotlib \
    requests \
    tqdm

# Create working directory
WORKDIR /workspace

# Create a non-root user for security
RUN useradd -m -s /bin/bash benchmark && \
    chown -R benchmark:benchmark /workspace

# Switch to non-root user
USER benchmark

# Default command: sleep (will be overridden when running tasks)
CMD ["/bin/bash"]
