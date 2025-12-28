/**
 * Provider Registry
 * Manages available agent providers
 */

import type { 
  AgentProvider, 
  AgentProviderFactory, 
  AgentProviderOptions,
  ProviderRegistry 
} from './types.js';

// Import provider implementations
import { ClaudeAgentProvider } from './claude/index.js';
import { CopilotAgentProvider } from './copilot/index.js';

/**
 * Global registry of providers
 */
class ProviderRegistryImpl implements ProviderRegistry {
  private factories = new Map<string, AgentProviderFactory>();

  register(name: string, factory: AgentProviderFactory): void {
    this.factories.set(name, factory);
    console.log(`📦 Provider registrado: ${name}`);
  }

  get(name: string, options: AgentProviderOptions): AgentProvider | null {
    const factory = this.factories.get(name);
    if (!factory) {
      console.warn(`Provider não encontrado: ${name}`);
      return null;
    }
    return factory(options);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  async getAvailable(options: AgentProviderOptions): Promise<Map<string, AgentProvider>> {
    const available = new Map<string, AgentProvider>();
    
    for (const [name, factory] of this.factories) {
      try {
        const provider = factory(options);
        if (await provider.isAvailable()) {
          available.set(name, provider);
        }
      } catch (error) {
        console.warn(`Erro ao verificar provider ${name}:`, error);
      }
    }
    
    return available;
  }
}

// Singleton registry instance
export const providerRegistry = new ProviderRegistryImpl();

// Register known providers
providerRegistry.register('claude', (options) => new ClaudeAgentProvider(options));
providerRegistry.register('copilot', (options) => new CopilotAgentProvider(options));

/**
 * Creates a provider by name
 */
export function createProvider(name: string, options: AgentProviderOptions): AgentProvider {
  const provider = providerRegistry.get(name, options);
  if (!provider) {
    throw new Error(`Provider não encontrado: ${name}. Disponíveis: ${providerRegistry.list().join(', ')}`);
  }
  return provider;
}

/**
 * Returns the first available provider
 */
export async function getFirstAvailableProvider(options: AgentProviderOptions): Promise<AgentProvider | null> {
  const available = await providerRegistry.getAvailable(options);
  const first = available.values().next();
  return first.done ? null : first.value;
}

// Re-export types
export * from './types.js';
export { ClaudeAgentProvider } from './claude/index.js';
export { CopilotAgentProvider } from './copilot/index.js';
