# 🤖 Protoagente

> **Your AI assistant, your way.** A powerful multi-channel wrapper that lets you interact with AI agents (Claude, Copilot) through Telegram or REST API, using your own subscriptions and running entirely under your control.

Protoagente is a production-ready AI agent orchestrator that bridges the gap between powerful AI providers (Claude SDK, GitHub Copilot CLI) and your preferred communication channels. Built with resilience, memory, and flexibility in mind — no vendor lock-in, just pure control over your AI interactions.

---

## 🎯 Why Protoagente?

- **🔌 Bring Your Own Subscription**: Use your existing Claude Desktop or GitHub Copilot subscriptions — no additional API costs
- **💬 Multi-Channel**: Interact via Telegram bot OR REST API (perfect for Siri/Apple Watch integration)
- **🧠 Built-in Memory**: Short-term and long-term memory with automatic context injection
- **🛡️ Production-Ready**: Crash recovery, circuit breaker, watchdog, and comprehensive logging
- **🎙️ Voice Support**: Integrated Whisper transcription for voice messages
- **🔧 Zero Lock-in**: Switch providers on-the-fly without changing your workflow

---

## ⚡ Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- FFmpeg (for audio transcription)
- C/C++ toolchain (for Whisper compilation)
- One of: Claude Desktop authenticated OR GitHub Copilot CLI authenticated

### Installation

```bash
# Clone and setup
git clone <repository-url>
cd protoagente
bash scripts/setup.sh

# Configure environment
cp .env.example .env
# Edit .env with your tokens and preferences

# Setup your preferred provider
bash scripts/setup-claude.sh    # For Claude
# OR
bash scripts/setup-copilot.sh   # For GitHub Copilot

# Start with PM2 (recommended)
pm2 start ecosystem.config.cjs
pm2 save
```

**That's it!** Your bot is now running and ready to receive messages.

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

---

## 📖 Usage

### Environment Variables

**Required:**
```env
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ALLOWED_USER_IDS=123456789,987654321  # Comma-separated Telegram user IDs
```

**Optional:**
```env
# AI Provider
AI_PROVIDER=claude              # 'claude' or 'copilot' (default: claude)

# Whisper Configuration
WHISPER_MODEL=base             # Whisper model size (default: base)
WHISPER_LANGUAGE=pt            # Language code or 'auto' (default: auto)

# Application Settings
LOG_LEVEL=info                 # debug|info|warn|error (default: info)
MAX_CRASHES=3                  # Circuit breaker threshold (default: 3)

# API REST (for Siri/Apple Watch)
API_ENABLED=true               # Enable REST API (default: false)
API_PORT=3000                  # API port (default: 3000)
API_KEY=your-secret-key        # API authentication key

# Channel Control
TELEGRAM_ENABLED=true          # Enable Telegram channel (default: true)
```

### Running with PM2

**Start:**
```bash
pm2 start ecosystem.config.cjs
pm2 save                       # Save for auto-restart on reboot
```

**Stop:**
```bash
pm2 stop protoagente
```

**Restart:**
```bash
pm2 restart protoagente
```

**Monitor:**
```bash
pm2 logs protoagente           # Stream logs
pm2 monit                      # Real-time monitoring
```

### Providers

#### Switching via Environment

Edit `.env`:
```env
AI_PROVIDER=claude    # or 'copilot'
```
Then restart: `pm2 restart protoagente`

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

**Claude:**
1. Install [Claude Desktop](https://claude.ai/download)
2. Authenticate with your Anthropic account
3. Run: `bash scripts/setup-claude.sh`
4. Set `AI_PROVIDER=claude` in `.env`

**GitHub Copilot:**
1. Install GitHub CLI: `brew install gh` (macOS) or equivalent
2. Authenticate: `gh auth login`
3. Install Copilot CLI: `gh copilot install` (follow prompts)
4. Run: `bash scripts/setup-copilot.sh`
5. Set `AI_PROVIDER=copilot` in `.env`

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

**Without PM2 (hot reload):**
```bash
bun run dev          # Watch mode with auto-reload
```

**Without PM2 (normal):**
```bash
bun run start        # Single run
```

**Type checking:**
```bash
bunx tsc --noEmit    # TypeScript validation
```

**Install dependencies:**
```bash
bun install          # Install/update packages
```

### Project Structure

```
protoagente/
├── src/
│   ├── index.ts              # Main entry point, boots all channels
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
│   ├── memory.ts             # Memory management (state, short, long)
│   ├── guardrails.ts         # Turn logging, watchdog, params
│   ├── resilience.ts         # Crash recovery, circuit breaker
│   ├── whisper.ts            # Audio transcription
│   └── types.ts              # Shared types
├── data/                     # Runtime data (sessions, memory, logs)
├── logs/                     # Application logs
├── scripts/                  # Setup and utility scripts
└── .bot-runtime/             # Isolated agent SDK runtime
```

### Debugging

#### Log Files

**Application logs:**
```bash
tail -f logs/error.log        # Error log
tail -f logs/copilot.log      # Copilot-specific log (if using Copilot)
```

**PM2 logs:**
```bash
pm2 logs protoagente          # Stream all logs
pm2 logs protoagente --err    # Error logs only
pm2 logs protoagente --lines 100  # Last 100 lines
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
pm2 restart protoagente
```

**Provider not available:**
```bash
# Claude
# Ensure Claude Desktop is running and authenticated

# Copilot
gh auth status                # Check GitHub auth
gh copilot --version          # Verify Copilot CLI installed
```

**Session not persisting:**
```bash
# Check session file
cat data/sessions.json

# Clear and restart
rm data/sessions.json
pm2 restart protoagente
```

**API not responding:**
```bash
# Check if API is enabled
grep API_ENABLED .env

# Check if port is in use
lsof -i :3000

# Test health endpoint
curl http://localhost:3000/health
```

#### Debug Mode

Enable verbose logging:
```env
LOG_LEVEL=debug
```

Then restart: `pm2 restart protoagente`

---

## 🗺️ Roadmap

- [ ] Web dashboard for monitoring and control
- [ ] Support for more providers (OpenAI API, local LLMs)
- [ ] Plugin system for custom tools
- [ ] Multi-user isolation with separate contexts
- [ ] Conversation export/import
- [ ] Custom skills/prompts library

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
