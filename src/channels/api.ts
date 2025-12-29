/**
 * API Channel
 * REST API for Siri/Apple Watch integration using Elysia
 */

import { Elysia, t } from 'elysia';
import type { AgentService } from '../core/agent-service.js';
import type { Channel, ChannelOptions, ResponseChunk } from './types.js';

export interface APIChannelConfig {
  enabled: boolean;
  port: number;
  apiKey: string;
}

export class APIChannel implements Channel {
  readonly name = 'api';
  readonly displayName = 'REST API';

  private config: APIChannelConfig;
  private agentService: AgentService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app: any = null;

  constructor(config: APIChannelConfig, options: ChannelOptions) {
    this.config = config;
    this.agentService = options.agentService;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('  ⏭️  API channel disabled');
      return;
    }

    this.app = new Elysia()
      .onBeforeHandle(({ request, set }) => {
        // Skip auth for health check
        if (new URL(request.url).pathname === '/health') {
          return;
        }

        const authHeader = request.headers.get('Authorization');
        const apiKeyHeader = request.headers.get('X-API-Key');

        const providedKey = apiKeyHeader || authHeader?.replace('Bearer ', '');

        if (!providedKey || providedKey !== this.config.apiKey) {
          set.status = 401;
          return { error: 'Unauthorized', message: 'Invalid or missing API key' };
        }
      })
      .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
      .post(
        '/api/message',
        async ({ body, set }) => {
          try {
            const { userId, text, audio, provider, model, sessionId, stream } = body;

            if (!text && !audio) {
              set.status = 400;
              return { error: 'Bad Request', message: 'Either text or audio is required' };
            }

            const options = {
              provider,
              model,
              sessionId,
              stream: stream || false,
            };

            if (audio) {
              // Decode base64 audio
              const audioBuffer = Buffer.from(audio, 'base64');
              const result = await this.agentService.processVoice(
                userId,
                audioBuffer,
                'voice.ogg',
                options
              );

              return {
                transcription: result.transcription,
                response: result.response.text,
                sessionId: result.response.sessionId,
                provider: result.response.provider,
                model: result.response.model,
              };
            }

            if (stream) {
              // SSE streaming response
              return this.handleStreamingRequest(userId, text!, options);
            }

            // Regular response
            const response = await this.agentService.processMessage(userId, text!, options);

            return {
              response: response.text,
              sessionId: response.sessionId,
              provider: response.provider,
              model: response.model,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            set.status = 500;
            return { error: 'Internal Server Error', message: errorMsg };
          }
        },
        {
          body: t.Object({
            userId: t.String(),
            text: t.Optional(t.String()),
            audio: t.Optional(t.String()), // base64
            provider: t.Optional(t.String()),
            model: t.Optional(t.String()),
            sessionId: t.Optional(t.String()),
            stream: t.Optional(t.Boolean()),
          }),
        }
      )
      .post(
        '/api/session/clear',
        async ({ body }) => {
          const { userId } = body;
          this.agentService.clearSession(userId);
          return { success: true };
        },
        {
          body: t.Object({
            userId: t.String(),
          }),
        }
      )
      .get(
        '/api/session/:userId',
        async ({ params }) => {
          const session = this.agentService.getSession(params.userId);
          return {
            sessionId: session.sessionId,
            contextMode: session.contextMode,
            provider: session.provider,
            model: session.model,
            lastActivity: session.lastActivity,
          };
        },
        {
          params: t.Object({
            userId: t.String(),
          }),
        }
      )
      .get('/api/providers', async () => {
        const providers = this.agentService.listProviders();
        const current = this.agentService.getProviderName();
        return { providers, current };
      })
      .get('/api/models', async () => {
        const models = await this.agentService.listModels();
        const current = this.agentService.getModel();
        return { models, current };
      })
      .post(
        '/api/provider',
        async ({ body, set }) => {
          try {
            await this.agentService.setProvider(body.provider);
            return { success: true, provider: this.agentService.getProviderDisplayName() };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            set.status = 400;
            return { error: 'Bad Request', message: errorMsg };
          }
        },
        {
          body: t.Object({
            provider: t.String(),
          }),
        }
      )
      .post(
        '/api/model',
        async ({ body, set }) => {
          try {
            await this.agentService.setModel(body.model);
            return { success: true, model: this.agentService.getModel() };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            set.status = 400;
            return { error: 'Bad Request', message: errorMsg };
          }
        },
        {
          body: t.Object({
            model: t.String(),
          }),
        }
      )
      .get('/api/params', () => {
        return { params: this.agentService.getParams() };
      })
      .post(
        '/api/params',
        async ({ body }) => {
          this.agentService.setParams(body.params);
          return { success: true, params: this.agentService.getParams() };
        },
        {
          body: t.Object({
            params: t.Record(t.String(), t.Any()),
          }),
        }
      )
      .listen(this.config.port);

    console.log(`  ✅ API channel started on port ${this.config.port}`);
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }

  /**
   * Handle streaming request with SSE
   */
  private async handleStreamingRequest(
    userId: string,
    text: string,
    options: { provider?: string; model?: string; sessionId?: string; stream: boolean }
  ): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start: async (controller) => {
        const sendEvent = (type: string, data: unknown) => {
          const event = `data: ${JSON.stringify({ type, data })}\n\n`;
          controller.enqueue(encoder.encode(event));
        };

        // Set up chunk listener
        const chunkHandler = (eventUserId: string, chunk: ResponseChunk) => {
          if (eventUserId === userId) {
            sendEvent('chunk', chunk);
          }
        };

        const completeHandler = (eventUserId: string, response: unknown) => {
          if (eventUserId === userId) {
            sendEvent('complete', response);
            this.agentService.removeListener('chunk', chunkHandler);
            this.agentService.removeListener('complete', completeHandler);
            this.agentService.removeListener('error', errorHandler);
            controller.close();
          }
        };

        const errorHandler = (eventUserId: string, error: Error) => {
          if (eventUserId === userId) {
            sendEvent('error', { message: error.message });
            this.agentService.removeListener('chunk', chunkHandler);
            this.agentService.removeListener('complete', completeHandler);
            this.agentService.removeListener('error', errorHandler);
            controller.close();
          }
        };

        this.agentService.on('chunk', chunkHandler);
        this.agentService.on('complete', completeHandler);
        this.agentService.on('error', errorHandler);

        try {
          await this.agentService.processMessage(userId, text, {
            ...options,
            stream: true,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          sendEvent('error', { message: errorMsg });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }
}
