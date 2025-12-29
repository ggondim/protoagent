#!/bin/bash

# Setup script for Protoagente
# Installs all dependencies automatically - non-interactive

set -e  # Exit on error

echo "🚀 Configurando Protoagente..."
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( dirname "$SCRIPT_DIR" )"

cd "$PROJECT_DIR"

# Detect package manager
install_package() {
    local package="$1"
    echo "📦 Instalando $package..."
    
    if command -v apt &> /dev/null; then
        sudo apt update -qq && sudo apt install -y "$package"
    elif command -v brew &> /dev/null; then
        brew install "$package"
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y "$package"
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm "$package"
    else
        echo "❌ Gerenciador de pacotes não suportado. Instale '$package' manualmente."
        exit 1
    fi
}

# Install Bun if not present
if ! command -v bun &> /dev/null; then
    echo "📦 Instalando Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi
echo "✅ Bun"

# Install build dependencies for whisper.cpp
if ! command -v make &> /dev/null || ! (command -v g++ &> /dev/null || command -v clang++ &> /dev/null); then
    echo "📦 Instalando ferramentas de compilação..."
    if command -v apt &> /dev/null; then
        sudo apt update -qq && sudo apt install -y build-essential
    elif command -v brew &> /dev/null; then
        xcode-select --install 2>/dev/null || true
    elif command -v dnf &> /dev/null; then
        sudo dnf groupinstall -y "Development Tools"
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm base-devel
    fi
fi
echo "✅ Build tools (make, g++)"

# Install FFmpeg (required for audio conversion)
if ! command -v ffmpeg &> /dev/null; then
    install_package ffmpeg
fi
echo "✅ FFmpeg"

# Install Node/Bun dependencies
echo ""
echo "📦 Instalando dependências do projeto..."
bun install

# Build whisper.cpp
WHISPER_CPP_DIR="$PROJECT_DIR/node_modules/whisper-node/lib/whisper.cpp"

if [ -d "$WHISPER_CPP_DIR" ]; then
    NEEDS_REBUILD=false
    
    # Check if main binary exists
    if [ ! -f "$WHISPER_CPP_DIR/main" ]; then
        NEEDS_REBUILD=true
        echo "🔨 Binário whisper.cpp não encontrado"
    else
        # Check if binary is compatible with current architecture
        CURRENT_ARCH=$(uname -m)
        BINARY_ARCH=""
        
        if command -v file &> /dev/null; then
            FILE_OUTPUT=$(file "$WHISPER_CPP_DIR/main")
            
            # Detect binary architecture
            if [[ "$FILE_OUTPUT" == *"x86-64"* ]] || [[ "$FILE_OUTPUT" == *"x86_64"* ]]; then
                BINARY_ARCH="x86_64"
            elif [[ "$FILE_OUTPUT" == *"arm64"* ]] || [[ "$FILE_OUTPUT" == *"aarch64"* ]]; then
                BINARY_ARCH="arm64"
            elif [[ "$FILE_OUTPUT" == *"ELF"* ]] && [[ "$(uname -s)" == "Darwin" ]]; then
                # Linux binary on macOS
                NEEDS_REBUILD=true
                echo "🔨 Binário whisper.cpp compilado para Linux, mas sistema é macOS"
            elif [[ "$FILE_OUTPUT" == *"Mach-O"* ]] && [[ "$(uname -s)" == "Linux" ]]; then
                # macOS binary on Linux
                NEEDS_REBUILD=true
                echo "🔨 Binário whisper.cpp compilado para macOS, mas sistema é Linux"
            fi
            
            # Check architecture mismatch
            if [ -n "$BINARY_ARCH" ] && [ "$BINARY_ARCH" != "$CURRENT_ARCH" ]; then
                NEEDS_REBUILD=true
                echo "🔨 Binário whisper.cpp incompatível: $BINARY_ARCH != $CURRENT_ARCH"
            fi
        fi
    fi
    
    if [ "$NEEDS_REBUILD" = true ]; then
        echo ""
        echo "🔨 Recompilando whisper.cpp para arquitetura local (pode levar alguns minutos)..."
        cd "$WHISPER_CPP_DIR"
        make clean > /dev/null 2>&1 || true
        make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2) 2>&1 | tail -5
        cd "$PROJECT_DIR"
    fi
    
    echo "✅ whisper.cpp"
else
    echo "❌ whisper.cpp não encontrado. Execute 'bun install' novamente."
    exit 1
fi

# Download Whisper model (warm up - avoid latency on first use)
# Read model from .env or use default
if [ -f "$PROJECT_DIR/.env" ]; then
    WHISPER_MODEL=$(grep -E "^WHISPER_MODEL=" "$PROJECT_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
fi
WHISPER_MODEL=${WHISPER_MODEL:-base}

MODELS_DIR="$WHISPER_CPP_DIR/models"
MODEL_FILE="$MODELS_DIR/ggml-${WHISPER_MODEL}.bin"

if [ ! -f "$MODEL_FILE" ]; then
    echo ""
    echo "📥 Baixando modelo Whisper '$WHISPER_MODEL'..."
    cd "$MODELS_DIR"
    bash download-ggml-model.sh "$WHISPER_MODEL"
    cd "$PROJECT_DIR"
fi

if [ -f "$MODEL_FILE" ]; then
    MODEL_SIZE=$(du -h "$MODEL_FILE" | cut -f1)
    echo "✅ Modelo Whisper '$WHISPER_MODEL' ($MODEL_SIZE)"
else
    echo "⚠️  Modelo Whisper não baixado - será baixado no primeiro uso"
fi

# Create necessary directories
mkdir -p data data/temp logs

# Setup .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  Arquivo .env criado a partir do template"
    echo "   Edite com suas configurações antes de iniciar"
fi

# Make scripts executable
chmod +x scripts/*.sh

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo ""
    echo "📦 Instalando PM2..."
    npm install -g pm2
fi
echo "✅ PM2"

# Install and configure pm2-logrotate
echo ""
echo "📦 Configurando pm2-logrotate..."

# Check if pm2-logrotate is already installed
if ! pm2 ls | grep -q "pm2-logrotate"; then
    pm2 install pm2-logrotate
fi

# Configure log rotation settings
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

echo "✅ pm2-logrotate configurado:"
echo "   - Tamanho máximo: 10MB"
echo "   - Arquivos retidos: 30"
echo "   - Compressão: ativada"
echo "   - Rotação: diária à meia-noite"

echo ""
echo "════════════════════════════════════════════"
echo "✅ Setup concluído!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Edite .env com suas configurações"
echo "   2. Inicie: pm2 start ecosystem.config.cjs"
echo "════════════════════════════════════════════"
