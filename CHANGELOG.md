# Changelog

All notable changes to OpenScribe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.6] - 2026-01-18

### Improved
- Writing Style settings now use structured options (Tone, Audience, Detail Level, Brand Voice) instead of free-text input, making it easier to customize AI-generated documentation

## [0.0.5] - 2026-01-17

### Added
- Inline recording rename - click the recording name in the detail view to edit it
- Server-side pagination for My Recordings page - recordings are now loaded in pages of 10 for better performance
- Server-side search - search queries are now processed by the database for faster filtering on large collections

### Improved
- Streamlined navigation - app now opens directly to My Recordings, removing the redundant dashboard page
- Simplified app data folder from `com.openscribe` to `openscribe` with automatic migration of existing data
- Search field now includes a clear button for quick search reset

### Fixed
- Screenshots not being deleted from disk when deleting recordings - now shows deletion progress in real-time
- Search icon not displaying in the recordings search field

## [0.0.4] - 2026-01-16

### Added
- Linux Wayland support with automatic display server detection
- Native D-Bus notifications on Linux Wayland sessions
- XWayland fallback for overlay borders when running on Wayland

### Improved
- Unified recording flow - new recordings now open directly in the recording detail view instead of a separate editor page

### Fixed
- Splash screen not auto-closing in production builds (MSI installer)
- Infinite regeneration loop when creating new recordings with auto-generate
- Flash of blank page when saving recordings
- UI hanging when deleting recordings with many screenshots

## [0.0.3] - 2026-01-03

### Added
- Monitor and window picker - choose which screen or window to capture
- OCR text recognition for better AI understanding of your screenshots
- Streaming documentation - watch your guide being written in real-time
- Customizable writing style settings to match your documentation tone
- Rate limit protection to prevent API throttling
- New rich text editor with formatting toolbar (bold, italic, lists, tables, and more)
- Screenshot editor for annotating and editing captured images
- Stale documentation warning when content may need updating
- Helpful tooltips throughout the interface
- Support for additional heading levels (H4, H5, H6)
- Auto-scroll to current step during documentation generation

### Improved
- Faster and smoother scrolling performance
- Better memory usage when capturing screenshots
- Cleaner export experience with native file picker
- More natural AI-generated descriptions with better context awareness
- New animated splash screen
- Refreshed visual styling with custom scrollbars
- Native toast notifications for a cleaner look

### Fixed
- Various tooltip visibility issues
- Monitor picker window sizing and overlay handling
- Image handling in the markdown preview

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
