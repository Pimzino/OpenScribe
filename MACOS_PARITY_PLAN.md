# macOS Feature Parity Plan

This document outlines the gaps between the Windows and macOS implementations in StepSnap and provides a comprehensive plan to bring macOS to feature parity.

## Executive Summary

The macOS implementation is currently lagging behind Windows in several key areas:
- **Overlay border drawing** - Not actually rendering the green border
- **Toast notifications** - Background shows but text doesn't render
- **Window restoration** - Cannot restore/capture minimized windows
- **Accessibility API** - Partial implementation, doesn't extract element properties
- **Window validation** - No equivalent to Windows' `IsWindow()` check
- **macOS permissions** - Missing Info.plist entries for screen recording/accessibility

---

## Gap Analysis

### 1. Overlay Border Not Drawing (HIGH PRIORITY)

**Windows Implementation** (`overlay.rs:170-237`):
- Uses Win32 GDI APIs (`CreateSolidBrush`, `FillRect`) to draw green rectangles
- Properly paints 4 border rectangles in `WM_PAINT` handler

**macOS Implementation** (`overlay.rs:508-626`):
- Has `draw_border_in_rect()` function but it's marked `#[allow(dead_code)]` and **never called**
- Creates `NSWindow` and `NSView` but doesn't set up drawing
- Line 614-618: Creates content view but no drawing callback is registered

**Fix Required**:
- Create a custom `NSView` subclass with `drawRect:` override
- Use `objc2-app-kit` to implement the drawing callback
- Alternative: Use `CALayer` with `backgroundColor` and `borderWidth`/`borderColor` for simpler implementation

**Estimated Complexity**: Medium

---

### 2. Toast Notification Text Not Rendering (MEDIUM PRIORITY)

**Windows Implementation** (`overlay.rs:372-478`):
- Full toast with rounded rectangle background
- Checkmark icon with cyan accent
- Text rendering with proper font (`CreateFontW`, `DrawTextW`)
- Auto-dismiss timer

**macOS Implementation** (`overlay.rs:655-761`):
- Creates window with background color
- Line 674: `let _message = message.to_string(); // Reserved for future text rendering`
- **No text rendering implemented**
- Auto-dismiss has threading issues (line 745-758 comment mentions this)

**Fix Required**:
- Add `NSTextField` or `NSTextView` for text display
- Use `NSAttributedString` for styled text
- Add circular icon view with checkmark
- Fix auto-dismiss by using `DispatchQueue.main.asyncAfter` instead of background thread
- Consider using `objc2-quartz-core` for `CALayer` rounded corners

**Estimated Complexity**: Medium

---

### 3. Minimized Window Restoration (HIGH PRIORITY)

**Windows Implementation** (`lib.rs:778-790`):
```rust
#[cfg(target_os = "windows")]
if is_minimized {
    let hwnd = HWND(window_id as isize as *mut std::ffi::c_void);
    let _ = ShowWindow(hwnd, SW_RESTORE);
    let _ = SetForegroundWindow(hwnd);
    sleep(Duration::from_millis(400)).await;
}
```

**macOS Implementation**: **None**

**Fix Required**:
- Use AppleScript or Cocoa APIs to restore minimized windows
- AppleScript approach:
  ```applescript
  tell application "System Events"
      set frontmost of process "AppName" to true
      click (first button whose subrole is "AXMinimizeButton") of window 1 of process "AppName"
  end tell
  ```
- Native Cocoa approach:
  - Get `NSRunningApplication` by PID
  - Call `activateWithOptions:` with `NSApplicationActivateIgnoringOtherApps`
  - For window unminimize, need to use Accessibility API or AppleScript

**Estimated Complexity**: Medium-High

---

### 4. Window Validation (MEDIUM PRIORITY)

**Windows Implementation** (`lib.rs:721-729`):
```rust
#[cfg(target_os = "windows")]
fn is_window_valid(window_id: u32) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe {
        let hwnd = HWND(window_id as isize as *mut std::ffi::c_void);
        IsWindow(hwnd).as_bool()
    }
}
```

**macOS Implementation**: **None**

**Fix Required**:
- Use `CGWindowListCopyWindowInfo` to check if window ID exists
- Or use `AXUIElementCreateApplication` + `AXUIElementCopyAttributeValue` with `kAXWindowsAttribute`
- Note: macOS window IDs (CGWindowID) are more stable than Windows HWNDs

**Estimated Complexity**: Low

---

### 5. Accessibility API - Incomplete (MEDIUM PRIORITY)

**Windows Implementation** (`accessibility.rs:24-91`):
- Full UI Automation API integration
- Extracts: name, element_type (localized control type), value, app_name
- Walks up element tree to find root app name

**macOS Implementation** (`accessibility.rs:94-150`):
- Declares `AXUIElementCopyElementAtPosition` and `AXUIElementCopyAttributeValue`
- Only checks if element exists at position
- Line 100: Comment says "simplified implementation - full implementation would use objc crate"
- Returns placeholder `ElementInfo` with "macOS UI Element" as name

**Fix Required**:
- Implement `AXUIElementCopyAttributeValue` calls to extract:
  - `kAXTitleAttribute` (or `kAXDescriptionAttribute`) for name
  - `kAXRoleAttribute` for element type
  - `kAXValueAttribute` for value
  - Walk up via `kAXParentAttribute` to get app name
- Use `CFStringRef` properly with `core-foundation` crate

**Estimated Complexity**: Medium

---

### 6. macOS Permission Declarations (HIGH PRIORITY)

**Current State**: No Info.plist or entitlements files

**Required for macOS**:

1. **Info.plist additions** (in `src-tauri/Info.plist` or via `tauri.conf.json`):
   ```xml
   <key>NSScreenCaptureUsageDescription</key>
   <string>StepSnap needs screen recording permission to capture screenshots for documentation.</string>

   <key>NSAppleEventsUsageDescription</key>
   <string>StepSnap needs automation permission to detect window information.</string>
   ```

2. **Tauri configuration** (`tauri.conf.json` under `bundle.macOS`):
   ```json
   "macOS": {
     "entitlements": null,
     "exceptionDomain": null,
     "infoPlist": {
       "NSScreenCaptureUsageDescription": "StepSnap needs screen recording permission to capture screenshots for documentation.",
       "NSAppleEventsUsageDescription": "StepSnap needs automation permission to detect window information."
     }
   }
   ```

3. **Runtime permission checking**:
   - Add code to check if screen recording permission is granted
   - Show helpful error/guidance if permission denied
   - Use `CGPreflightScreenCaptureAccess()` and `CGRequestScreenCaptureAccess()` (macOS 10.15+)

**Estimated Complexity**: Low-Medium

---

### 7. Additional macOS-Specific Considerations

#### 7.1 Main Thread Requirements
- Many AppKit operations (NSWindow, NSView) must be on main thread
- Current overlay code checks `MainThreadMarker::new()` but silently fails if not on main thread
- Should use `dispatch_async(dispatch_get_main_queue(), ...)` for cross-thread calls

#### 7.2 Retina/HiDPI Handling
- Windows has explicit DPI awareness setup (`SetProcessDpiAwarenessContext`)
- macOS handles this automatically but screenshot coordinates may need adjustment
- Verify `xcap` library handles Retina displays correctly

#### 7.3 Window Filtering
- `is_capturable_window()` function (`lib.rs:580-602`) has Windows-specific system titles
- Need macOS-specific filters (e.g., "Dock", "Menu Bar", "Notification Center")

---

## Implementation Plan

### Phase 1: Critical Functionality - COMPLETE

| Task | Priority | File(s) | Description | Status |
|------|----------|---------|-------------|--------|
| 1.1 | HIGH | `overlay.rs` | Fix overlay border drawing on macOS | DONE |
| 1.2 | HIGH | `Info.plist` | Add Info.plist permission descriptions | DONE |
| 1.3 | HIGH | `lib.rs` | Add macOS minimized window restoration | DONE |

### Phase 2: Visual Polish - COMPLETE

| Task | Priority | File(s) | Description | Status |
|------|----------|---------|-------------|--------|
| 2.1 | MEDIUM | `overlay.rs` | Implement toast text rendering on macOS | DONE |
| 2.2 | MEDIUM | `overlay.rs` | Fix toast auto-dismiss threading | DONE |
| 2.3 | MEDIUM | `overlay.rs` | Add rounded corners to toast | DONE |

### Phase 3: Robustness - COMPLETE

| Task | Priority | File(s) | Description | Status |
|------|----------|---------|-------------|--------|
| 3.1 | MEDIUM | `lib.rs` | Add macOS window validation function | DONE |
| 3.2 | MEDIUM | `accessibility.rs` | Complete macOS accessibility API | DONE |
| 3.3 | LOW | `lib.rs` | Add macOS-specific window filtering | DONE |

### Phase 4: Polish & Testing - COMPLETE

| Task | Priority | File(s) | Description | Status |
|------|----------|---------|-------------|--------|
| 4.1 | MEDIUM | `lib.rs` | Add runtime permission checking with user guidance | DONE |
| 4.2 | LOW | `overlay.rs` | Add main-thread dispatch helpers | DONE |
| 4.3 | LOW | Various | Test on multiple macOS versions | MANUAL

---

## Technical Notes

### Dependencies to Add (Cargo.toml)

```toml
[target.'cfg(target_os = "macos")'.dependencies]
# May need additional features for text rendering
objc2-app-kit = { version = "0.3", features = [
    "NSWindow", "NSColor", "NSView", "NSGraphicsContext",
    "NSBezierPath", "NSResponder", "NSApplication",
    "NSRunningApplication", "NSScreen",
    # Add for toast text:
    "NSTextField", "NSFont", "NSAttributedString",
    # Add for rounded corners:
    "NSVisualEffectView"
] }
# For CALayer if using that approach:
objc2-quartz-core = "0.3"
```

### Testing Checklist (Requires macOS Testing)

- [ ] Overlay border appears when selecting monitor/window
- [ ] Overlay border follows window bounds correctly
- [ ] Toast notification shows text message
- [ ] Toast auto-dismisses after specified duration
- [ ] Minimized windows can be restored and captured
- [ ] Accessibility info is captured correctly for clicks
- [ ] App prompts for screen recording permission on first use
- [ ] App works without accessibility permission (degraded but functional)
- [ ] Multi-monitor setups work correctly
- [ ] Retina displays show correct screenshot resolution

### Implementation Summary

**New Tauri Commands Added:**
- `check_screen_recording_permission()` - Check if screen recording is granted
- `request_screen_recording_permission()` - Request screen recording access
- `check_accessibility_permission()` - Check if accessibility is granted
- `request_accessibility_permission()` - Open System Preferences to grant access
- `get_permission_status()` - Get all permissions at once

**Files Modified:**
- `src-tauri/src/lib.rs` - Window validation, permission commands, window filtering
- `src-tauri/src/overlay.rs` - Main-thread dispatch helpers, border/toast improvements
- `src-tauri/src/accessibility.rs` - Full AX attribute extraction
- `src-tauri/Info.plist` - Permission descriptions
- `src-tauri/Cargo.toml` - Additional objc2 features

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| objc2 API complexity | Medium | Medium | Use simpler CALayer approach where possible |
| Main thread issues | High | Medium | Add proper dispatch wrappers early |
| Permission denials | Medium | High | Add clear user guidance and graceful degradation |
| xcap library bugs | Low | High | Test thoroughly, consider fallback to CGWindowListCreateImage |

---

## Success Criteria

The macOS implementation will be at parity with Windows when:

1. **Visual**: Green overlay border appears around selected monitor/window
2. **Visual**: Toast notification displays message text with checkmark icon
3. **Functional**: Minimized windows can be restored and captured
4. **Functional**: Accessibility API extracts element name, type, and app name
5. **Robustness**: Invalid windows are detected and handled gracefully
6. **UX**: Users are prompted for permissions with clear explanations
7. **Polish**: All features work on macOS 10.13+ as documented
