import MockProvider from './MockProvider.js'
import AnthropicProvider from './AnthropicProvider.js'
import OpenAIProvider from './OpenAIProvider.js'
import GoogleProvider from './GoogleProvider.js'
import MetaProvider from './MetaProvider.js'
import ChineseOpenWeightsProvider from './ChineseOpenWeightsProvider.js'
import OllamaProvider from './OllamaProvider.js'
import CustomProvider from './CustomProvider.js'

/**
 * Registry of all available providers.
 * Each entry describes the UI fields to show and the class to instantiate.
 */
export const PROVIDERS = {
  mock: {
    label: 'Mock (Simulation)',
    Class: MockProvider,
    models: [],
    defaultModel: 'mock',
    requiresApiKey: false,
    freeTextModel: false,
    // Flag consumed by SettingsPanel to show an info banner and hide irrelevant fields
    mockWarning: true,
    badgeColor: 'bg-emerald-100 text-emerald-700',
  },
  anthropic: {
    label: 'Anthropic',
    Class: AnthropicProvider,
    models: ['claude-sonnet-4-20250514', 'claude-opus-4', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-4-20250514',
    requiresApiKey: true,
    // Anthropic blocks browser CORS — show amber warning in SettingsPanel
    corsWarning: true,
    badgeColor: 'bg-orange-100 text-orange-700',
  },
  openai: {
    label: 'OpenAI',
    Class: OpenAIProvider,
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    badgeColor: 'bg-green-100 text-green-700',
  },
  google: {
    label: 'Google Gemini',
    Class: GoogleProvider,
    models: ['gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-pro',
    requiresApiKey: true,
    badgeColor: 'bg-blue-100 text-blue-700',
  },
  meta: {
    label: 'Meta (Llama)',
    Class: MetaProvider,
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-3.1-8B-Instruct-Turbo'],
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    requiresApiKey: true,
    // Sub-selector for the API host
    baseURLOptions: [
      { label: 'Together.xyz', value: 'https://api.together.xyz/v1' },
      { label: 'Fireworks AI', value: 'https://api.fireworks.ai/inference/v1' },
      { label: 'Groq', value: 'https://api.groq.com/openai/v1' },
    ],
    badgeColor: 'bg-indigo-100 text-indigo-700',
  },
  chinese: {
    label: 'Chinese Open Weights',
    Class: ChineseOpenWeightsProvider,
    requiresApiKey: true,
    // Sub-providers with their own base URLs and model lists
    subProviders: {
      qwen: {
        label: 'Qwen (Alibaba)',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen2.5-72b-instruct'],
        defaultModel: 'qwen-plus',
      },
      deepseek: {
        label: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
      },
    },
    defaultSubProvider: 'qwen',
    badgeColor: 'bg-red-100 text-red-700',
  },
  ollama: {
    label: 'Ollama (Local)',
    Class: OllamaProvider,
    models: [],
    defaultModel: 'llama3.2',
    requiresApiKey: false,
    freeTextModel: true,
    // Show OLLAMA_ORIGINS setup instructions in SettingsPanel
    ollamaWarning: true,
    badgeColor: 'bg-gray-100 text-gray-700',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    Class: CustomProvider,
    models: [],
    defaultModel: '',
    requiresApiKey: false,
    freeTextModel: true,
    requiresBaseURL: true,
    badgeColor: 'bg-purple-100 text-purple-700',
  },
}

/**
 * Instantiate a provider by slug, merging in any override settings
 * (e.g., model selection, base URL chosen in the UI).
 */
export function createProvider(slug, overrideSettings = {}) {
  const entry = PROVIDERS[slug]
  if (!entry) throw new Error(`Unknown provider slug: "${slug}"`)
  return new entry.Class(overrideSettings)
}

export const PROVIDER_SLUGS = Object.keys(PROVIDERS)
