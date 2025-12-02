//! Native overlay module for drawing monitor highlight borders
//! Uses platform-specific APIs to bypass Tauri's broken webview transparency

// ============================================================================
// Windows Implementation
// ============================================================================

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::core::w;

    static CLASS_REGISTERED: AtomicBool = AtomicBool::new(false);
    static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
    const BORDER_WIDTH: i32 = 4;
    const BORDER_COLOR: COLORREF = COLORREF(0x005EC722); // BGR format: green #22c55e

    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        unsafe {
            let existing = OVERLAY_HWND.load(Ordering::SeqCst);
            if existing != 0 {
                // Move existing window
                let hwnd = HWND(existing as *mut std::ffi::c_void);
                SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    x,
                    y,
                    width as i32,
                    height as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                ).map_err(|e| format!("SetWindowPos failed: {}", e))?;

                let _ = InvalidateRect(hwnd, None, TRUE);
                let _ = UpdateWindow(hwnd);
                return Ok(());
            }

            // Register window class if not already done
            if !CLASS_REGISTERED.load(Ordering::SeqCst) {
                register_class()?;
                CLASS_REGISTERED.store(true, Ordering::SeqCst);
            }

            // Create the overlay window
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("OpenScribeOverlay"),
                w!(""),
                WS_POPUP | WS_VISIBLE,
                x,
                y,
                width as i32,
                height as i32,
                HWND::default(),
                HMENU::default(),
                HINSTANCE::default(),
                None,
            ).map_err(|e| format!("CreateWindowExW failed: {}", e))?;

            if hwnd.0.is_null() {
                return Err("CreateWindowExW returned null".to_string());
            }

            // Store the handle
            OVERLAY_HWND.store(hwnd.0 as isize, Ordering::SeqCst);

            // Set layered window attributes for transparency
            // We use LWA_COLORKEY to make black (0x000000) transparent
            SetLayeredWindowAttributes(hwnd, COLORREF(0), 0, LWA_COLORKEY)
                .map_err(|e| format!("SetLayeredWindowAttributes failed: {}", e))?;

            // Force initial paint
            let _ = InvalidateRect(hwnd, None, TRUE);
            let _ = UpdateWindow(hwnd);

            Ok(())
        }
    }

    pub fn hide_border() -> Result<(), String> {
        unsafe {
            let hwnd_val = OVERLAY_HWND.swap(0, Ordering::SeqCst);
            if hwnd_val != 0 {
                let hwnd = HWND(hwnd_val as *mut std::ffi::c_void);
                // Hide the window immediately
                let _ = ShowWindow(hwnd, SW_HIDE);

                // Process any pending paint messages for this window before destroying
                // This ensures the compositor sees the hide
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, hwnd, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                // Now destroy the window - don't pump messages after this
                // as the window handle becomes invalid
                DestroyWindow(hwnd).ok();
            }
            Ok(())
        }
    }

    fn register_class() -> Result<(), String> {
        unsafe {
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: HINSTANCE::default(),
                hIcon: HICON::default(),
                hCursor: LoadCursorW(HINSTANCE::default(), IDC_ARROW).unwrap_or_default(),
                hbrBackground: HBRUSH::default(),
                lpszMenuName: windows::core::PCWSTR::null(),
                lpszClassName: w!("OpenScribeOverlay"),
                hIconSm: HICON::default(),
            };

            let result = RegisterClassExW(&wc);
            if result == 0 {
                return Err("RegisterClassExW failed".to_string());
            }
            Ok(())
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_PAINT => {
                let mut ps = PAINTSTRUCT::default();
                let hdc = BeginPaint(hwnd, &mut ps);

                // Get window dimensions
                let mut rect = RECT::default();
                GetClientRect(hwnd, &mut rect).ok();

                // Fill background with black (will be transparent due to LWA_COLORKEY)
                let black_brush = CreateSolidBrush(COLORREF(0));
                FillRect(hdc, &rect, black_brush);
                let _ = DeleteObject(black_brush);

                // Draw the green border (4 rectangles)
                let green_brush = CreateSolidBrush(BORDER_COLOR);

                // Top border
                let top_rect = RECT {
                    left: 0,
                    top: 0,
                    right: rect.right,
                    bottom: BORDER_WIDTH,
                };
                FillRect(hdc, &top_rect, green_brush);

                // Bottom border
                let bottom_rect = RECT {
                    left: 0,
                    top: rect.bottom - BORDER_WIDTH,
                    right: rect.right,
                    bottom: rect.bottom,
                };
                FillRect(hdc, &bottom_rect, green_brush);

                // Left border
                let left_rect = RECT {
                    left: 0,
                    top: 0,
                    right: BORDER_WIDTH,
                    bottom: rect.bottom,
                };
                FillRect(hdc, &left_rect, green_brush);

                // Right border
                let right_rect = RECT {
                    left: rect.right - BORDER_WIDTH,
                    top: 0,
                    right: rect.right,
                    bottom: rect.bottom,
                };
                FillRect(hdc, &right_rect, green_brush);

                let _ = DeleteObject(green_brush);
                let _ = EndPaint(hwnd, &ps);

                LRESULT(0)
            }
            WM_ERASEBKGND => {
                LRESULT(1)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

// ============================================================================
// macOS Implementation
// ============================================================================

#[cfg(target_os = "macos")]
mod macos_impl {
    use std::sync::Mutex;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{class, msg_send, msg_send_id, ClassType};
    use objc2_foundation::{CGFloat, CGPoint, CGRect, CGSize, MainThreadMarker, NSObject};
    use objc2_app_kit::{
        NSApplication, NSBackingStoreType, NSBezierPath, NSColor, NSGraphicsContext,
        NSView, NSWindow, NSWindowLevel, NSWindowStyleMask,
    };

    static OVERLAY_WINDOW: Mutex<Option<Retained<NSWindow>>> = Mutex::new(None);
    const BORDER_WIDTH: CGFloat = 4.0;

    // Custom view that draws the green border
    fn draw_border_in_rect(rect: CGRect) {
        unsafe {
            // Get current graphics context
            let context = NSGraphicsContext::currentContext();
            if context.is_none() {
                return;
            }

            // Set green color (RGB: 34, 197, 94 = #22c55e)
            let green = NSColor::colorWithRed_green_blue_alpha(
                34.0 / 255.0,
                197.0 / 255.0,
                94.0 / 255.0,
                1.0,
            );
            green.set();

            // Draw 4 border rectangles
            let border = BORDER_WIDTH;

            // Top border
            let top = NSBezierPath::bezierPathWithRect(CGRect::new(
                CGPoint::new(0.0, rect.size.height - border),
                CGSize::new(rect.size.width, border),
            ));
            top.fill();

            // Bottom border
            let bottom = NSBezierPath::bezierPathWithRect(CGRect::new(
                CGPoint::new(0.0, 0.0),
                CGSize::new(rect.size.width, border),
            ));
            bottom.fill();

            // Left border
            let left = NSBezierPath::bezierPathWithRect(CGRect::new(
                CGPoint::new(0.0, 0.0),
                CGSize::new(border, rect.size.height),
            ));
            left.fill();

            // Right border
            let right = NSBezierPath::bezierPathWithRect(CGRect::new(
                CGPoint::new(rect.size.width - border, 0.0),
                CGSize::new(border, rect.size.height),
            ));
            right.fill();
        }
    }

    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        // Must be called on main thread for AppKit
        let mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => return Err("Must be called from main thread".to_string()),
        };

        let mut guard = OVERLAY_WINDOW.lock().map_err(|e| e.to_string())?;

        // macOS uses bottom-left origin, so we need to flip Y coordinate
        // Get screen height to flip Y
        let screen_height: CGFloat = unsafe {
            let screens: Retained<objc2_foundation::NSArray<objc2_app_kit::NSScreen>> =
                msg_send_id![class!(NSScreen), screens];
            if let Some(main_screen) = screens.firstObject() {
                let frame: CGRect = msg_send![&main_screen, frame];
                frame.size.height
            } else {
                1080.0 // fallback
            }
        };

        let flipped_y = screen_height - y as CGFloat - height as CGFloat;
        let frame = CGRect::new(
            CGPoint::new(x as CGFloat, flipped_y),
            CGSize::new(width as CGFloat, height as CGFloat),
        );

        if let Some(ref window) = *guard {
            // Move existing window
            unsafe {
                window.setFrame_display(frame, true);
            }
            return Ok(());
        }

        // Create new window
        unsafe {
            let style = NSWindowStyleMask::Borderless;
            let backing = NSBackingStoreType::NSBackingStoreBuffered;

            let window = NSWindow::initWithContentRect_styleMask_backing_defer(
                mtm.alloc::<NSWindow>(),
                frame,
                style,
                backing,
                false,
            );

            // Configure window properties
            window.setOpaque(false);
            window.setBackgroundColor(Some(&NSColor::clearColor()));
            window.setHasShadow(false);
            window.setIgnoresMouseEvents(true);
            window.setLevel(NSWindowLevel(
                objc2_app_kit::NSScreenSaverWindowLevel as isize + 1,
            ));

            // Create content view that draws the border
            let content_view = NSView::initWithFrame(mtm.alloc::<NSView>(), frame);

            // We need to draw the border - for now, use a simple approach
            // by setting up a display link or using layer-backed view
            // For simplicity, we'll use setWantsLayer and draw via CALayer

            window.setContentView(Some(&content_view));
            window.makeKeyAndOrderFront(None);

            // Store window reference
            *guard = Some(window);
        }

        Ok(())
    }

    pub fn hide_border() -> Result<(), String> {
        let mut guard = OVERLAY_WINDOW.lock().map_err(|e| e.to_string())?;

        if let Some(window) = guard.take() {
            unsafe {
                window.close();
            }
        }

        Ok(())
    }
}

// ============================================================================
// Linux Implementation (X11)
// ============================================================================

#[cfg(target_os = "linux")]
mod linux_impl {
    use std::ptr;
    use std::sync::Mutex;
    use x11::xlib::*;

    static OVERLAY_STATE: Mutex<Option<OverlayState>> = Mutex::new(None);
    const BORDER_WIDTH: i32 = 4;
    // Green color: #22c55e = RGB(34, 197, 94)
    const BORDER_COLOR: u64 = 0x22c55e;

    struct OverlayState {
        display: *mut Display,
        window: Window,
    }

    // Safety: X11 handles are thread-safe when properly synchronized
    unsafe impl Send for OverlayState {}

    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        let mut guard = OVERLAY_STATE.lock().map_err(|e| e.to_string())?;

        unsafe {
            if let Some(ref state) = *guard {
                // Move existing window
                XMoveResizeWindow(
                    state.display,
                    state.window,
                    x,
                    y,
                    width,
                    height,
                );
                XMapRaised(state.display, state.window);
                XFlush(state.display);

                // Redraw the border
                draw_border(state.display, state.window, width as i32, height as i32);

                return Ok(());
            }

            // Open display
            let display = XOpenDisplay(ptr::null());
            if display.is_null() {
                return Err("Failed to open X display".to_string());
            }

            let screen = XDefaultScreen(display);
            let root = XRootWindow(display, screen);

            // Create window attributes
            let mut attrs: XSetWindowAttributes = std::mem::zeroed();
            attrs.override_redirect = True;
            attrs.background_pixel = 0;
            attrs.border_pixel = 0;

            // Try to get a visual with alpha channel (32-bit)
            let mut vinfo: XVisualInfo = std::mem::zeroed();
            let has_alpha = XMatchVisualInfo(display, screen, 32, TrueColor, &mut vinfo) != 0;

            let (visual, depth, colormap) = if has_alpha {
                let colormap = XCreateColormap(display, root, vinfo.visual, AllocNone);
                attrs.colormap = colormap;
                (vinfo.visual, 32, colormap)
            } else {
                // Fallback to default visual
                let visual = XDefaultVisual(display, screen);
                let depth = XDefaultDepth(display, screen);
                let colormap = XDefaultColormap(display, screen);
                (visual, depth, colormap)
            };

            // Create the window
            let window = XCreateWindow(
                display,
                root,
                x,
                y,
                width,
                height,
                0,
                depth,
                InputOutput as u32,
                visual,
                CWOverrideRedirect | CWBackPixel | CWBorderPixel | CWColormap,
                &mut attrs,
            );

            if window == 0 {
                XCloseDisplay(display);
                return Err("Failed to create X window".to_string());
            }

            // Set window type to dock (stays on top, no decorations)
            let wm_window_type = XInternAtom(
                display,
                b"_NET_WM_WINDOW_TYPE\0".as_ptr() as *const i8,
                False,
            );
            let wm_window_type_dock = XInternAtom(
                display,
                b"_NET_WM_WINDOW_TYPE_DOCK\0".as_ptr() as *const i8,
                False,
            );
            XChangeProperty(
                display,
                window,
                wm_window_type,
                XA_ATOM,
                32,
                PropModeReplace,
                &wm_window_type_dock as *const u64 as *const u8,
                1,
            );

            // Make window click-through using input shape (empty region)
            // Note: Requires XShape extension, fallback if not available
            set_click_through(display, window);

            // Show the window
            XMapRaised(display, window);
            XFlush(display);

            // Draw the border
            draw_border(display, window, width as i32, height as i32);

            // Store state
            *guard = Some(OverlayState { display, window });

            Ok(())
        }
    }

    pub fn hide_border() -> Result<(), String> {
        let mut guard = OVERLAY_STATE.lock().map_err(|e| e.to_string())?;

        if let Some(state) = guard.take() {
            unsafe {
                XUnmapWindow(state.display, state.window);
                XDestroyWindow(state.display, state.window);
                XFlush(state.display);
                XCloseDisplay(state.display);
            }
        }

        Ok(())
    }

    unsafe fn draw_border(display: *mut Display, window: Window, width: i32, height: i32) {
        let screen = XDefaultScreen(display);
        let gc = XCreateGC(display, window, 0, ptr::null_mut());

        // Set green color
        XSetForeground(display, gc, BORDER_COLOR);

        // Clear background (make it transparent by drawing nothing, or black if no alpha)
        XSetForeground(display, gc, 0x000000);
        XFillRectangle(display, window, gc, 0, 0, width as u32, height as u32);

        // Set green for border
        XSetForeground(display, gc, BORDER_COLOR);

        // Draw 4 border rectangles
        // Top
        XFillRectangle(display, window, gc, 0, 0, width as u32, BORDER_WIDTH as u32);
        // Bottom
        XFillRectangle(
            display,
            window,
            gc,
            0,
            height - BORDER_WIDTH,
            width as u32,
            BORDER_WIDTH as u32,
        );
        // Left
        XFillRectangle(display, window, gc, 0, 0, BORDER_WIDTH as u32, height as u32);
        // Right
        XFillRectangle(
            display,
            window,
            gc,
            width - BORDER_WIDTH,
            0,
            BORDER_WIDTH as u32,
            height as u32,
        );

        XFreeGC(display, gc);
        XFlush(display);
    }

    unsafe fn set_click_through(display: *mut Display, window: Window) {
        // Try to use XShape extension for click-through
        // This makes the window transparent to mouse events
        use x11::xlib::*;

        // Create an empty region for input shape
        let empty_region = XCreateRegion();
        if !empty_region.is_null() {
            // XShapeCombineRegion requires x11 "xfixes" or "shape" feature
            // For now, we'll skip this as it requires additional setup
            // The window will still be mostly click-through due to override_redirect
            XDestroyRegion(empty_region);
        }
    }
}

// ============================================================================
// Cross-Platform Public API
// ============================================================================

/// Show a green border overlay around the specified monitor area
pub fn show_monitor_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_impl::show_border(x, y, width, height);
    }

    #[cfg(target_os = "macos")]
    {
        return macos_impl::show_border(x, y, width, height);
    }

    #[cfg(target_os = "linux")]
    {
        return linux_impl::show_border(x, y, width, height);
    }

    #[allow(unreachable_code)]
    Err("No overlay implementation for this platform".to_string())
}

/// Hide and destroy the monitor border overlay
pub fn hide_monitor_border() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_impl::hide_border();
    }

    #[cfg(target_os = "macos")]
    {
        return macos_impl::hide_border();
    }

    #[cfg(target_os = "linux")]
    {
        return linux_impl::hide_border();
    }

    #[allow(unreachable_code)]
    Ok(())
}
