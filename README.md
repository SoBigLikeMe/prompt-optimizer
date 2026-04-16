# Prompt Plus

Repository: https://github.com/SoBigLikeMe/prompt-optimizer

## English

### Overview

`Prompt Plus` is a VS Code sidebar extension that rewrites raw prompts into clearer, more structured, and more reliable prompts.

### Features

- Optimize prompts directly from the VS Code sidebar.
- Built-in config panel for `API Endpoint`, `API Key`, and `Model`.
- Compatible with OpenAI Chat Completions style APIs.
- Automatically appends `/chat/completions` when the endpoint is domain-only or ends with `/v1` to reduce 404 errors.

### Requirements

- VS Code `>= 1.103.0`
- Node.js `>= 20` (LTS recommended)
- Any available OpenAI-compatible API service

### Local Development and Debugging

1. Install dependencies:

```bash
npm install
```

2. Start debugging:

- Press `F5` in VS Code and run `Run Extension`.
- A new Extension Development Host window will open.

3. Open the panel:

- Click `Prompt Plus` in the Activity Bar.
- Open the `优化面板` view.

### How to Use

1. Fill in the config panel:
- `API Endpoint`, e.g. `https://api.openai.com/v1/chat/completions`
- `API Key`
- `Model`, e.g. `gpt-4o`

2. Click `保存配置` (Save Config).

3. Paste your raw prompt into `原始 Prompt`, then click `开始优化`.

4. Read the result in `优化结果`.

### Settings

You can also configure these in VS Code Settings:

- `promptPlus.apiEndpoint`
- `promptPlus.apiKey`
- `promptPlus.model`

### Troubleshooting

#### 1) 404 Not Found

- Usually caused by an incomplete endpoint path.
- Recommended full endpoint: `https://api.openai.com/v1/chat/completions`
- The extension also auto-fixes:
  - `https://api.openai.com`
  - `https://api.openai.com/v1`

#### 2) 401 Unauthorized

- Check whether the API key is valid, active, and has permission for the target model.

#### 3) Non-JSON response

- The endpoint may point to an HTML page or gateway error page instead of the model API.
- Check proxy, gateway routing, and request path.

### Development Commands

```bash
# Type check
npm run check-types

# Lint
npm run lint

# Build
npm run compile

# Production build
npm run package
```

### Security Note

- Current version stores `API Key` in VS Code global settings.
- For team or production environments, migrating to `vscode.secrets` is recommended.

---

## 中文

### 项目简介

`Prompt Plus` 是一个 VS Code 侧边栏插件，用来把原始提示词优化成结构更清晰、约束更完整、输出更稳定的版本。

### 功能说明

- 在 VS Code 侧边栏输入原始 Prompt，一键优化。
- 内置配置面板，可设置 `API Endpoint`、`API Key`、`Model`。
- 兼容 OpenAI Chat Completions 格式接口。
- 当 Endpoint 只填到域名或 `/v1` 时，会自动补全到 `/chat/completions`，减少 404 配置错误。

### 环境要求

- VS Code `>= 1.103.0`
- Node.js `>= 20`（建议 LTS）
- 一个可用的 OpenAI 兼容 API 服务

### 本地开发与调试

1. 安装依赖：

```bash
npm install
```

2. 启动调试：

- 在 VS Code 中按 `F5` 运行 `Run Extension`。
- 会弹出一个新的 Extension Development Host 窗口。

3. 打开插件面板：

- 在左侧 Activity Bar 找到 `Prompt Plus` 图标。
- 点击后进入 `优化面板`。

### 使用方式

1. 在配置面板填写：
- `API Endpoint`：例如 `https://api.openai.com/v1/chat/completions`
- `API Key`：你的 API Key
- `Model`：例如 `gpt-4o`

2. 点击 `保存配置`。

3. 在 `原始 Prompt` 输入框粘贴提示词，点击 `开始优化`。

4. 在 `优化结果` 区域查看返回内容。

### 配置项（Settings）

你也可以在 VS Code Settings 中直接配置：

- `promptPlus.apiEndpoint`
- `promptPlus.apiKey`
- `promptPlus.model`

### 常见问题

#### 1) 404 Not Found

- 常见原因是 Endpoint 路径不完整。
- 建议优先填写完整地址：`https://api.openai.com/v1/chat/completions`
- 插件也会自动处理：
  - `https://api.openai.com`
  - `https://api.openai.com/v1`

#### 2) 401 Unauthorized

- 检查 `API Key` 是否正确、是否过期、是否有调用目标模型权限。

#### 3) 返回“接口返回非 JSON 内容”

- 通常是 Endpoint 指向了网页地址或网关错误页，而不是模型接口。
- 检查代理、网关转发和请求路径。

### 开发命令

```bash
# 类型检查
npm run check-types

# 代码检查
npm run lint

# 构建
npm run compile

# 生产构建
npm run package
```

### 注意事项

- 当前版本将 `API Key` 存在 VS Code 全局配置中，适合个人开发环境使用。
- 团队场景建议后续迁移到 `vscode.secrets` 做加密存储。
