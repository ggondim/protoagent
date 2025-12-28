#!/bin/bash

# Setup helper for Claude (Anthropic) integration
# This script checks environment and gives step-by-step guidance to
# prepare Claude Desktop / Claude Code environment used by the project.

set -e

echo "🔧 Protoagente — Setup Claude helper"

# Detect common executables
if command -v claude &> /dev/null || command -v claude-code &> /dev/null; then
  echo "✅ Claude CLI found: $(command -v claude || command -v claude-code)"
else
  echo "⚠️  Claude CLI not found. The project uses @anthropic-ai/claude-agent-sdk which authenticates via Claude Desktop/Claude Code."
  echo "
Suggested actions:
  1) Install Claude Desktop from Anthropic (if available for your platform) and sign in with your account.
  2) Alternatively, install the Claude Code CLI per Anthropic instructions (claude-code).

If you have a local Claude Desktop app, make sure it's running before starting the bot.
"
fi

# Check Node dependency
if grep -q "@anthropic-ai/claude-agent-sdk" package.json; then
  echo "✅ Project dependency @anthropic-ai/claude-agent-sdk present in package.json"
else
  echo "⚠️  @anthropic-ai/claude-agent-sdk not present in package.json. Installing via bun..."
  bun add @anthropic-ai/claude-agent-sdk
fi

# Check CLAUDE.md prompt file
if [ -f "CLAUDE.md" ]; then
  echo "✅ CLAUDE.md system prompt exists"
else
  echo "⚠️  CLAUDE.md not found. Create CLAUDE.md at project root to customize system prompt for Claude."
fi

# Inform about session persistence
echo "\nℹ️  Notes:
- Claude sessions are persisted under ~/.claude/projects/ by default when using the SDK/CLI.
- Ensure you allow the SDK/CLI to load project settings (settingSources: ['project']) if you rely on CLAUDE.md.
- If you intend to run headless on a server, make sure Claude Desktop/Code supports non-interactive auth on that platform.
"

echo "✅ Setup-claude helper finished. Edit .env if needed and ensure Claude Desktop/CLI is running before launching Protoagente."
