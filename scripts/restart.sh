#!/bin/bash

# Restart script for Protoagente
# This script ensures a clean restart by clearing pending turn before restarting

echo "🔄 Iniciando reinício planejado do Protoagente..."

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( dirname "$SCRIPT_DIR" )"

# Clear pending turn file
PENDING_TURN_FILE="$PROJECT_DIR/data/PENDING_TURN.txt"

if [ -f "$PENDING_TURN_FILE" ]; then
    echo "🗑️  Limpando prompt pendente..."
    rm -f "$PENDING_TURN_FILE"
fi

# Restart PM2 service
echo "🔄 Reiniciando serviço PM2..."

if command -v pm2 &> /dev/null; then
    pm2 restart protoagente
    echo "✅ Serviço reiniciado com sucesso!"
else
    echo "⚠️  PM2 não encontrado. Apenas limpando estado..."
    echo "   Use 'bun run start' para iniciar manualmente"
fi

echo "✅ Reinício planejado concluído!"
