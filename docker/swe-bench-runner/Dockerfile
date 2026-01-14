# Use Python 3.9 base image
FROM python:3.9-slim

# Install git and other essentials
RUN apt-get update && apt-get install -y \
    git wget curl jq \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built copilot-cli code
COPY dist /app/dist
COPY docker /app/docker
WORKDIR /app

# Install SWE-bench for evaluation
RUN git clone https://github.com/SWE-bench/SWE-bench.git /swe-bench && \
    cd /swe-bench && \
    pip install -e .

WORKDIR /workspace

CMD ["/bin/bash"]
