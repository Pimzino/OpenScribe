<p align="center">
  <img src="public/logo.png" alt="OpenScribe Logo" width="120" />
</p>

<h1 align="center">OpenScribe</h1>

<p align="center">
  Automated documentation tool that records your screen interactions and converts them into step-by-step guides.
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/pimzino">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" />
  </a>
</p>

---

## Features

- **Interaction Recording** - Captures mouse clicks, keyboard input, and screenshots automatically
- **Step-by-Step Documentation** - Organizes recordings into editable, reorderable steps
- **Image Editing** - Built-in cropping tool for screenshots
- **Export Options** - Generate PDF or DOCX documents from your recordings
- **Cross-Platform** - Works on Windows, macOS, and Linux

## Tech Stack

Built with [Tauri 2](https://tauri.app/), React, and TypeScript.

## Installation

Download the latest release for your platform from the [Releases](https://github.com/Pimzino/OpenScribe/releases) page.

## Development Setup

If you prefer to build from source:

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install)
- Platform-specific dependencies for Tauri: [see Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Pimzino/OpenScribe.git
cd OpenScribe

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## License

[Apache 2.0](LICENSE)
