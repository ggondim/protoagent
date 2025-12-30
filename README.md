# 🤖 Protoagent

> **Your AI assistant, your way.** A powerful multi-channel wrapper that lets you interact with AI agents (Claude, Copilot) through Telegram or REST API, using your own subscriptions and running entirely under your control.

Protoagent is a production-ready AI agent orchestrator that bridges the gap between powerful AI providers (Claude SDK, GitHub Copilot CLI) and your preferred communication channels. Built with resilience, memory, and flexibility in mind — no vendor lock-in, just pure control over your AI interactions.

---

## 🎯 Why Protoagent?

- **🔌 Bring Your Own Subscription**: Use your existing Claude Desktop or GitHub Copilot subscriptions — no additional API costs
- **💬 Multi-Channel**: Interact via Telegram bot OR REST API (perfect for Siri/Apple Watch integration)
- **🧠 Built-in Memory**: Short-term and long-term memory with automatic context injection
- **🛡️ Production-Ready**: Crash recovery, circuit breaker, watchdog, and comprehensive logging
- **🎙️ Voice Support**: Integrated Whisper transcription for voice messages
- **🔧 Zero Lock-in**: Switch providers on-the-fly without changing your workflow

---

## ⚡ Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) **OR** [GitHub CLI](https://cli.github.com/) with GitHub Copilot subscription
- A [Telegram Bot](https://t.me/BotFather) token (or enable API mode only)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd protoagente

# Configure environment
cp .env.example .env
nano .env  # Edit with your settings (see below)

# Build and start
docker-compose up -d

# View logs
docker-compose logs -f protoagente
```

**That's it!** Your bot is now running in a Docker container.

### Environment Configuration

Edit `.env` with your required settings:

**Required:**
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ALLOWED_USER_IDS=123456789,987654321  # Your Telegram user ID(s)

# AI Provider Authentication
AI_PROVIDER=claude  # or 'copilot'

# For Claude:
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...  # Generate with: claude setup-token

# For GitHub Copilot:
GH_TOKEN=ghp_...  # Generate at: https://github.com/settings/tokens
```

**Optional:**
```env
# Whisper transcription
WHISPER_MODEL=base              # base (default), tiny, small, medium, large
WHISPER_LANGUAGE=auto           # or specific language code (pt, en, es, etc.)

# Language
DEFAULT_LANGUAGE=pt-BR          # Interface language: pt-BR (default) or en

# Application
LOG_LEVEL=info                  # debug, info, warn, error
MAX_CRASHES=3                   # Circuit breaker threshold

# API mode (for Siri/Apple Watch)
API_ENABLED=true                # Enable REST API
API_PORT=3000
API_KEY=your-secret-key         # Generate with: openssl rand -hex 32
```

### AI Provider Authentication

#### Claude

1. Install Claude Code CLI:
   ```bash
   # macOS
   brew install claude

   # Or download from: https://docs.anthropic.com/en/docs/claude-code
   ```

2. Generate OAuth token:
   ```bash
   claude setup-token
   ```

3. Copy the token to `.env`:
   ```env
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   AI_PROVIDER=claude
   ```

#### GitHub Copilot

1. Create a GitHub Personal Access Token with Copilot permissions:
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `copilot`, `read:user`
   - Generate and copy the token

2. Add to `.env`:
   ```env
   GH_TOKEN=ghp_...
   AI_PROVIDER=copilot
   ```

### Development Mode

For development with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

### Common Commands

```bash
# Start the bot
docker-compose up -d

# Stop the bot
docker-compose down

# Restart (graceful shutdown with automatic cleanup)
docker-compose restart protoagente

# View logs (follow mode)
docker-compose logs -f protoagente

# View recent logs
docker-compose logs --tail 100 protoagente

# Check container health
docker-compose ps
docker inspect protoagente --format='{{.State.Health.Status}}'

# Check resource usage
docker stats protoagente

# Access container shell
docker-compose exec protoagente sh

# Rebuild after changes
docker-compose build
docker-compose up -d

# Clean rebuild (clears cache)
docker-compose build --no-cache
```

---

## ✨ Features

| Feature | Description | Channels |
|---------|-------------|----------|
| 🧠 **Multi-Layer Memory** | State (TODOs), Short-term (recent sessions), Long-term (preferences & summaries) | Both |
| 💬 **Persistent Context** | Session management with continue/resume modes across conversations | Both |
| 🔌 **Multi-Provider** | Claude SDK, GitHub Copilot CLI — switch anytime via env or command | Both |
| 📡 **Multi-Channel** | Telegram bot + REST API with optional SSE streaming | Independent |
| 🎙️ **Voice Messages** | Whisper-powered transcription (Telegram) or base64 audio (API) | Both |
| 🛡️ **Crash Recovery** | Automatic recovery from failures with circuit breaker protection | System |
| 🔍 **Watchdog System** | AI-powered stuck detection with analyst agent validation | System |
| 🔧 **Dynamic Parameters** | Change model, temperature, timeout on-the-fly without restart | Both |
| 📊 **Comprehensive Logging** | Turn logs, tool calls, crash reports with rotation | System |
| 🔐 **Local-First Security** | No API keys in cloud, works with desktop auth, data stays local | System |
| ⚙️ **Tool Execution** | Permission bypass mode for autonomous tool calling (Claude) | Both |
| 🎯 **Session Management** | Per-user sessions with independent context and settings | Both |
| 🌐 **Internationalization** | Multi-language support (en, pt-BR) with auto-detection and user preferences | Both |

---

## 📖 Usage

### Environment Variables Reference

See **Environment Configuration** section above for setup instructions.

**All available variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | - | **Required:** Telegram bot token from @BotFather |
| `ALLOWED_USER_IDS` | - | **Required:** Comma-separated Telegram user IDs |
| `AI_PROVIDER` | `claude` | AI provider: `claude` or `copilot` |
| `CLAUDE_CODE_OAUTH_TOKEN` | - | **Required for Claude:** OAuth token from `claude setup-token` |
| `GH_TOKEN` | - | **Required for Copilot:** GitHub Personal Access Token |
| `WHISPER_MODEL` | `base` | Whisper model: `tiny`, `base`, `small`, `medium`, `large` |
| `WHISPER_LANGUAGE` | `auto` | Language code (e.g., `pt`, `en`, `es`) or `auto` |
| `DEFAULT_LANGUAGE` | `pt-BR` | Default language for interface: `pt-BR` or `en` |
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `MAX_CRASHES` | `3` | Circuit breaker crash threshold |
| `API_ENABLED` | `false` | Enable REST API server |
| `API_PORT` | `3000` | REST API port |
| `API_KEY` | - | REST API authentication key |
| `TELEGRAM_ENABLED` | `true` | Enable Telegram channel |

### Providers

#### Switching via Environment

Edit `.env`:

```env
AI_PROVIDER=claude    # or 'copilot'
```

Then restart:
```bash
docker-compose restart protoagente
```

#### Switching via Channel

**Telegram:**
```
/provider                  # List available providers
/provider claude           # Switch to Claude
/provider copilot          # Switch to Copilot
```

**API:**
```bash
# List providers
curl -X GET http://localhost:3000/api/providers \
  -H "X-API-Key: your-secret-key"

# Switch provider
curl -X POST http://localhost:3000/api/provider \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude"}'
```

#### Provider Setup

See the **AI Provider Authentication** section in Quick Start for detailed setup instructions.

**Quick reference:**

**Claude:**
```bash
# Install Claude Code CLI (macOS)
brew install claude

# Generate OAuth token
claude setup-token

# Add to .env
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
AI_PROVIDER=claude
```

**GitHub Copilot:**
```bash
# Create Personal Access Token at:
# https://github.com/settings/tokens
# Scopes needed: copilot, read:user

# Add to .env
GH_TOKEN=ghp_...
AI_PROVIDER=copilot
```

### Channels

#### Telegram

**Setup:**
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Get your Telegram user ID (send `/start` to [@userinfobot](https://t.me/userinfobot))
4. Configure in `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABC...
   ALLOWED_USER_IDS=your-user-id
   TELEGRAM_ENABLED=true
   ```

**Features:**
- Rich markdown formatting
- Voice message support (automatic transcription)
- Continuous typing indicator during processing
- All commands supported (see below)

#### REST API

**Setup:**
1. Generate a secure API key: `openssl rand -hex 32`
2. Configure in `.env`:
   ```env
   API_ENABLED=true
   API_PORT=3000
   API_KEY=your-generated-key
   ```

**Authentication:**
All requests must include:
```
X-API-Key: your-secret-key
```
or
```
Authorization: Bearer your-secret-key
```

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `POST` | `/api/message` | Send message (text or audio) |
| `POST` | `/api/session/clear` | Clear user session |
| `GET` | `/api/session/:userId` | Get session info |
| `GET` | `/api/providers` | List available providers |
| `GET` | `/api/models` | List available models |
| `POST` | `/api/provider` | Switch provider |
| `POST` | `/api/model` | Switch model |
| `GET` | `/api/params` | Get current parameters |
| `POST` | `/api/params` | Update parameters |

**Example - Send Message:**
```bash
curl -X POST http://localhost:3000/api/message \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "text": "Hello, how are you?",
    "stream": false
  }'
```

**Example - Send Audio:**
```bash
# Audio must be base64 encoded
curl -X POST http://localhost:3000/api/message \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "audio": "base64-encoded-audio-data"
  }'
```

**Response:**
```json
{
  "response": "I'm doing well, thank you!",
  "sessionId": "8b90bef4-45b6-4fdd-9184-6552883dff6e",
  "provider": "claude",
  "model": "claude-sonnet-4-5-20250929"
}
```

**Streaming (SSE):**
```bash
curl -X POST http://localhost:3000/api/message \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "text": "Tell me a story",
    "stream": true
  }'
```

Receives Server-Sent Events:
```
data: {"type":"chunk","data":{"type":"text","content":"Once upon a time"}}
data: {"type":"chunk","data":{"type":"text","content":"..."}}
data: {"type":"complete","data":{...}}
```

### Language & Internationalization

Protoagent supports **English (en)** and **Portuguese (pt-BR)** for all user-facing messages (~70 translated messages across Telegram, API, and system notifications).

**Automatic Detection (cascade):**
1. User preference (saved via `/language` command)
2. Telegram client language (auto-detected from `language_code`)
3. API `Accept-Language` or `X-Language` headers
4. `DEFAULT_LANGUAGE` environment variable
5. Fallback: pt-BR

**Change Language:**
```
/language          # Show current language
/language en       # Switch to English
/language pt-BR    # Switch to Portuguese
```

Preferences are saved per user and persist across sessions.

### Supported Commands

| Command | Telegram | API Endpoint | Description |
|---------|----------|--------------|-------------|
| **Session Management** ||||
| Clear session | `/clear` | `POST /api/session/clear` | Clear context and start fresh |
| View session | `/context` | `GET /api/session/:userId` | View current session info |
| Set context mode | `/context continue` | - | Set context mode (none/continue/resume) |
| **Provider & Model** ||||
| List providers | `/provider` | `GET /api/providers` | List available providers |
| Switch provider | `/provider claude` | `POST /api/provider` | Switch to a different provider |
| List models | `/model` | `GET /api/models` | List available models |
| Switch model | `/model gpt-4o` | `POST /api/model` | Switch to a different model |
| **Parameters** ||||
| View params | `/params` | `GET /api/params` | View current parameters |
| Set param | `/params temp=0.7` | `POST /api/params` | Update a parameter |
| Save params | `/saveparams` | - | Save current params as defaults |
| **Language** ||||
| View language | `/language` | - | Show current interface language |
| Switch language | `/language en` | - | Switch to English or Portuguese (pt-BR) |
| **Tasks & Status** ||||
| View tasks | `/todo` | - | View current TODO list |
| Add task | `/todo add <task>` | - | Add a new task |
| Mark task | `/todo mark 1 completed` | - | Update task status |
| View status | `/status` | - | View system status |
| View logs | `/logs 5` | - | View last N turn logs |
| **System** ||||
| Start | `/start` | - | Welcome message |
| Reboot | `/reboot` | - | Restart the service |

---

## 🛠️ Development

### Local Development

**With Docker (recommended):**
```bash
# Development mode with hot reload
docker-compose -f docker-compose.dev.yml up

# Production mode (local test)
docker-compose up
```

**Without Docker (direct):**
```bash
# Hot reload mode
bun run dev

# Single run
bun run start
```

**Type checking:**
```bash
bunx tsc --noEmit    # TypeScript validation
```

**Dependencies:**
```bash
bun install          # Install/update packages

# After updating dependencies, rebuild Docker image
docker-compose build
```

### Project Structure

```
Protoagent/
├── src/
│   ├── index.ts              # Main entry point, boots all channels
│   ├── healthcheck.ts        # Docker health check script
│   ├── core/
│   │   ├── agent-service.ts  # Core agent processing logic
│   │   └── session-manager.ts # Session management
│   ├── channels/
│   │   ├── types.ts          # Channel interfaces
│   │   ├── telegram.ts       # Telegram channel implementation
│   │   └── api.ts            # REST API channel implementation
│   ├── providers/
│   │   ├── types.ts          # Provider interfaces
│   │   ├── index.ts          # Provider registry
│   │   ├── claude/           # Claude SDK provider
│   │   └── copilot/          # Copilot CLI provider
│   ├── i18n/
│   │   ├── index.ts          # i18next configuration
│   │   └── locales/          # Translation files (en, pt-BR)
│   ├── memory.ts             # Memory management (state, short, long)
│   ├── guardrails.ts         # Turn logging, watchdog, params
│   ├── resilience.ts         # Crash recovery, circuit breaker
│   ├── whisper.ts            # Audio transcription
│   └── types.ts              # Shared types
├── data/                     # Runtime data (sessions, memory, logs)
├── logs/                     # Application logs
├── Dockerfile                # Docker image definition
├── docker-compose.yml        # Production Docker config
└── docker-compose.dev.yml    # Development Docker config
```

### Debugging

#### Log Files

**Container logs:**
```bash
# Stream live logs
docker-compose logs -f protoagente

# Last 100 lines
docker-compose logs --tail 100 protoagente

# Follow errors only (requires jq)
docker-compose logs -f protoagente 2>&1 | grep -i error

# Export logs to file
docker-compose logs protoagente > debug.log
```

**Application logs (from host):**
```bash
tail -f logs/error.log        # Error log
tail -f logs/copilot.log      # Copilot-specific log (if using Copilot)
```

**Application logs (from container):**
```bash
# Access container shell
docker-compose exec protoagente sh

# Then inside container:
tail -f logs/error.log
cat data/LOGGED_TURNS.json | jq .
```

**Turn logs:**
```bash
cat data/LOGGED_TURNS.json | jq .  # Pretty-print turn logs
```

#### Data Files

**Memory & State:**
```bash
cat data/agent-state.json     # Current prompt & TODOs
cat data/short-memory.json    # Recent sessions
cat data/long-memory.json     # Preferences & summaries
cat data/sessions.json        # User sessions
```

**Resilience:**
```bash
cat data/PENDING_TURN.txt     # Last pending turn (if crashed)
cat data/CRASHES.json         # Crash history
cat data/DEFAULT_PARAMS.json  # Saved default parameters
```

#### Common Issues

**Circuit breaker activated:**
```bash
# Check crashes
cat data/CRASHES.json

# Clear crashes and restart
rm data/CRASHES.json
docker-compose restart protoagente
```

**Provider authentication errors:**
```bash
# Claude - verify token
grep CLAUDE_CODE_OAUTH_TOKEN .env

# Regenerate if needed
claude setup-token

# Copilot - verify token
grep GH_TOKEN .env

# Test Copilot access (from container)
docker-compose exec protoagente sh -c 'echo $GH_TOKEN | head -c 20'
```

**Whisper not working:**
```bash
# Check if model is downloaded
docker-compose exec protoagente ls -lh /app/node_modules/whisper-node/lib/whisper.cpp/models/

# Rebuild image to download model
docker-compose build --no-cache
```

**Session not persisting:**
```bash
# Check session file
cat data/sessions.json

# Clear and restart
rm data/sessions.json
docker-compose restart protoagente
```

**API not responding:**
```bash
# Check if API is enabled
grep API_ENABLED .env

# Check container is running
docker-compose ps

# Check container logs
docker-compose logs protoagente | grep -i "api"

# Test health endpoint
curl http://localhost:3000/health
```

**Container won't start:**
```bash
# Check logs for errors
docker-compose logs protoagente

# Verify .env has required variables
grep -E "TELEGRAM_BOT_TOKEN|AI_PROVIDER|CLAUDE_CODE_OAUTH_TOKEN|GH_TOKEN" .env

# Rebuild image
docker-compose build
docker-compose up -d
```

#### Debug Mode

Enable verbose logging in `.env`:
```env
LOG_LEVEL=debug
```

Then restart:
```bash
docker-compose restart protoagente
docker-compose logs -f protoagente
```

---

## 🗺️ Roadmap

- [ ] Conversation/session database
- [ ] Web dashboard for monitoring and control
- [ ] Support for more providers (OpenAI Codex, local LLMs)
- [ ] Multi-user isolation with separate contexts

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

Built with:
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) by Anthropic
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) by GitHub
- [Bun](https://bun.sh) runtime
- [Elysia](https://elysiajs.com) web framework
- [Whisper](https://github.com/openai/whisper) by OpenAI

---

## 📞 Support

For issues, feature requests, or questions:
- 🐛 [Open an issue](../../issues)
- 💬 Check existing [discussions](../../discussions)
- 📖 Read the [changelog](CHANGELOG.md)
