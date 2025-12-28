# Protoagent

Protoagent is a conversational agent that connects a Telegram bot to AI providers (CLI, SDK, or API). The project focuses on autonomy, local memory, tool execution, and production resilience.

Goal: execute tasks, call tools, and maintain context across turns, running headless via PM2.

---

## Quick Start

### Prerequisites
- Bun installed (or let `scripts/setup.sh` install it)
- FFmpeg available in `PATH`
- C/C++ toolchain (make + gcc/clang) to build `whisper.cpp`
- `sudo` access if you use the automatic setup script (it installs system packages)

1. Prepare environment and dependencies:

```bash
cd ~/protoagente
bash scripts/setup.sh   # may request sudo to install ffmpeg and the toolchain
```

2. Configure environment variables:

```bash
cp .env.example .env
# edit .env: TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, WHISPER_MODEL, AI_PROVIDER
```

3. (Optional) Configure a specific provider:

```bash
# Claude
bash scripts/setup-claude.sh

# Copilot
bash scripts/setup-copilot.sh
```

4. Start with PM2 (recommended):

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Or for development:

```bash
bun run start
```

---

## Important notes

- **Single-user by design**: even if `ALLOWED_USER_IDS` accepts multiple IDs in `.env`, the code only authorizes the first ID.
- **Automatic TODO creation**: messages that look like tasks are recorded in `data/agent-state.json`. To avoid this, send direct questions or disable the heuristic in code.
- **State and logs**:
  - `data/` stores memories, default parameters, and resilience files (`PENDING_TURN.txt`, `CRASHES.json`, `LOGGED_TURNS.json`).
  - `logs/` stores errors (`error.log`), PM2 logs, and for Copilot, `logs/copilot.log`.
  - Circuit breaker: after `MAX_CRASHES` (default 3) boot is blocked; clear errors and restart.

## ✨ Features

Quick overview:

> 🧠 **Memory** — short (recent sessions) + long (preferences) + state (TO-DO)
> 🔧 **Tools** — permission bypass, structured logging, automated workflows
> 🎙️ **Audio** — integrated Whisper transcription
> 🤖 **Multi-provider** — Claude (SDK), Copilot (CLI), generic (CLI/API)
> 🛡️ **Resilience** — crash recovery, circuit breaker, watchdog with analyst agent
> 📊 **Control** — dynamic parameters, persistent context, local-first security

Detailed description:

| Feature | Description |
|---------|-------------|
| 🧠 **Predictable behavior** | Default system prompt control with quick customization of tone, permissions and goals. |
| 💬 **Multi-turn context** | Persistent sessions (when supported by provider) or local memory injection — the agent keeps relevant history between messages for natural continuity. |
| 🚀 **Permission bypass** | When configured (e.g., Claude SDK with `permissionMode=bypass`), the agent can call tools and execute commands without manual approval every turn. |
| 🔍 **Multiple providers** | Provider-agnostic architecture allows switching/running in parallel with Claude (SDK), Copilot (interactive CLI) or generic providers (CLI/API). Switch via `AI_PROVIDER` in `.env`. |
| ⚙️ **Tool execution** | Structured logging in `data/LOGGED_TURNS.json` of calls, side-effects and parameters for audit and recovery. |
| 🧠 **Three-layer memory** | `State` (TO-DO, current prompt), `Short Memory` (last N interactions), `Long Memory` (preferences and summaries). Automatic injection into the prompt with relevance and size control. |
| 🎤 **Audio transcription** | Local Whisper integration via configurable command; converts voice to text in the pipeline. |
| 🛡️ **Resilience** | `PENDING_TURN` saved before processing; `CRASHES.json` records events; circuit breaker prevents boot on repeated crashes; PM2 handles restarts. |
| 🔎 **Watchdog + analyst** | If a turn exceeds timeout, an analyst subagent evaluates whether to abort/restart/escalate — reduces false positives in stuck flows. |
| 💻 **Dynamic control** | Parameters (temperature, max tokens, model) can be viewed/changed at runtime via `/params` and `/model` on Telegram. |
| 🔐 **Local-first & secure** | Support for providers without exposing keys (e.g., Claude Desktop), avoiding sending sensitive data to remote repos. |

---

## Supported providers (examples)

- Claude (SDK): integrates via `@anthropic-ai/claude-agent-sdk`, supports persistent sessions, tools and permission bypass.
- GitHub Copilot CLI: integrated in interactive mode (keeps context while session is open). Use `scripts/setup-copilot.sh` for guidance.
- Generic CLI / API: supports CLI commands or HTTP endpoints configured via `.env`.

Use `AI_PROVIDER` in `.env` to select the active provider.

---

## Bot commands (Telegram)

- `/start` — Welcome message and available commands
- `/status` — System status and parameters
- `/params` — View/change agent parameters
- `/model` — View/switch model in use
- `/context` — View/change context mode (continue/none/resume)
- `/clear` — Clear context and start a new session
- `/reboot` — Restart the service (via script)

---

## Architecture (summary)

- `telegram-bot.ts` — Orchestrates input, streaming outputs and sending to Telegram
- `providers/` — Provider implementations (Claude, Copilot, etc.) following the `AgentProvider` interface
- `memory.ts` — Manages state, short memory and long memory (files in `data/`)
- `guardrails.ts` — Turn logging, params, watchdog and analysis
- `resilience.ts` — PENDING_TURN, CRASHES.json and circuit breaker

---

## Resilience and guardrails

- Before processing each turn, the prompt is saved to `data/PENDING_TURN.txt`.
- On crash, the app records the event in `data/CRASHES.json` and notifies authorized users.
- The circuit breaker stops startup if ≥ `MAX_CRASHES` (default 3).
- Turns are logged in `data/LOGGED_TURNS.json` including actions, tool calls and parameters.
- Watchdog: if a turn timeout is reached, an analyst subagent is invoked to decide whether to abort.

---

## Local provider setup

- Claude: run `scripts/setup-claude.sh` and keep Claude Desktop/CLI authenticated and running so the SDK works without an API key.
- Copilot: run `scripts/setup-copilot.sh`, install and authenticate `gh` and `copilot`, and use the provider in interactive mode.

Note: setup scripts are guidance — some authentication steps require browser login and cannot be fully automated.

---

## Development

- Run TypeScript check:

```bash
bunx tsc --noEmit
```

- Run locally (without PM2):

```bash
bun run start
```

---

## Quick troubleshooting

- PM2 logs:

```bash
pm2 logs protoagente
tail -n 200 logs/error.log
```

- Check crashes:

```bash
cat data/CRASHES.json
```

- Clear pending turn and restart:

```bash
rm data/PENDING_TURN.txt
pm2 restart protoagente
```

---

## Where to look in the code

- `src/telegram-bot.ts` — Telegram integration and streaming
- `src/providers/` — concrete providers (Claude, Copilot)
- `src/memory.ts` — short/long memory and state
- `src/guardrails.ts` — logging and watchdog
- `src/resilience.ts` — crash recovery and circuit breaker

---

## License

MIT

---

## Multiple user configuration

You can allow several users to control the bot at the same time. Just separate the IDs with commas in `.env`:

```env
ALLOWED_USER_IDS=123456789,987654321,555555555
```

All listed IDs will be able to interact with the bot.
