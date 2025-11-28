# Changelog

All notable changes to OpenScribe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2025-05-28

### Added
- AI provider selection (OpenAI, Ollama, LM Studio, Anthropic, OpenRouter, Custom)
- Support for local AI models without API keys
- Auto-detect available models from your AI provider
- Connection test to verify provider connectivity

## [0.0.1] - 2025-11-25

### Added
- Initial release of OpenScribe
- Click and keyboard interaction recording with automatic screenshots
- UI element detection via accessibility APIs (element name, type, app name)
- Click visualization overlay on captured screenshots
- AI-powered step description generation (OpenAI/Claude API)
- AI-powered guide title generation
- Step-by-step documentation editor with drag-and-drop reordering
- Built-in image cropping tool for screenshots
- Markdown preview and editing
- Export to PDF, DOCX, HTML, and Markdown formats
- Copy documentation to clipboard
- Configurable global hotkeys (start/stop recording, manual capture)
- Configurable screenshot storage path
- OpenAI-compatible API settings (base URL, API key, model)
- SQLite database for recording persistence
- Multi-monitor support
- Cross-platform support (Windows, macOS, Linux)
