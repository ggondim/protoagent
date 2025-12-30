# Protoagent

A project that connects a Telegram bot to a local AI via a Bun application.

## Logical capabilities (stored locally)
- Custom system prompt
- Self-management: stores current state in a TO-DO list with a description of the last prompt that generated the list
- Short memory: what was done in recent sessions with the user
- Long memory: user preferences and summaries of relevant past conversations

## Technical capabilities (in/out)
- Bun application that bridges Telegram Bot and the Agent (API, SDK or CLI)
- The call to the Agent is abstract and provider-agnostic: it works with API, SDK or CLI. Specific implementations must still support turns, tool calling, etc.
- User input via text
- User input via audio, transcribed via Whisper CLI, then forwarded to the Agent
- Agent output as rich text, formatted as HTML for the Telegram API
- Each action/content block within the same Agent turn is sent as a separate output message on Telegram (text or tool_use), in the order produced by the Agent
- Emit "Typing…" for each Agent action within a turn
- No interactive UI elements (only text or audio), so buttons/menus or interactive stdin/stdout are not available
- All inherent Agent capabilities (tool calling, web browsing, code execution, etc.) are enabled by default
- Does not support multiple simultaneous users: only one user can interact with the bot.

## Resilience
- Agent call errors are reported to the user in a friendly way and saved to the error log.
- The application runs in Docker with automatic restart policy for failover.

### Boot
- Before each Agent turn, the application saves the user prompt to a `PENDING_TURN` file. The file is cleared at the end of the turn.
- On application boot, `PENDING_TURN` is checked. If a pending prompt exists, this indicates a boot after a crash (a "dirty boot").
- If booting after a crash, a `CRASHES.json` file is created containing an entry with boot timestamp, the pending prompt and an error log dump. A message is also sent to the user notifying about the dirty boot with the same data.
- The boot process checks `CRASHES.json` first. If there are more than three entries it aborts startup using a circuit breaker, sends a message to the user and exits with error code 1 (stopping the container).
- Error logs and the pending prompt file are cleared at the end of each boot (after they have been collected in the case of a dirty boot).
- On each clean boot (no errors), `CRASHES.json` is also removed.
- Planned restarts should use `docker-compose restart protoagente`. The application's graceful shutdown handler automatically clears `PENDING_TURN` on SIGTERM.
- Planned restarts can be triggered: (1) manually by the operator via Docker commands; (2) by the Agent itself via tool calling; or (3) by the user via the `/reboot` Telegram command.

## Parameterization
- The user can ask the Agent to change its own model or other supported parameters at any time and the Agent must be able to reconfigure to reflect those parameters.
- Parameters are ephemeral across boots, but a default file (`DEFAULT_PARAMS`) can be written by the user and loaded on clean boots.

## Guardrails
- Each turn must be recorded in `LOGGED_TURNS` with: timestamp, user prompt, actions performed (tool calls, agent responses, etc.) and the parameters used for the turn.
- If a turn exceeds a configurable timeout (default 2 minutes), an analyst agent should be spawned to determine whether the Agent is "stuck" (e.g., repeating the same action multiple times/loop, no progress, etc.). If the analyst determines the main agent is stuck, it should abort the current turn, notify the user that the Agent was restarted for being stuck, and then restart the main agent clearing current state (but preserving short and long memories).
- Agents do not require explicit user authorization to use tools (e.g., web navigation, code execution, invoking MCPs). This implies configuring Agents in permissive modes to allow the maximum technical capabilities.

## Billing
- Agent providers should support authentication via OAuth or other methods so that the user can use their existing subscriptions, such as Claude Desktop, ChatGPT Plus, GitHub Copilot, etc.
