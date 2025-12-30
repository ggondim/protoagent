# ===================================
# Stage 1: Builder (Dependencies)
# ===================================
FROM oven/bun:1-debian AS builder

WORKDIR /build

# Install build dependencies for whisper.cpp and other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswresample-dev \
    python3 \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lock* ./

# Install all dependencies (including devDependencies)
RUN bun install --frozen-lockfile

# Compile whisper.cpp manually (required for audio transcription)
RUN cd node_modules/whisper-node/lib/whisper.cpp && \
    make main && \
    ls -la main

# Download Whisper AI models (base model ~141MB)
RUN cd node_modules/whisper-node/lib/whisper.cpp && \
    mkdir -p models && \
    wget -q --show-progress -O models/ggml-base.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin && \
    ls -lh models/ggml-base.bin

# Copy source code
COPY . .

# ===================================
# Stage 2: Production Runtime
# ===================================
FROM oven/bun:1-debian

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    dumb-init \
    curl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js v22 (required by Copilot CLI)
# Using NodeSource repository for latest Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install GitHub Copilot CLI (official package)
# Docs: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
# Note: Copilot requires Node.js v22+, platform-specific binaries, and glibc
RUN ARCH=$(node -p 'process.arch') && \
    npm install -g @github/copilot @github/copilot-linux-${ARCH} && \
    npm cache clean --force

# Create non-root user
RUN groupadd -g 1001 protoagente && \
    useradd -u 1001 -g protoagente -s /bin/bash -m protoagente

WORKDIR /app

# Copy built dependencies from builder
COPY --from=builder --chown=protoagente:protoagente /build/node_modules ./node_modules
COPY --chown=protoagente:protoagente . .

# Create necessary directories with correct permissions
RUN mkdir -p data logs data/temp && \
    chown -R protoagente:protoagente data logs

# Switch to non-root user
USER protoagente

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun run src/healthcheck.ts || exit 1

# Use dumb-init to handle signals properly (ensures SIGTERM reaches the app)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["bun", "run", "src/index.ts"]
