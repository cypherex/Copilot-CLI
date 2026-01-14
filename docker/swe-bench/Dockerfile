# SWE-bench Evaluation Environment
# Provides a reproducible environment for running SWE-bench benchmark tasks

FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    wget \
    bash \
    jq \
    patch \
    ca-certificates \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# Install conda for environment management
RUN curl -sSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o miniconda.sh && \
    bash miniconda.sh -b -p /opt/conda && \
    rm miniconda.sh && \
    /opt/conda/bin/conda clean -afy

ENV PATH="/opt/conda/bin:$PATH"

# Initialize conda
RUN conda init bash

# Install common Python tools and test dependencies via pip
RUN pip install \
    pytest \
    pytest-xdist \
    pytest-django \
    black \
    flake8 \
    mypy \
    requests \
    asgiref \
    sqlparse \
    tzlocal \
    pytz \
    python-dateutil \
    six \
    toml \
    tomli \
    tomli-w \
    typing-extensions

# Create working directory for tasks
WORKDIR /workspace

# Create symlink for python if not already present
RUN ln -sf /usr/bin/python3 /usr/bin/python || true

# Default command: sleep (will be overridden when running tasks)
CMD ["/bin/bash"]
