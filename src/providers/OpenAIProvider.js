import OpenAICompatibleProvider from './OpenAICompatibleProvider.js'

export default class OpenAIProvider extends OpenAICompatibleProvider {
  static slug = 'openai'

  constructor(settings = {}) {
    super(settings)
    this.baseURL = 'https://api.openai.com/v1'
  }
}
