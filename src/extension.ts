import * as vscode from 'vscode';

type ProtocolCommand =
  | 'optimize'
  | 'saveConfig'
  | 'initConfig'
  | 'loading'
  | 'result'
  | 'error';

type ProtocolMessage = {
  command: ProtocolCommand;
  data?: unknown;
  status?: boolean;
  message?: string;
};

type SaveConfigPayload = {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

type OptimizePayload = {
  prompt: string;
  systemPrompt?: string;
};

type StoredConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

type ProviderType = 'openai' | 'anthropic' | 'gemini';

type StringConfigKey = 'apiEndpoint' | 'apiKey' | 'model';
type NumberConfigKey = 'temperature' | 'maxTokens';

type ParsedApiResponse = {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: unknown } }>;
  content?: Array<{ type?: string; text?: string }>;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
};

const VIEW_ID = 'promptPlus.panel';
const CONFIG_NS = 'promptPlus';
const LEGACY_CONFIG_NS = 'promptOptimizer';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1200;
const MAX_ALLOWED_TOKENS = 32768;
const DEFAULT_SYSTEM_PROMPT =
  '你是一位资深提示词工程师。请在不改变用户目标的前提下优化提示词结构，补全约束条件、输入上下文、输出格式与质量标准。直接输出优化后的提示词正文，不要添加解释。';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PromptOptimizerProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );
}

class PromptOptimizerProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.routeMessage(message);
    });

    void this.postInitConfig();
  }

  private async routeMessage(message: unknown): Promise<void> {
    if (!this.isProtocolMessage(message)) {
      return;
    }

    try {
      if (message.command === 'saveConfig') {
        await this.handleSaveConfig(message.data);
        return;
      }

      if (message.command === 'optimize') {
        await this.handleOptimize(message.data);
      }
    } catch (error: unknown) {
      await this.postToWebview({
        command: 'error',
        message: `消息处理失败：${this.errorMessage(error)}`,
      });
    } finally {
      // Per-message cleanup is handled in each command flow.
    }
  }

  private isProtocolMessage(value: unknown): value is ProtocolMessage {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as { command?: unknown };

    return (
      candidate.command === 'optimize' ||
      candidate.command === 'saveConfig' ||
      candidate.command === 'initConfig' ||
      candidate.command === 'loading' ||
      candidate.command === 'result' ||
      candidate.command === 'error'
    );
  }

  private getStoredConfig(): StoredConfig {
    const temperature = this.clampTemperature(
      this.getNumberConfigValue('temperature', DEFAULT_TEMPERATURE)
    );

    const maxTokens = this.clampMaxTokens(
      this.getNumberConfigValue('maxTokens', DEFAULT_MAX_TOKENS)
    );

    return {
      endpoint: this.getStringConfigValue('apiEndpoint', DEFAULT_ENDPOINT),
      apiKey: this.getStringConfigValue('apiKey', ''),
      model: this.getStringConfigValue('model', DEFAULT_MODEL),
      temperature,
      maxTokens,
    };
  }

  private getStringConfigValue(key: StringConfigKey, defaultValue: string): string {
    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    if (this.hasUserConfigValue(config, key)) {
      return config.get<string>(key, defaultValue);
    }

    const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CONFIG_NS);

    if (this.hasUserConfigValue(legacyConfig, key)) {
      return legacyConfig.get<string>(key, defaultValue);
    }

    return config.get<string>(key, defaultValue);
  }

  private getNumberConfigValue(key: NumberConfigKey, defaultValue: number): number {
    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    if (this.hasUserConfigValue(config, key)) {
      const current = config.get<number | string>(key, defaultValue);
      return this.toNumber(current, defaultValue);
    }

    const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CONFIG_NS);

    if (this.hasUserConfigValue(legacyConfig, key)) {
      const legacyValue = legacyConfig.get<number | string>(key, defaultValue);
      return this.toNumber(legacyValue, defaultValue);
    }

    const fallback = config.get<number | string>(key, defaultValue);

    return this.toNumber(fallback, defaultValue);
  }

  private hasUserConfigValue(
    config: vscode.WorkspaceConfiguration,
    key: StringConfigKey | NumberConfigKey
  ): boolean {
    const inspected = config.inspect<unknown>(key);

    return (
      inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined
    );
  }

  private toNumber(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return defaultValue;
  }

  private clampTemperature(value: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_TEMPERATURE;
    }

    return Math.min(2, Math.max(0, value));
  }

  private clampMaxTokens(value: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_TOKENS;
    }

    const rounded = Math.round(value);

    return Math.min(MAX_ALLOWED_TOKENS, Math.max(1, rounded));
  }

  private async postInitConfig(): Promise<void> {
    try {
      const stored = this.getStoredConfig();

      await this.postToWebview({
        command: 'initConfig',
        data: {
          endpoint: stored.endpoint,
          apiKey: stored.apiKey,
          model: stored.model,
          temperature: stored.temperature,
          maxTokens: stored.maxTokens,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
        },
      });
    } catch (error: unknown) {
      await this.postToWebview({
        command: 'error',
        message: `读取配置失败：${this.errorMessage(error)}`,
      });
    } finally {
      // No UI lock to restore for init flow.
    }
  }

  private parseSaveConfigPayload(data: unknown): SaveConfigPayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as {
      endpoint?: unknown;
      apiKey?: unknown;
      model?: unknown;
      temperature?: unknown;
      maxTokens?: unknown;
    };

    if (
      typeof payload.endpoint !== 'string' ||
      typeof payload.apiKey !== 'string' ||
      typeof payload.model !== 'string' ||
      typeof payload.temperature !== 'number' ||
      typeof payload.maxTokens !== 'number'
    ) {
      return undefined;
    }

    return {
      endpoint: payload.endpoint,
      apiKey: payload.apiKey,
      model: payload.model,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
    };
  }

  private parseOptimizePayload(data: unknown): OptimizePayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as { prompt?: unknown; systemPrompt?: unknown };

    if (
      typeof payload.prompt !== 'string' ||
      (payload.systemPrompt !== undefined && typeof payload.systemPrompt !== 'string')
    ) {
      return undefined;
    }

    return {
      prompt: payload.prompt,
      systemPrompt: payload.systemPrompt,
    };
  }

  private async handleSaveConfig(data: unknown): Promise<void> {
    const payload = this.parseSaveConfigPayload(data);

    if (!payload) {
      await this.postToWebview({
        command: 'error',
        message: '配置格式错误，请检查 API Endpoint / API Key / Model / 参数设置。',
      });
      return;
    }

    const endpoint = payload.endpoint.trim();
    const apiKey = payload.apiKey.trim();
    const model = payload.model.trim();
    const temperature = this.clampTemperature(payload.temperature);
    const maxTokens = this.clampMaxTokens(payload.maxTokens);

    if (!endpoint || !model) {
      await this.postToWebview({
        command: 'error',
        message: 'API Endpoint 和 Model 不能为空。',
      });
      return;
    }

    if (!this.isValidUrl(endpoint)) {
      await this.postToWebview({
        command: 'error',
        message: 'API Endpoint 格式无效，请输入完整的 http(s) 地址。',
      });
      return;
    }

    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    try {
      await config.update('apiEndpoint', endpoint, vscode.ConfigurationTarget.Global);
      await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
      await config.update('model', model, vscode.ConfigurationTarget.Global);
      await config.update('temperature', temperature, vscode.ConfigurationTarget.Global);
      await config.update('maxTokens', maxTokens, vscode.ConfigurationTarget.Global);

      await this.postToWebview({
        command: 'result',
        data: '✅ 配置已保存。',
      });

      await this.postInitConfig();
    } catch (error: unknown) {
      await this.postToWebview({
        command: 'error',
        message: `保存配置失败：${this.errorMessage(error)}`,
      });
    } finally {
      // Save flow has no loading state to restore.
    }
  }

  private async handleOptimize(data: unknown): Promise<void> {
    await this.postToWebview({
      command: 'loading',
      status: true,
      message: '正在优化中，请稍候...',
    });

    try {
      const payload = this.parseOptimizePayload(data);

      if (!payload || payload.prompt.trim().length === 0) {
        throw new Error('请输入需要优化的 Prompt。');
      }

      const prompt = payload.prompt.trim();
      const stored = this.getStoredConfig();

      if (!stored.endpoint.trim()) {
        throw new Error('请先填写 API Endpoint。');
      }

      if (!stored.apiKey.trim()) {
        throw new Error('请先填写 API Key。');
      }

      if (!stored.model.trim()) {
        throw new Error('请先填写 Model。');
      }

      const provider = this.detectProvider(stored.endpoint);
      const systemPrompt =
        typeof payload.systemPrompt === 'string' && payload.systemPrompt.trim().length > 0
          ? payload.systemPrompt.trim()
          : DEFAULT_SYSTEM_PROMPT;

      const endpoint = this.resolveProviderEndpoint(provider, stored.endpoint, stored.model);
      const request = this.buildRequest(
        provider,
        stored.apiKey,
        stored.model,
        prompt,
        systemPrompt,
        stored.temperature,
        stored.maxTokens
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
      });

      const responseText = await response.text();
      let responseData: ParsedApiResponse = {};

      if (responseText.trim().length > 0) {
        try {
          responseData = JSON.parse(responseText) as ParsedApiResponse;
        } catch {
          const preview = responseText.slice(0, 200).replace(/\s+/g, ' ').trim();
          throw new Error(
            `接口返回非 JSON 内容（HTTP ${response.status} ${response.statusText}）：${preview || '空内容'}`
          );
        }
      }

      const providerError = this.extractProviderErrorMessage(responseData);

      if (!response.ok) {
        const fallbackMessage = `请求失败：HTTP ${response.status} ${response.statusText}`;

        if (response.status === 404) {
          throw new Error(
            providerError ??
              `${fallbackMessage}。接口地址可能不完整或路径错误，当前请求地址：${endpoint}`
          );
        }

        throw new Error(providerError ?? fallbackMessage);
      }

      if (providerError) {
        throw new Error(providerError);
      }

      const optimized = this.extractOptimizedPrompt(provider, responseData);

      if (!optimized) {
        const blockedReason =
          typeof responseData.promptFeedback?.blockReason === 'string'
            ? `，触发策略：${responseData.promptFeedback.blockReason}`
            : '';
        throw new Error(`API 未返回可用优化结果，请检查模型与接口响应格式${blockedReason}。`);
      }

      await this.postToWebview({
        command: 'result',
        data: this.sanitizeOptimizedPrompt(optimized),
      });
    } catch (error: unknown) {
      await this.postToWebview({
        command: 'error',
        message: `优化失败：${this.errorMessage(error)}`,
      });
    } finally {
      await this.postToWebview({
        command: 'loading',
        status: false,
      });
    }
  }

  private detectProvider(endpoint: string): ProviderType {
    const normalized = endpoint.trim().toLowerCase();

    if (normalized.includes('api.anthropic.com') || /\/v1\/messages(?:\?|$)/.test(normalized)) {
      return 'anthropic';
    }

    if (
      normalized.includes('generativelanguage.googleapis.com') ||
      normalized.includes('googleapis.com/v1beta/models') ||
      normalized.includes('gemini')
    ) {
      return 'gemini';
    }

    return 'openai';
  }

  private resolveProviderEndpoint(
    provider: ProviderType,
    rawEndpoint: string,
    model: string
  ): string {
    if (provider === 'anthropic') {
      return this.resolveAnthropicEndpoint(rawEndpoint);
    }

    if (provider === 'gemini') {
      return this.resolveGeminiEndpoint(rawEndpoint, model);
    }

    return this.resolveChatCompletionsEndpoint(rawEndpoint);
  }

  private resolveAnthropicEndpoint(rawEndpoint: string): string {
    const endpoint = rawEndpoint.trim();

    if (!endpoint) {
      return endpoint;
    }

    try {
      const url = new URL(endpoint);
      const path = url.pathname.replace(/\/+$/, '');

      if (path.length === 0 || /\/v1$/i.test(path)) {
        const basePath = path.length === 0 ? '/v1' : path;
        url.pathname = `${basePath}/messages`;
      }

      return url.toString();
    } catch {
      const path = endpoint.replace(/\/+$/, '');

      if (path.length === 0) {
        return endpoint;
      }

      if (/\/v1$/i.test(path)) {
        return `${path}/messages`;
      }

      return path;
    }
  }

  private resolveGeminiEndpoint(rawEndpoint: string, model: string): string {
    const endpoint = rawEndpoint.trim();
    const cleanModel = model.trim();

    if (!endpoint) {
      return endpoint;
    }

    try {
      const url = new URL(endpoint);
      const path = url.pathname.replace(/\/+$/, '');

      if (/:generateContent$/i.test(path)) {
        return url.toString();
      }

      if (/\/models$/i.test(path)) {
        url.pathname = `${path}/${encodeURIComponent(cleanModel)}:generateContent`;
        return url.toString();
      }

      if (/\/models\/[^/]+$/i.test(path)) {
        url.pathname = `${path}:generateContent`;
        return url.toString();
      }

      if (/\/v1beta$/i.test(path)) {
        url.pathname = `${path}/models/${encodeURIComponent(cleanModel)}:generateContent`;
        return url.toString();
      }

      if (path.length === 0) {
        url.pathname = `/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;
        return url.toString();
      }

      return url.toString();
    } catch {
      const path = endpoint.replace(/\/+$/, '');

      if (/:generateContent$/i.test(path)) {
        return path;
      }

      if (/\/models$/i.test(path)) {
        return `${path}/${encodeURIComponent(cleanModel)}:generateContent`;
      }

      if (/\/models\/[^/]+$/i.test(path)) {
        return `${path}:generateContent`;
      }

      if (/\/v1beta$/i.test(path)) {
        return `${path}/models/${encodeURIComponent(cleanModel)}:generateContent`;
      }

      if (path.length === 0) {
        return endpoint;
      }

      return path;
    }
  }

  private buildRequest(
    provider: ProviderType,
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt: string,
    temperature: number,
    maxTokens: number
  ): {
    headers: Record<string, string>;
    body: unknown;
  } {
    if (provider === 'anthropic') {
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature,
          max_tokens: maxTokens,
        },
      };
    }

    if (provider === 'gemini') {
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
        },
      };
    }

    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: maxTokens,
      },
    };
  }

  private extractProviderErrorMessage(data: ParsedApiResponse): string | undefined {
    if (typeof data.error?.message === 'string' && data.error.message.trim().length > 0) {
      return data.error.message;
    }

    return undefined;
  }

  private extractOptimizedPrompt(
    provider: ProviderType,
    data: ParsedApiResponse
  ): string | undefined {
    if (provider === 'anthropic') {
      const anthropicText = this.extractTextFromContentArray(data.content);
      if (anthropicText) {
        return anthropicText;
      }
    }

    if (provider === 'gemini') {
      const geminiParts = data.candidates?.[0]?.content?.parts;
      const geminiText = this.extractTextFromContentArray(geminiParts);
      if (geminiText) {
        return geminiText;
      }
    }

    const openAIContent = data.choices?.[0]?.message?.content;
    const openAIText = this.extractTextFromContentArray(openAIContent);

    return openAIText;
  }

  private extractTextFromContentArray(content: unknown): string | undefined {
    if (typeof content === 'string') {
      const clean = content.trim();
      return clean.length > 0 ? clean : undefined;
    }

    if (!Array.isArray(content)) {
      return undefined;
    }

    const joined = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object') {
          const candidate = part as { text?: unknown };
          if (typeof candidate.text === 'string') {
            return candidate.text;
          }
        }

        return '';
      })
      .join('\n')
      .trim();

    return joined.length > 0 ? joined : undefined;
  }

  private sanitizeOptimizedPrompt(raw: string): string {
    let text = raw.trim();

    if (!text) {
      return text;
    }

    text = text.replace(/^```[a-zA-Z0-9_-]*\s*/i, '').replace(/\s*```$/i, '').trim();

    const prefixes = [
      /^(优化后(?:的)?提示词(?:如下)?|优化后(?:的)?prompt(?:如下)?|以下是优化后(?:的)?提示词|以下为优化后(?:的)?提示词)[:：\s-]*/i,
      /^(optimized\s*prompt(?:\s*below)?|here(?:\s+is|\'s)\s+the\s+optimized\s+prompt)[:：\s-]*/i,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of prefixes) {
        if (pattern.test(text)) {
          text = text.replace(pattern, '').trim();
          changed = true;
        }
      }
    }

    return text;
  }

  private isValidUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private async postToWebview(message: ProtocolMessage): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage(message);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return '未知错误';
  }

  private resolveChatCompletionsEndpoint(rawEndpoint: string): string {
    const endpoint = rawEndpoint.trim();

    if (!endpoint) {
      return endpoint;
    }

    try {
      const url = new URL(endpoint);
      const path = url.pathname.replace(/\/+$/, '');
      const shouldAppendPath = path.length === 0 || /\/v1$/i.test(path);

      if (shouldAppendPath) {
        const basePath = path.length === 0 ? '/v1' : path;
        url.pathname = `${basePath}/chat/completions`;
      }

      return url.toString();
    } catch {
      const path = endpoint.replace(/\/+$/, '');

      if (path.length === 0) {
        return endpoint;
      }

      if (/\/v1$/i.test(path)) {
        return `${path}/chat/completions`;
      }

      return path;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prompt Plus</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
      --focus: var(--vscode-focusBorder);
      --panel-bg: var(--vscode-sideBarSectionHeader-background);
      --panel-border: var(--vscode-sideBar-border);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);
      --error: var(--vscode-inputValidation-errorForeground);
      --font: var(--vscode-font-family);
      --mono: var(--vscode-editor-font-family);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 12px;
      color: var(--fg);
      background: var(--bg);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.5;
    }

    .layout {
      display: grid;
      gap: 10px;
    }

    .section-title {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .result-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 6px;
    }

    textarea,
    input,
    select {
      width: 100%;
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 8px 10px;
      color: var(--input-fg);
      background: var(--input-bg);
      outline: none;
      font-size: 13px;
    }

    textarea {
      min-height: 120px;
      resize: vertical;
      font-family: var(--mono);
      line-height: 1.45;
    }

    textarea[readonly] {
      opacity: 0.95;
    }

    textarea:focus,
    input:focus,
    select:focus {
      border-color: var(--focus);
    }

    .action-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    button {
      border: none;
      border-radius: 6px;
      padding: 9px 10px;
      color: var(--btn-fg);
      background: var(--btn-bg);
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
    }

    button:hover {
      background: var(--btn-hover);
    }

    .secondary-btn {
      color: var(--btn-secondary-fg);
      background: var(--btn-secondary-bg);
      padding: 6px 10px;
      white-space: nowrap;
    }

    .secondary-btn:hover {
      background: var(--btn-secondary-hover);
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .loading {
      min-height: 18px;
      color: var(--muted);
      font-size: 12px;
    }

    .status {
      min-height: 18px;
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
      word-break: break-word;
    }

    .status[data-variant='error'] {
      color: var(--error);
    }

    .collapsible {
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      background: var(--panel-bg);
      margin-top: 10px;
      overflow: hidden;
    }

    .collapsible > summary {
      list-style: none;
      cursor: pointer;
      padding: 9px 10px;
      font-size: 12px;
      color: var(--muted);
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .collapsible > summary::-webkit-details-marker {
      display: none;
    }

    .collapsible > summary::after {
      content: '▸';
      font-size: 10px;
      transform: rotate(0deg);
      transition: transform 0.15s ease;
    }

    .collapsible[open] > summary::after {
      transform: rotate(90deg);
    }

    .collapsible-body {
      padding: 0 10px 10px;
      border-top: 1px solid var(--panel-border);
    }

    .collapsible-body textarea {
      margin-top: 10px;
      min-height: 140px;
    }

    .config-panel {
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      background: var(--panel-bg);
      overflow: hidden;
    }

    .config-panel > summary {
      list-style: none;
      cursor: pointer;
      padding: 9px 10px;
      font-size: 12px;
      color: var(--muted);
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .config-panel > summary::-webkit-details-marker {
      display: none;
    }

    .config-panel > summary::after {
      content: '▸';
      font-size: 10px;
      transform: rotate(0deg);
      transition: transform 0.15s ease;
    }

    .config-panel[open] > summary::after {
      transform: rotate(90deg);
    }

    .config {
      display: grid;
      gap: 8px;
      padding: 0 10px 10px;
      border-top: 1px solid var(--panel-border);
    }

    .field {
      display: grid;
      gap: 4px;
    }

    .field-label {
      font-size: 12px;
      color: var(--muted);
    }

    .field-hint {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.4;
    }

    .field-error {
      min-height: 16px;
      font-size: 11px;
      color: var(--error);
      line-height: 1.4;
    }

    .config-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    @media (max-width: 420px) {
      .config-grid {
        grid-template-columns: 1fr;
      }

      .section-head {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section>
      <p class="section-title" style="margin-bottom: 6px;">原始 Prompt</p>
      <textarea id="inputPrompt" placeholder="请输入需要优化的提示词，支持多行内容"></textarea>
    </section>

    <section class="action-row">
      <button id="optimizeButton" type="button">开始优化</button>
      <div class="loading" id="loadingText"></div>
    </section>

    <section>
      <div class="section-head">
        <p class="section-title">优化结果</p>
      </div>
      <textarea id="outputPrompt" readonly placeholder="优化后的 Prompt 将显示在这里"></textarea>
      <div class="result-actions">
        <button id="copyPromptButton" type="button" class="secondary-btn" disabled>复制提示词</button>
      </div>

      <details id="promptVisualDetails" class="collapsible">
        <summary>System Prompt（点击展开编辑）</summary>
        <div class="collapsible-body">
          <textarea id="systemPromptEditor" placeholder="可在此编辑 System Prompt，修改会实时用于优化逻辑"></textarea>
        </div>
      </details>

      <div class="status" id="statusText"></div>
    </section>

    <details id="configDetails" class="config-panel" open>
      <summary>配置面板</summary>
      <div class="config">
        <label class="field">
          <span class="field-label">API Endpoint</span>
          <input id="endpointSearchInput" type="search" placeholder="搜索服务商（可选）" />
          <select id="endpointSelect" aria-label="API Endpoint 选择"></select>
          <input id="customEndpointInput" type="text" placeholder="https://your-api-endpoint" hidden />
          <span class="field-hint" id="endpointHint"></span>
          <span class="field-error" id="endpointError"></span>
        </label>

        <label class="field">
          <span class="field-label">API Key</span>
          <input id="apiKeyInput" type="password" placeholder="sk-..." />
        </label>

        <label class="field">
          <span class="field-label">Model</span>
          <input id="modelInput" type="text" placeholder="gpt-4o" />
        </label>

        <div class="config-grid">
          <label class="field">
            <span class="field-label">Temperature</span>
            <input id="temperatureInput" type="number" min="0" max="2" step="0.1" placeholder="0.2" />
          </label>

          <label class="field">
            <span class="field-label">最大长度（max tokens）</span>
            <input id="maxTokensInput" type="number" min="1" step="1" placeholder="1200" />
          </label>
        </div>

        <button id="saveButton" type="button">保存配置</button>
      </div>
    </details>
  </div>

  <script nonce="${nonce}">
    (() => {
      const vscode = acquireVsCodeApi();

      const ENDPOINT_PRESETS = [
        {
          id: 'openai',
          label: 'OpenAI',
          value: 'https://api.openai.com/v1/chat/completions',
          hint: 'OpenAI Chat Completions 标准接口',
          tags: ['openai', 'chatgpt', 'gpt'],
        },
        {
          id: 'anthropic',
          label: 'Anthropic Claude',
          value: 'https://api.anthropic.com/v1/messages',
          hint: 'Claude Messages 接口（自动使用 x-api-key）',
          tags: ['anthropic', 'claude', 'messages'],
        },
        {
          id: 'gemini',
          label: 'Google Gemini',
          value: 'https://generativelanguage.googleapis.com/v1beta/models',
          hint: '会自动拼接为 /models/<model>:generateContent',
          tags: ['google', 'gemini', 'generative language'],
        },
        {
          id: 'deepseek',
          label: 'DeepSeek',
          value: 'https://api.deepseek.com/v1/chat/completions',
          hint: 'DeepSeek OpenAI 兼容接口',
          tags: ['deepseek', 'openai-compatible'],
        },
        {
          id: 'moonshot',
          label: 'Moonshot Kimi',
          value: 'https://api.moonshot.cn/v1/chat/completions',
          hint: 'Moonshot OpenAI 兼容接口',
          tags: ['moonshot', 'kimi', 'openai-compatible'],
        },
        {
          id: 'qwen',
          label: 'Qwen DashScope',
          value: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          hint: '通义千问 OpenAI 兼容接口',
          tags: ['qwen', 'dashscope', 'openai-compatible'],
        },
        {
          id: 'custom',
          label: '自定义',
          value: 'custom',
          hint: '手动输入任意 API 地址',
          tags: ['custom'],
        },
      ];

      const STORAGE_KEYS = {
        configOpen: 'promptPlus.configPanelOpen',
        systemPrompt: 'promptPlus.systemPrompt',
      };

      const inputPrompt = document.getElementById('inputPrompt');
      const outputPrompt = document.getElementById('outputPrompt');
      const systemPromptEditor = document.getElementById('systemPromptEditor');
      const promptVisualDetails = document.getElementById('promptVisualDetails');
      const optimizeButton = document.getElementById('optimizeButton');
      const copyPromptButton = document.getElementById('copyPromptButton');
      const loadingText = document.getElementById('loadingText');
      const statusText = document.getElementById('statusText');
      const endpointSearchInput = document.getElementById('endpointSearchInput');
      const endpointSelect = document.getElementById('endpointSelect');
      const customEndpointInput = document.getElementById('customEndpointInput');
      const endpointHint = document.getElementById('endpointHint');
      const endpointError = document.getElementById('endpointError');
      const apiKeyInput = document.getElementById('apiKeyInput');
      const modelInput = document.getElementById('modelInput');
      const temperatureInput = document.getElementById('temperatureInput');
      const maxTokensInput = document.getElementById('maxTokensInput');
      const saveButton = document.getElementById('saveButton');
      const configDetails = document.getElementById('configDetails');

      if (
        !inputPrompt ||
        !outputPrompt ||
        !systemPromptEditor ||
        !promptVisualDetails ||
        !optimizeButton ||
        !copyPromptButton ||
        !loadingText ||
        !statusText ||
        !endpointSearchInput ||
        !endpointSelect ||
        !customEndpointInput ||
        !endpointHint ||
        !endpointError ||
        !apiKeyInput ||
        !modelInput ||
        !temperatureInput ||
        !maxTokensInput ||
        !saveButton ||
        !configDetails
      ) {
        return;
      }

      const controls = {
        inputPrompt: /** @type {HTMLTextAreaElement} */ (inputPrompt),
        outputPrompt: /** @type {HTMLTextAreaElement} */ (outputPrompt),
        systemPromptEditor: /** @type {HTMLTextAreaElement} */ (systemPromptEditor),
        promptVisualDetails: /** @type {HTMLDetailsElement} */ (promptVisualDetails),
        optimizeButton: /** @type {HTMLButtonElement} */ (optimizeButton),
        copyPromptButton: /** @type {HTMLButtonElement} */ (copyPromptButton),
        loadingText: /** @type {HTMLDivElement} */ (loadingText),
        statusText: /** @type {HTMLDivElement} */ (statusText),
        endpointSearchInput: /** @type {HTMLInputElement} */ (endpointSearchInput),
        endpointSelect: /** @type {HTMLSelectElement} */ (endpointSelect),
        customEndpointInput: /** @type {HTMLInputElement} */ (customEndpointInput),
        endpointHint: /** @type {HTMLSpanElement} */ (endpointHint),
        endpointError: /** @type {HTMLSpanElement} */ (endpointError),
        apiKeyInput: /** @type {HTMLInputElement} */ (apiKeyInput),
        modelInput: /** @type {HTMLInputElement} */ (modelInput),
        temperatureInput: /** @type {HTMLInputElement} */ (temperatureInput),
        maxTokensInput: /** @type {HTMLInputElement} */ (maxTokensInput),
        saveButton: /** @type {HTMLButtonElement} */ (saveButton),
        configDetails: /** @type {HTMLDetailsElement} */ (configDetails),
      };

      const state = {
        selectedEndpointId: 'openai',
        defaultSystemPrompt:
          '你是一位资深提示词工程师。请在不改变用户目标的前提下优化提示词结构，补全约束条件、输入上下文、输出格式与质量标准。直接输出优化后的提示词正文，不要添加解释。',
      };

      const setLoading = (loading, message) => {
        controls.optimizeButton.disabled = loading;
        controls.loadingText.textContent = loading ? message || '正在优化中，请稍候...' : '';
      };

      const setStatus = (message, variant) => {
        controls.statusText.textContent = message || '';
        controls.statusText.dataset.variant = variant === 'error' ? 'error' : 'normal';
      };

      const setEndpointError = (message) => {
        controls.endpointError.textContent = message || '';
        const invalid = message ? 'true' : 'false';
        controls.customEndpointInput.setAttribute('aria-invalid', invalid);
        controls.endpointSelect.setAttribute('aria-invalid', invalid);
      };

      const findPresetById = (id) => ENDPOINT_PRESETS.find((item) => item.id === id);

      const inferPresetByEndpoint = (endpoint) => {
        const value = (endpoint || '').trim().toLowerCase();

        if (!value) {
          return 'openai';
        }

        const exact = ENDPOINT_PRESETS.find((item) => item.id !== 'custom' && item.value.toLowerCase() === value);
        if (exact) {
          return exact.id;
        }

        if (value.includes('api.anthropic.com') || value.includes('/v1/messages')) {
          return 'anthropic';
        }

        if (value.includes('generativelanguage.googleapis.com') || value.includes('/v1beta/models')) {
          return 'gemini';
        }

        if (value.includes('api.deepseek.com')) {
          return 'deepseek';
        }

        if (value.includes('api.moonshot.cn')) {
          return 'moonshot';
        }

        if (value.includes('dashscope.aliyuncs.com')) {
          return 'qwen';
        }

        if (value.includes('api.openai.com')) {
          return 'openai';
        }

        return 'custom';
      };

      const renderEndpointOptions = (keyword) => {
        const query = (keyword || '').trim().toLowerCase();
        let options = ENDPOINT_PRESETS.filter((item) => {
          if (!query) {
            return true;
          }

          if (item.id === 'custom') {
            return true;
          }

          const inLabel = item.label.toLowerCase().includes(query);
          const inValue = item.value.toLowerCase().includes(query);
          const inTags = item.tags.some((tag) => tag.toLowerCase().includes(query));
          return inLabel || inValue || inTags;
        });

        const selected = findPresetById(state.selectedEndpointId);

        if (selected && !options.some((item) => item.id === selected.id)) {
          options = [selected].concat(options);
        }

        controls.endpointSelect.innerHTML = '';

        options.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.label;
          controls.endpointSelect.appendChild(option);
        });

        if (!options.some((item) => item.id === state.selectedEndpointId)) {
          state.selectedEndpointId = options.length > 0 ? options[0].id : 'openai';
        }

        controls.endpointSelect.value = state.selectedEndpointId;
      };

      const updateEndpointFieldState = () => {
        const selected = findPresetById(state.selectedEndpointId);
        const isCustom = state.selectedEndpointId === 'custom';

        controls.customEndpointInput.hidden = !isCustom;
        controls.customEndpointInput.disabled = !isCustom;
        controls.endpointHint.textContent = selected ? selected.hint : '';

        if (!isCustom) {
          setEndpointError('');
        }
      };

      const resolveEndpointValue = () => {
        if (state.selectedEndpointId === 'custom') {
          return controls.customEndpointInput.value.trim();
        }

        const selected = findPresetById(state.selectedEndpointId);
        return selected ? selected.value : '';
      };

      const isValidEndpoint = (value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
          return false;
        }
      };

      const restoreSystemPrompt = () => {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.systemPrompt);
          if (cached && cached.trim().length > 0) {
            controls.systemPromptEditor.value = cached;
          }
        } catch {
          // ignore localStorage read failures
        }
      };

      const persistSystemPrompt = () => {
        try {
          localStorage.setItem(STORAGE_KEYS.systemPrompt, controls.systemPromptEditor.value);
        } catch {
          // ignore localStorage write failures
        }
      };

      const getEffectiveSystemPrompt = () => {
        const custom = controls.systemPromptEditor.value.trim();
        if (custom) {
          return custom;
        }

        return state.defaultSystemPrompt;
      };

      const copyToClipboard = async (text) => {
        if (!text) {
          return false;
        }

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch {
            // fallback below
          }
        }

        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', 'true');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        helper.style.left = '-9999px';
        document.body.appendChild(helper);

        helper.select();
        helper.setSelectionRange(0, helper.value.length);

        let copied = false;
        try {
          copied = document.execCommand('copy');
        } catch {
          copied = false;
        }

        document.body.removeChild(helper);

        return copied;
      };

      const restoreConfigPanelState = () => {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.configOpen);
          if (cached === '0') {
            controls.configDetails.open = false;
          } else if (cached === '1') {
            controls.configDetails.open = true;
          }
        } catch {
          // ignore localStorage read failures
        }
      };

      const persistConfigPanelState = () => {
        try {
          localStorage.setItem(STORAGE_KEYS.configOpen, controls.configDetails.open ? '1' : '0');
        } catch {
          // ignore localStorage write failures
        }
      };

      renderEndpointOptions('');
      updateEndpointFieldState();
      restoreConfigPanelState();
      restoreSystemPrompt();

      controls.systemPromptEditor.addEventListener('input', () => {
        persistSystemPrompt();
      });

      controls.copyPromptButton.addEventListener('click', async () => {
        const textToCopy = controls.outputPrompt.value.trim();

        if (!textToCopy) {
          setStatus('暂无可复制内容。', 'error');
          return;
        }

        const copied = await copyToClipboard(textToCopy);

        if (copied) {
          setStatus('提示词已复制到剪贴板。', 'normal');
        } else {
          setStatus('复制失败，请手动复制。', 'error');
        }
      });

      controls.endpointSearchInput.addEventListener('input', () => {
        renderEndpointOptions(controls.endpointSearchInput.value);
      });

      controls.endpointSelect.addEventListener('change', () => {
        state.selectedEndpointId = controls.endpointSelect.value;
        updateEndpointFieldState();
      });

      controls.customEndpointInput.addEventListener('input', () => {
        if (state.selectedEndpointId === 'custom') {
          setEndpointError('');
        }
      });

      controls.configDetails.addEventListener('toggle', () => {
        persistConfigPanelState();
      });

      controls.optimizeButton.addEventListener('click', () => {
        const prompt = controls.inputPrompt.value.trim();
        const systemPrompt = getEffectiveSystemPrompt();

        if (!prompt) {
          setStatus('请输入原始 Prompt 后再开始优化。', 'error');
          controls.inputPrompt.focus();
          return;
        }

        setStatus('', 'normal');
        setLoading(true, '正在优化中，请稍候...');

        vscode.postMessage({
          command: 'optimize',
          data: {
            prompt,
            systemPrompt,
          },
        });
      });

      controls.saveButton.addEventListener('click', () => {
        const endpoint = resolveEndpointValue();
        const apiKey = controls.apiKeyInput.value.trim();
        const model = controls.modelInput.value.trim();
        const temperature = Number(controls.temperatureInput.value);
        const maxTokens = Number(controls.maxTokensInput.value);

        if (!endpoint) {
          const message = 'API Endpoint 不能为空。';
          setEndpointError(message);
          setStatus(message, 'error');
          if (state.selectedEndpointId === 'custom') {
            controls.customEndpointInput.focus();
          }
          return;
        }

        if (!isValidEndpoint(endpoint)) {
          const message = 'API Endpoint 格式无效，请输入完整的 http(s) 地址。';
          setEndpointError(message);
          setStatus(message, 'error');
          if (state.selectedEndpointId === 'custom') {
            controls.customEndpointInput.focus();
          }
          return;
        }

        setEndpointError('');

        if (!model) {
          setStatus('Model 不能为空。', 'error');
          controls.modelInput.focus();
          return;
        }

        if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
          setStatus('Temperature 需为 0 ~ 2 之间的数字。', 'error');
          controls.temperatureInput.focus();
          return;
        }

        if (!Number.isFinite(maxTokens) || Math.floor(maxTokens) !== maxTokens || maxTokens < 1) {
          setStatus('最大长度需为大于 0 的整数。', 'error');
          controls.maxTokensInput.focus();
          return;
        }

        vscode.postMessage({
          command: 'saveConfig',
          data: {
            endpoint,
            apiKey,
            model,
            temperature,
            maxTokens,
          },
        });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;

        if (!message || typeof message !== 'object') {
          return;
        }

        switch (message.command) {
          case 'initConfig': {
            const data = message.data && typeof message.data === 'object' ? message.data : {};
            const endpoint = typeof data.endpoint === 'string' ? data.endpoint : '';
            const incomingSystemPrompt =
              typeof data.systemPrompt === 'string' && data.systemPrompt.trim().length > 0
                ? data.systemPrompt
                : state.defaultSystemPrompt;
            state.selectedEndpointId = inferPresetByEndpoint(endpoint);
            renderEndpointOptions(controls.endpointSearchInput.value);
            controls.endpointSelect.value = state.selectedEndpointId;

            if (state.selectedEndpointId === 'custom') {
              controls.customEndpointInput.value = endpoint;
            } else {
              controls.customEndpointInput.value = '';
            }

            controls.apiKeyInput.value = typeof data.apiKey === 'string' ? data.apiKey : '';
            controls.modelInput.value = typeof data.model === 'string' ? data.model : 'gpt-4o';

            if (typeof data.temperature === 'number' && Number.isFinite(data.temperature)) {
              controls.temperatureInput.value = String(data.temperature);
            } else {
              controls.temperatureInput.value = '0.2';
            }

            if (typeof data.maxTokens === 'number' && Number.isFinite(data.maxTokens)) {
              controls.maxTokensInput.value = String(Math.max(1, Math.floor(data.maxTokens)));
            } else {
              controls.maxTokensInput.value = '1200';
            }

            state.defaultSystemPrompt = incomingSystemPrompt;
            if (!controls.systemPromptEditor.value.trim()) {
              controls.systemPromptEditor.value = incomingSystemPrompt;
              persistSystemPrompt();
            }

            updateEndpointFieldState();
            break;
          }
          case 'loading': {
            const isLoading = Boolean(message.status);
            const text = typeof message.message === 'string' ? message.message : '正在优化中，请稍候...';
            setLoading(isLoading, text);
            break;
          }
          case 'result': {
            const text = typeof message.data === 'string' ? message.data : '';

            if (text === '✅ 配置已保存。') {
              setStatus(text, 'normal');
              break;
            }

            controls.outputPrompt.value = text;
            controls.copyPromptButton.disabled = text.trim().length === 0;

            if (text.trim().length > 0) {
              setStatus('处理完成，可复制结果或继续调整 System Prompt。', 'normal');
            } else {
              setStatus('处理完成。', 'normal');
            }
            break;
          }
          case 'error': {
            const errorText = typeof message.message === 'string' ? message.message : '发生未知错误。';
            setStatus(errorText, 'error');
            break;
          }
          default:
            break;
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}

export function deactivate(): void {
  // No-op
}
