# Changelog

All notable changes to StepSnap will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

## [0.2.1] - 2026-04-15

### Fixed
- Sidebar logo now renders reliably again after the recent startup/loading changes

### Improved
- App startup now shows the splash screen immediately while settings and OCR warm up in the background
- Added live startup status messaging, including OCR model loading progress

## [0.2.0] - 2026-04-14

### Breaking Changes
- Enabled stricter Content Security Policy (CSP) enforcement for the app
- Removed broad webview filesystem read/write capability
- Moved custom AI endpoint requests into Rust-side validation and policy enforcement

### Security
- Fixed SQL injection vulnerability in `update_database_paths()` by using parameterized queries
- Added path validation to backend file operations to prevent directory traversal attacks

### Reliability
- Added `safe_db_lock()` helper to handle poisoned mutexes gracefully
- Replaced all direct mutex locks with safe locking across database commands
- Added `data_dir()` accessor to Database struct for path validation

### Accessibility
- Added `aria-label` attributes to all icon-only buttons
- Added `aria-label` and `placeholder` to form inputs
- Fixed linter errors for inline styles (moved to Tailwind classes)

### Code Quality
- Added backend database tests for CRUD operations
- Applied consistent code formatting across Rust files

## [0.1.1] - 2026-04-08

### Added
- **Notification tray** - Bell icon in sidebar with unread badge to access all notifications
- Persistent notification storage in SQLite database, surviving app restarts
- Expandable notification cards with full message content for long notifications
- Mark as read (individual and all), delete (individual and clear all) actions
- Relative timestamps on notifications ("2m ago", "1h ago", "Yesterday")
- 30-day automatic cleanup of old notifications on app startup
- Toast notifications can now optionally persist to the notification tray via `persist: true`
- **View changelog before updating** - See what's new in an update from the update notification or About dialog before installing

### Improved
- Long toast messages (e.g. migration warnings) are no longer cut off - they can be expanded in the notification tray

## [0.1.0] - 2026-04-07

### Fixed
- Accessibility: Added `aria-label` to close button in About modal for screen reader support

### Changed
- **Rebranding**: Application renamed from OpenScribe to StepSnap
  - New logo, branding, and application identity
  - GitHub repository migrated to `Pimzino/StepSnap`
- Automatic data migration from `openscribe` to `stepsnap` directory for existing users
- Database file renamed from `openscribe.db` to `stepsnap.db`
- All user-facing references updated from OpenScribe to StepSnap

## [0.0.10] - 2026-01-30

### Changed
- Documentation title (H1) now uses the recording name instead of AI-generated title, ensuring consistency between what you name your recording and the generated documentation

## [0.0.9] - 2026-01-23

### Added
- **macOS**: Runtime permission checking for screen recording and accessibility APIs
- **macOS**: New Tauri commands to check and request system permissions programmatically
- **macOS**: Window validation using CGWindowListCopyWindowInfo to detect invalid windows
- **macOS**: Full accessibility API implementation extracting element name, type, value, and app name

### Improved
- **macOS**: Overlay borders now render correctly using layer-backed NSViews with CALayer backgrounds
- **macOS**: Toast notifications display text using NSTextField with proper styling and rounded corners
- **macOS**: Minimized windows can now be restored and captured using AppleScript automation
- **macOS**: All AppKit operations now safely dispatch to main thread using GCD helpers
- **macOS**: System windows filtered from capture list (Dock, Menu Bar, Notification Center, etc.)
- **Linux**: System windows filtered from capture list (gnome-shell, plasmashell, etc.)
- Added Info.plist with proper permission descriptions for screen recording and automation

### Fixed
- **macOS**: Overlay border not drawing (was marked as dead code and never called)
- **macOS**: Toast notifications only showing background without text
- **macOS**: Silent failures when AppKit operations called from background threads
- **macOS**: Accessibility API returning placeholder values instead of real element properties

## [0.0.8] - 2026-01-22

### Added
- Added Chutes AI as a new AI provider option for documentation generation
- Support for reasoning/thinking models (DeepSeek R1, Qwen3, QwQ) - thinking content is now filtered from generated documentation

### Improved
- Increased blur on update notifications, toast messages, and dropdown menus for better text readability

### Fixed
- AI documentation generation using stale data from previously viewed recording when switching between recordings
- App crash when capturing a visible window from the monitor picker dropdown during recording
- Reasoning models outputting thinking tags as step content instead of the actual response

## [0.0.7] - 2026-01-21

### Fixed
- Splash screen now displays properly on startup with smooth transition to main application

## [0.0.6] - 2026-01-18

### Added
- In-app auto-updates - get notified when a new version is available and update with one click

### Improved
- Settings now auto-save automatically when changed, removing the need for a manual save button
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
- Initial release of StepSnap (originally OpenScribe)
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
