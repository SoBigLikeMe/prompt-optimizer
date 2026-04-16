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
};

type OptimizePayload = {
  prompt: string;
};

type StoredConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

const VIEW_ID = 'promptOptimizer.panel';
const CONFIG_NS = 'promptOptimizer';

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
    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    return {
      endpoint: config.get<string>('apiEndpoint', 'https://api.openai.com/v1/chat/completions'),
      apiKey: config.get<string>('apiKey', ''),
      model: config.get<string>('model', 'gpt-4o'),
    };
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
    };

    if (
      typeof payload.endpoint !== 'string' ||
      typeof payload.apiKey !== 'string' ||
      typeof payload.model !== 'string'
    ) {
      return undefined;
    }

    return {
      endpoint: payload.endpoint,
      apiKey: payload.apiKey,
      model: payload.model,
    };
  }

  private parseOptimizePayload(data: unknown): OptimizePayload | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const payload = data as { prompt?: unknown };

    if (typeof payload.prompt !== 'string') {
      return undefined;
    }

    return {
      prompt: payload.prompt,
    };
  }

  private async handleSaveConfig(data: unknown): Promise<void> {
    const payload = this.parseSaveConfigPayload(data);

    if (!payload) {
      await this.postToWebview({
        command: 'error',
        message: '配置格式错误，请检查 API Endpoint / API Key / Model。',
      });
      return;
    }

    const endpoint = payload.endpoint.trim();
    const apiKey = payload.apiKey.trim();
    const model = payload.model.trim();

    if (!endpoint || !model) {
      await this.postToWebview({
        command: 'error',
        message: 'API Endpoint 和 Model 不能为空。',
      });
      return;
    }

    const config = vscode.workspace.getConfiguration(CONFIG_NS);

    try {
      await config.update('apiEndpoint', endpoint, vscode.ConfigurationTarget.Global);
      await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
      await config.update('model', model, vscode.ConfigurationTarget.Global);

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

      const endpoint = this.resolveChatCompletionsEndpoint(stored.endpoint);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${stored.apiKey}`,
        },
        body: JSON.stringify({
          model: stored.model,
          messages: [
            {
              role: 'system',
              content:
                '你是一位资深提示词工程师。请在不改变用户目标的前提下优化提示词结构，补全约束条件、输入上下文、输出格式与质量标准。直接输出优化后的提示词正文，不要添加解释。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        }),
      });

      const responseText = await response.text();
      let responseData: {
        error?: { message?: string };
        choices?: { message?: { content: string } }[];
      } = {};

      if (responseText.trim().length > 0) {
        try {
          responseData = JSON.parse(responseText) as {
            error?: { message?: string };
            choices?: { message?: { content: string } }[];
          };
        } catch {
          const preview = responseText.slice(0, 200).replace(/\s+/g, ' ').trim();
          throw new Error(
            `接口返回非 JSON 内容（HTTP ${response.status} ${response.statusText}）：${preview || '空内容'}`
          );
        }
      }

      if (!response.ok) {
        const fallbackMessage = `请求失败：HTTP ${response.status} ${response.statusText}`;

        if (response.status === 404) {
          throw new Error(
            responseData.error?.message ??
              `${fallbackMessage}。接口地址可能不完整或路径错误，当前请求地址：${endpoint}`
          );
        }

        throw new Error(
          responseData.error?.message ?? fallbackMessage
        );
      }

      if (responseData.error?.message) {
        throw new Error(responseData.error.message);
      }

      const optimized = responseData.choices?.[0]?.message?.content?.trim();

      if (!optimized) {
        throw new Error('API 未返回可用优化结果，请检查模型与接口响应格式。');
      }

      await this.postToWebview({
        command: 'result',
        data: optimized,
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
  <title>Prompt Optimizer</title>
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
      grid-template-rows: auto auto auto auto;
      gap: 10px;
    }

    .section-title {
      margin: 0 0 6px;
      font-size: 12px;
      color: var(--muted);
    }

    textarea,
    input {
      width: 100%;
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 8px 10px;
      color: var(--input-fg);
      background: var(--input-bg);
      outline: none;
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
    input:focus {
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
    }

    button:hover {
      background: var(--btn-hover);
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

    .config {
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      background: var(--panel-bg);
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .field {
      display: grid;
      gap: 4px;
    }

    .field-label {
      font-size: 12px;
      color: var(--muted);
    }

    .status {
      min-height: 18px;
      font-size: 12px;
      color: var(--muted);
      word-break: break-word;
    }

    .status[data-variant='error'] {
      color: var(--error);
    }
  </style>
</head>
<body>
  <div class="layout">
    <section>
      <p class="section-title">原始 Prompt</p>
      <textarea id="inputPrompt" placeholder="请输入需要优化的提示词，支持多行内容"></textarea>
    </section>

    <section class="action-row">
      <button id="optimizeButton" type="button">🚀 开始优化</button>
      <div class="loading" id="loadingText"></div>
    </section>

    <section>
      <p class="section-title">优化结果</p>
      <textarea id="outputPrompt" readonly placeholder="优化后的 Prompt 将显示在这里"></textarea>
      <div class="status" id="statusText"></div>
    </section>

    <section class="config">
      <p class="section-title">配置面板</p>

      <label class="field">
        <span class="field-label">API Endpoint</span>
        <input id="endpointInput" type="text" placeholder="https://api.openai.com/v1/chat/completions" />
      </label>

      <label class="field">
        <span class="field-label">API Key</span>
        <input id="apiKeyInput" type="password" placeholder="sk-..." />
      </label>

      <label class="field">
        <span class="field-label">Model</span>
        <input id="modelInput" type="text" placeholder="gpt-4o" />
      </label>

      <button id="saveButton" type="button">💾 保存配置</button>
    </section>
  </div>

  <script nonce="${nonce}">
    (() => {
      const vscode = acquireVsCodeApi();

      const inputPrompt = document.getElementById('inputPrompt');
      const outputPrompt = document.getElementById('outputPrompt');
      const optimizeButton = document.getElementById('optimizeButton');
      const loadingText = document.getElementById('loadingText');
      const statusText = document.getElementById('statusText');
      const endpointInput = document.getElementById('endpointInput');
      const apiKeyInput = document.getElementById('apiKeyInput');
      const modelInput = document.getElementById('modelInput');
      const saveButton = document.getElementById('saveButton');

      if (!inputPrompt || !outputPrompt || !optimizeButton || !loadingText || !statusText || !endpointInput || !apiKeyInput || !modelInput || !saveButton) {
        return;
      }

      const controls = {
        inputPrompt: /** @type {HTMLTextAreaElement} */ (inputPrompt),
        outputPrompt: /** @type {HTMLTextAreaElement} */ (outputPrompt),
        optimizeButton: /** @type {HTMLButtonElement} */ (optimizeButton),
        loadingText: /** @type {HTMLDivElement} */ (loadingText),
        statusText: /** @type {HTMLDivElement} */ (statusText),
        endpointInput: /** @type {HTMLInputElement} */ (endpointInput),
        apiKeyInput: /** @type {HTMLInputElement} */ (apiKeyInput),
        modelInput: /** @type {HTMLInputElement} */ (modelInput),
        saveButton: /** @type {HTMLButtonElement} */ (saveButton),
      };

      const setLoading = (loading, message) => {
        controls.optimizeButton.disabled = loading;
        controls.loadingText.textContent = loading ? (message || '正在优化中，请稍候...') : '';
      };

      const setStatus = (message, variant) => {
        controls.statusText.textContent = message || '';
        controls.statusText.dataset.variant = variant === 'error' ? 'error' : 'normal';
      };

      controls.optimizeButton.addEventListener('click', () => {
        const prompt = controls.inputPrompt.value.trim();

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
          },
        });
      });

      controls.saveButton.addEventListener('click', () => {
        const endpoint = controls.endpointInput.value.trim();
        const apiKey = controls.apiKeyInput.value.trim();
        const model = controls.modelInput.value.trim();

        vscode.postMessage({
          command: 'saveConfig',
          data: {
            endpoint,
            apiKey,
            model,
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
            controls.endpointInput.value = typeof data.endpoint === 'string' ? data.endpoint : '';
            controls.apiKeyInput.value = typeof data.apiKey === 'string' ? data.apiKey : '';
            controls.modelInput.value = typeof data.model === 'string' ? data.model : '';
            break;
          }
          case 'loading': {
            const isLoading = Boolean(message.status);
            const text = typeof message.message === 'string' ? message.message : '正在优化中，请稍候...';
            setLoading(isLoading, text);
            break;
          }
          case 'result': {
            controls.outputPrompt.value = typeof message.data === 'string' ? message.data : '';
            setStatus('处理完成。', 'normal');
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
