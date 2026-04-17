# Change Log

All notable changes to the "prompt-plus" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- 暂无

## [0.0.3] - 2026-04-17

- 新增插件图标配置，使用根目录 `logo.jpg` 作为扩展图标。

## [0.0.2] - 2026-04-16

- 新增“提示词可视化”可折叠编辑区，默认折叠，编辑内容实时同步到优化逻辑。
- 配置面板改为可折叠组件，默认展开，并通过本地存储记住上次展开/收起状态。
- API Endpoint 输入改为可搜索下拉 + 预设服务商（OpenAI / Anthropic / Gemini / DeepSeek / Moonshot / Qwen）并保留自定义输入。
- 支持配置 `temperature` 与 `maxTokens`，并在保存时进行输入校验。
- 优化结果区域新增复制按钮，可直接复制提示词。
- 增加优化结果清洗逻辑，去除“优化后的提示词如下”这类前置话术。
