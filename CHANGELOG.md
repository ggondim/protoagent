# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-29

### Added
- **Internationalization (i18n)**: Sistema completo de internacionalização com suporte a múltiplos idiomas
  - Suporte a **Português (pt-BR)** e **Inglês (en)**
  - ~70 mensagens user-facing traduzidas (Telegram, API, notificações do sistema)
  - Biblioteca: `i18next` com backend de sistema de arquivos (`i18next-fs-backend`)
  - Organização em 5 namespaces: `telegram`, `api`, `resilience`, `whisper`, `common`
- **Detecção Automática de Idioma**: Sistema inteligente em cascata
  1. Preferência armazenada do usuário (persistente)
  2. `language_code` do Telegram (auto-detectado do cliente)
  3. Header `Accept-Language` (API REST)
  4. Variável de ambiente `DEFAULT_LANGUAGE`
  5. Fallback: pt-BR
- **Comando `/language`**: Permite usuários trocarem o idioma manualmente
  - `/language` - Mostra idioma atual
  - `/language pt-BR` - Muda para português
  - `/language en` - Muda para inglês
- **Persistência de Idioma**: Preferência de idioma salva por usuário no `agent-state.json`
- **API Headers**: Suporte a detecção via `Accept-Language` e `X-Language` headers

### Changed
- **Memory System**: Adicionado campo `userLanguages` ao `AgentState` para persistir preferências
- **Telegram Channel**: Todas as mensagens de comandos agora internacionalizadas
- **API Channel**: Mensagens de erro e respostas internacionalizadas
- **Resilience Manager**: Notificações de crash e circuit breaker traduzidas
- **Whisper**: Mensagens de erro user-facing traduzidas (console logs mantidos em inglês)

### Configuration
Nova variável de ambiente no `.env`:
```env
# Default language for user-facing messages: 'pt-BR' or 'en' (default: 'pt-BR')
DEFAULT_LANGUAGE=pt-BR
```

### Technical Details
- **Dependencies**: Adicionado `i18next@25.7.3` e `i18next-fs-backend@2.6.1`
- **Translation Files**: 10 arquivos JSON (5 para pt-BR, 5 para en)
- **HTML Preservation**: Tags HTML (`<b>`, `<code>`, `<i>`) preservadas para Telegram
- **Variable Interpolation**: Suporte a variáveis dinâmicas (ex: `{{provider}}`, `{{model}}`)
- **Console Logs**: Mantidos sem tradução (para desenvolvedores)
- **Whisper Language**: Mantido em modo `auto` (detecção independente do idioma da interface)
- **Backward Compatibility**: 100% compatível - idioma padrão permanece pt-BR

### Files Modified
- `src/i18n/index.ts` - Configuração i18next (novo)
- `src/i18n/locales/**/*.json` - Arquivos de tradução (10 novos)
- `src/types.ts` - Adicionado `userLanguages` ao `AgentState`
- `src/memory.ts` - Métodos de gerenciamento de idioma por usuário
- `src/channels/telegram.ts` - Integração i18n, novo comando `/language`
- `src/channels/api.ts` - Detecção de idioma via headers
- `src/resilience.ts` - Mensagens traduzidas
- `src/whisper.ts` - Erros traduzidos
- `src/index.ts` - Inicialização i18n
- `.env.example` - Documentação de `DEFAULT_LANGUAGE`

## [1.1.1] - 2025-12-29

### Added
- **PM2 Log Rotation**: Configuração automática do `pm2-logrotate` no script de setup
  - Tamanho máximo de arquivo: 10MB
  - Retenção: 30 arquivos rotacionados
  - Compressão de logs antigos ativada
  - Rotação diária automática à meia-noite
  - Previne crescimento descontrolado dos arquivos de log

### Changed
- **Setup Script**: Melhorado para instalar e configurar `pm2-logrotate` automaticamente

## [1.1.0] - 2025-12-29

### Added
- **Multi-Channel Architecture**: Desacoplamento da interface de comunicação permitindo múltiplos canais
- **REST API**: Nova API REST com Elysia para integração com Siri/Apple Watch
  - Endpoint `/api/message` com suporte a texto e áudio (base64)
  - Suporte a streaming via Server-Sent Events (SSE) opcional
  - Autenticação via API Key (header `X-API-Key` ou `Authorization: Bearer`)
  - Endpoints para gerenciamento de sessões, providers e modelos
- **AgentService**: Core centralizado para processamento de mensagens
  - EventEmitter para streaming de respostas
  - Suporte a múltiplos canais simultâneos
  - Processamento unificado de texto e voz
- **SessionManager**: Gerenciador centralizado de sessões de usuários
  - Persistência em `data/sessions.json`
  - Suporte a múltiplos modos de contexto (none, continue, resume)
- **Channel Abstraction**: Interface base para canais de comunicação
  - TelegramChannel (refatorado do telegram-bot.ts)
  - APIChannel (novo canal REST)

### Changed
- **Project Structure**: Nova organização de arquivos
  - `src/core/` - Serviços centrais (AgentService, SessionManager)
  - `src/channels/` - Implementações de canais (Telegram, API)
- **Telegram Bot**: Refatorado para usar AgentService
  - Mantém todas as funcionalidades existentes
  - Código mais limpo e modular
- **Boot Process**: Suporte a inicialização de múltiplos canais
  - Telegram e API podem ser habilitados/desabilitados independentemente
  - Configuração via variáveis de ambiente

### Configuration
Novas variáveis de ambiente no `.env`:
```env
# API REST
API_ENABLED=true
API_PORT=3000
API_KEY=sua-chave-secreta-aqui

# Telegram (pode desabilitar se quiser usar apenas API)
TELEGRAM_ENABLED=true
```

### Technical Details
- **Dependencies**: Adicionado `elysia@1.4.19` e `typescript@5.9.3`
- **Type Safety**: Todos os arquivos novos com tipagem TypeScript completa
- **Backward Compatibility**: Mantém 100% de compatibilidade com versão anterior via Telegram

### API Endpoints
- `GET /health` - Health check
- `POST /api/message` - Enviar mensagem (com suporte a streaming)
- `POST /api/session/clear` - Limpar sessão
- `GET /api/session/:userId` - Obter status da sessão
- `GET /api/providers` - Listar providers disponíveis
- `GET /api/models` - Listar modelos disponíveis
- `POST /api/provider` - Trocar provider
- `POST /api/model` - Trocar modelo
- `GET /api/params` - Obter parâmetros atuais
- `POST /api/params` - Atualizar parâmetros

## [1.0.0] - 2025-12-28

### Initial Release
- Bot Telegram com integração Claude/Copilot
- Sistema de memória (curto e longo prazo)
- Resiliência e recuperação de crashes
- Guardrails e watchdog anti-loop
- Suporte a mensagens de voz (Whisper)
- Comandos Telegram completos
