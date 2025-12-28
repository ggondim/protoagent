#!/bin/bash

# Setup helper for GitHub Copilot CLI integration
# This script checks for the Copilot CLI and guides through installation and auth.

set -e

echo "🔧 Protoagente — Setup Copilot helper"

# Check copilot executable
if command -v copilot &> /dev/null; then
  echo "✅ Copilot CLI found at: $(command -v copilot)"
else
  echo "⚠️  Copilot CLI not found on PATH."
  echo "
Suggested installation options:
  - Official releases: https://github.com/github/cli or Copilot CLI docs
  - If available via npm (may vary): npm install -g @githubnext/copilot-cli
  - Homebrew (macOS): brew install github/gh/copilot-cli  # check official formula

After installing, run: copilot --version
"
fi

# Check GitHub auth via gh
if command -v gh &> /dev/null; then
  echo "✅ GitHub CLI (gh) found"
  if gh auth status &> /dev/null; then
    echo "✅ gh is authenticated"
  else
    echo "⚠️  gh not authenticated. Run: gh auth login --web"
  fi
else
  echo "⚠️  GitHub CLI 'gh' not found. It's recommended to install and authenticate with 'gh' to use Copilot CLI."
fi

# Guidance for allowed tools
echo "\nℹ️  For headless operation and to allow Copilot to run tools without interactive approval, the bot uses --allow-all-tools or --allow-tool flags.
Use these with caution and only on trusted directories (see Copilot docs about trusted directories and security considerations)."

# Create config dir for copilot to persist trusted folders if needed
if [ ! -d "$HOME/.copilot" ]; then
  mkdir -p "$HOME/.copilot"
  echo "✅ Created $HOME/.copilot for Copilot CLI config (trusted_folders)"
fi

echo "✅ Setup-copilot helper finished. Authenticate Copilot with GitHub account and ensure 'copilot' CLI runs interactively on the host before launching Protoagente."
