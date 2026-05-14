import OpenAICompatibleProvider from './OpenAICompatibleProvider.js'

/**
 * Adapter for Chinese open-weight models (Qwen via Alibaba DashScope, DeepSeek).
 * Both hosts expose an OpenAI-compatible chat completions endpoint.
 *
 * The UI sub-selector (Qwen vs DeepSeek) sets `settings.baseURL` and `settings.model`
 * before this provider is instantiated.
 */
export default class ChineseOpenWeightsProvider extends OpenAICompatibleProvider {
  static slug = 'chinese'

  constructor(settings = {}) {
    super(settings)
    // Default to Alibaba DashScope (Qwen) if no baseURL specified
    this.baseURL =
      settings.baseURL ||
      (settings.subProvider === 'deepseek'
        ? 'https://api.deepseek.com/v1'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  }
}
