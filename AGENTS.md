# AGENTS.md - OpenScribe

## Project Overview

OpenScribe is a desktop application for creating step-by-step documentation with AI assistance. It records user actions (clicks and typing), captures screenshots, and uses AI to generate documentation from those recordings.

**Stack**: Tauri 2 + React 19 + TypeScript + Rust + SQLite

## Essential Commands

### Development
```bash
# Frontend dev server only
npm run dev

# Full Tauri development (recommended)
npm run tauri dev

# Build frontend
npm run build

# Build full application
npm run tauri build
```

### Rust Backend
```bash
# From src-tauri directory
cargo build
cargo check
cargo clippy
```

## Project Structure

```
src/                    # React frontend
├── pages/              # Route pages (Dashboard, Editor, NewRecording, etc.)
├── components/         # Reusable UI components
├── features/           # Feature-specific components (recorder)
├── store/              # Zustand state stores
├── lib/                # Utilities and services
│   ├── aiService.ts    # OpenAI API integration
│   └── export/         # Export functionality (MD, PDF, Word, HTML)
└── hooks/              # Custom React hooks

src-tauri/              # Rust backend
├── src/
│   ├── main.rs         # Entry point
│   ├── lib.rs          # Tauri commands and setup
│   ├── recorder.rs     # Input recording (mouse/keyboard)
│   ├── database.rs     # SQLite operations
│   └── accessibility.rs # Platform accessibility APIs
├── Cargo.toml          # Rust dependencies
└── tauri.conf.json     # Tauri configuration
```

## Code Patterns & Conventions

### Rust Backend

**Tauri Commands**
- Defined with `#[tauri::command]` attribute in `lib.rs`
- Return `Result<T, String>` for error handling
- Use `State<'_, StateType>` for shared state access
- All commands registered in `invoke_handler!` macro

```rust
#[tauri::command]
fn my_command(db: State<'_, DatabaseState>) -> Result<MyType, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .do_something()
        .map_err(|e| e.to_string())
}
```

**State Management**
- `RecordingState` - recording status and hotkey bindings
- `DatabaseState` - SQLite connection wrapped in `Mutex<Database>`

**Database**
- SQLite with `rusqlite`
- Schema: `recordings` and `steps` tables
- UUIDs for record IDs
- Timestamps as milliseconds since epoch

### TypeScript Frontend

**State Management**
- Zustand stores in `src/store/`
- Pattern: `useXxxStore = create<XxxState>((set) => ({...}))`
- Access outside React: `useXxxStore.getState()`

**Tauri IPC**
```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke("command_name", { argName: value });
```

**Event Listening**
```typescript
import { listen } from "@tauri-apps/api/event";
const unlisten = listen("event-name", (event) => { ... });
// Cleanup: unlisten.then(f => f());
```

**Component Patterns**
- Functional components with hooks
- Pages in `src/pages/`, components in `src/components/`
- Tailwind CSS for styling (zinc color palette, dark theme)
- Lucide React for icons
- React Router for navigation

**Step Interface**
```typescript
interface Step {
    type_: string;          // "click" or "type"
    x?: number;             // click coordinates
    y?: number;
    text?: string;          // typed text
    timestamp: number;
    screenshot?: string;    // file path
    element_name?: string;  // accessibility info
    element_type?: string;
    element_value?: string;
    app_name?: string;
}
```

## AI Integration

- OpenAI-compatible API (configurable base URL, model)
- Vision model for screenshot analysis
- Sequential processing with context from previous steps
- Settings stored via `@tauri-apps/plugin-store`

## Export Formats

Located in `src/lib/export/`:
- Markdown (with clipboard copy)
- PDF (via pdfmake)
- Word (via docx)
- HTML

## Platform-Specific Code

Rust backend has platform-specific accessibility APIs:
- **Windows**: Win32 UI Accessibility
- **macOS**: Core Foundation/Graphics
- **Linux**: AT-SPI via D-Bus

## Important Gotchas

1. **Screenshot Paths**: Use `convertFileSrc()` from Tauri API to display local images
2. **Asset Protocol Scope**: Must register screenshot directories with `register_asset_scope` command
3. **Splashscreen**: App starts with splashscreen visible, main window hidden until `close_splashscreen` called
4. **Hotkeys**: Global shortcuts registered via `tauri-plugin-global-shortcut`
5. **Step type field**: Named `type_` (with underscore) to avoid Rust keyword conflict
6. **Path normalization**: Convert backslashes to forward slashes for markdown image URLs

## Database Schema

```sql
recordings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    documentation TEXT
)

steps (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    type_ TEXT NOT NULL,
    x INTEGER, y INTEGER,
    text TEXT,
    timestamp INTEGER NOT NULL,
    screenshot_path TEXT,
    element_name TEXT, element_type TEXT,
    element_value TEXT, app_name TEXT,
    order_index INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
)
```

## Dependencies

**Key Frontend**:
- `@tauri-apps/api` + plugins (fs, dialog, store, opener)
- `zustand` - state management
- `react-router-dom` - routing
- `@mdxeditor/editor` - markdown editing
- `docx`, `pdfmake`, `html2pdf.js` - exports
- `tailwindcss` v4 with typography plugin

**Key Backend**:
- `tauri` v2 with plugins
- `rusqlite` - database
- `rdev` - input recording
- `xcap` - screen capture
- `image`/`imageproc` - image processing
- Platform accessibility crates (windows, core-foundation, atspi)

## Testing

No test framework configured. Manual testing via `npm run tauri dev`.

## App Data Location

- Database: `{app_data_dir}/openscribe.db`
- Default screenshots: `{app_data_dir}/screenshots/`
- Screenshots organized in subfolders by recording name
