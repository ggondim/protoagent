# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
