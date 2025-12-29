# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-29

### Added
- **Internationalization (i18n)**: Complete internationalization system with multi-language support
  - Support for **Portuguese (pt-BR)** and **English (en)**
  - ~70 user-facing messages translated (Telegram, API, system notifications)
  - Library: `i18next` with filesystem backend (`i18next-fs-backend`)
  - Organization into 5 namespaces: `telegram`, `api`, `resilience`, `whisper`, `common`
- **Automatic Language Detection**: Intelligent cascade system
  1. Stored user preference (persistent)
  2. Telegram `language_code` (auto-detected from client)
  3. `Accept-Language` header (API REST)
  4. `DEFAULT_LANGUAGE` environment variable
  5. Fallback: pt-BR
- **`/language` Command**: Allows users to switch language manually
  - `/language` - Shows current language
  - `/language pt-BR` - Switch to Portuguese
  - `/language en` - Switch to English
- **Language Persistence**: User language preference saved in `agent-state.json`
- **API Headers**: Support for detection via `Accept-Language` and `X-Language` headers

### Changed
- **Memory System**: Added `userLanguages` field to `AgentState` to persist preferences
- **Telegram Channel**: All command messages now internationalized
- **API Channel**: Error messages and responses internationalized
- **Resilience Manager**: Crash and circuit breaker notifications translated
- **Whisper**: User-facing error messages translated (console logs kept in English)

### Configuration
New environment variable in `.env`:
```env
# Default language for user-facing messages: 'pt-BR' or 'en' (default: 'pt-BR')
DEFAULT_LANGUAGE=pt-BR
```

### Technical Details
- **Dependencies**: Added `i18next@25.7.3` and `i18next-fs-backend@2.6.1`
- **Translation Files**: 10 JSON files (5 for pt-BR, 5 for en)
- **HTML Preservation**: HTML tags (`<b>`, `<code>`, `<i>`) preserved for Telegram
- **Variable Interpolation**: Support for dynamic variables (e.g., `{{provider}}`, `{{model}}`)
- **Console Logs**: Kept untranslated (for developers)
- **Whisper Language**: Kept in `auto` mode (detection independent of interface language)
- **Backward Compatibility**: 100% compatible - default language remains pt-BR

### Files Modified
- `src/i18n/index.ts` - i18next configuration (new)
- `src/i18n/locales/**/*.json` - Translation files (10 new)
- `src/types.ts` - Added `userLanguages` to `AgentState`
- `src/memory.ts` - User language management methods
- `src/channels/telegram.ts` - i18n integration, new `/language` command
- `src/channels/api.ts` - Language detection via headers
- `src/resilience.ts` - Translated messages
- `src/whisper.ts` - Translated errors
- `src/index.ts` - i18n initialization
- `.env.example` - `DEFAULT_LANGUAGE` documentation

## [1.1.1] - 2025-12-29

### Added
- **PM2 Log Rotation**: Automatic `pm2-logrotate` configuration in setup script
  - Maximum file size: 10MB
  - Retention: 30 rotated files
  - Old log compression enabled
  - Daily automatic rotation at midnight
  - Prevents uncontrolled log file growth

### Changed
- **Setup Script**: Enhanced to automatically install and configure `pm2-logrotate`

## [1.1.0] - 2025-12-29

### Added
- **Multi-Channel Architecture**: Decoupled communication interface allowing multiple channels
- **REST API**: New REST API with Elysia for Siri/Apple Watch integration
  - `/api/message` endpoint with text and audio (base64) support
  - Optional streaming via Server-Sent Events (SSE)
  - API Key authentication (`X-API-Key` header or `Authorization: Bearer`)
  - Endpoints for session, provider, and model management
- **AgentService**: Centralized core for message processing
  - EventEmitter for response streaming
  - Support for multiple simultaneous channels
  - Unified text and voice processing
- **SessionManager**: Centralized user session manager
  - Persistence in `data/sessions.json`
  - Support for multiple context modes (none, continue, resume)
- **Channel Abstraction**: Base interface for communication channels
  - TelegramChannel (refactored from telegram-bot.ts)
  - APIChannel (new REST channel)

### Changed
- **Project Structure**: New file organization
  - `src/core/` - Core services (AgentService, SessionManager)
  - `src/channels/` - Channel implementations (Telegram, API)
- **Telegram Bot**: Refactored to use AgentService
  - Maintains all existing functionality
  - Cleaner, more modular code
- **Boot Process**: Support for multi-channel initialization
  - Telegram and API can be enabled/disabled independently
  - Configuration via environment variables

### Configuration
New environment variables in `.env`:
```env
# REST API
API_ENABLED=true
API_PORT=3000
API_KEY=your-secret-key-here

# Telegram (can disable if using API only)
TELEGRAM_ENABLED=true
```

### Technical Details
- **Dependencies**: Added `elysia@1.4.19` and `typescript@5.9.3`
- **Type Safety**: All new files with complete TypeScript typing
- **Backward Compatibility**: Maintains 100% compatibility with previous version via Telegram

### API Endpoints
- `GET /health` - Health check
- `POST /api/message` - Send message (with streaming support)
- `POST /api/session/clear` - Clear session
- `GET /api/session/:userId` - Get session status
- `GET /api/providers` - List available providers
- `GET /api/models` - List available models
- `POST /api/provider` - Switch provider
- `POST /api/model` - Switch model
- `GET /api/params` - Get current parameters
- `POST /api/params` - Update parameters

## [1.0.0] - 2025-12-28

### Initial Release
- Telegram bot with Claude/Copilot integration
- Memory system (short and long term)
- Resilience and crash recovery
- Guardrails and anti-loop watchdog
- Voice message support (Whisper)
- Complete Telegram commands
