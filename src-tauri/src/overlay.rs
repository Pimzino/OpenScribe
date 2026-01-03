//! Native overlay module for drawing monitor highlight borders
//! Uses platform-specific APIs to bypass Tauri's broken webview transparency

// ============================================================================
// Windows Implementation
// ============================================================================

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::Mutex;
    use windows::core::w;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static CLASS_REGISTERED: AtomicBool = AtomicBool::new(false);
    static TOAST_CLASS_REGISTERED: AtomicBool = AtomicBool::new(false);
    static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
    static TOAST_HWND: AtomicIsize = AtomicIsize::new(0);
    static TOAST_MESSAGE: Mutex<String> = Mutex::new(String::new());
    const BORDER_WIDTH: i32 = 4;
    const BORDER_COLOR: COLORREF = COLORREF(0x005EC722); // BGR format: green #22c55e
                                                         // Toast colors matching app design system
    const TOAST_BG_COLOR: COLORREF = COLORREF(0x00231B1E); // BGR: rgb(30, 27, 35) - glass-surface-2
    const TOAST_BORDER_COLOR: COLORREF = COLORREF(0x002A2A2A); // Subtle border
    const TOAST_TEXT_COLOR: COLORREF = COLORREF(0x00FFFFFF); // White text
    const TOAST_ACCENT_COLOR: COLORREF = COLORREF(0x00D3B849); // BGR: #49B8D3 - cyan accent
    const TOAST_PRIMARY_COLOR: COLORREF = COLORREF(0x00E82127); // BGR: #2721E8 - primary blue

    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        unsafe {
            let existing = OVERLAY_HWND.load(Ordering::SeqCst);
            if existing != 0 {
                let hwnd = HWND(existing as *mut std::ffi::c_void);

                // Check if window is still valid
                if !IsWindow(hwnd).as_bool() {
                    // Window was destroyed externally, reset the handle
                    OVERLAY_HWND.store(0, Ordering::SeqCst);
                    // Fall through to create a new window
                } else {
                    // Move existing window
                    SetWindowPos(
                        hwnd,
                        HWND_TOPMOST,
                        x,
                        y,
                        width as i32,
                        height as i32,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    )
                    .map_err(|e| format!("SetWindowPos failed: {}", e))?;

                    let _ = InvalidateRect(hwnd, None, TRUE);
                    let _ = UpdateWindow(hwnd);
                    return Ok(());
                }
            }

            // Register window class if not already done
            if !CLASS_REGISTERED.load(Ordering::SeqCst) {
                register_class()?;
                CLASS_REGISTERED.store(true, Ordering::SeqCst);
            }

            // Create the overlay window
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_TOPMOST
                    | WS_EX_TOOLWINDOW
                    | WS_EX_NOACTIVATE,
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
            )
            .map_err(|e| format!("CreateWindowExW failed: {}", e))?;

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

                // Check if window is still valid
                if IsWindow(hwnd).as_bool() {
                    // Hide the window immediately
                    let _ = ShowWindow(hwnd, SW_HIDE);

                    // Force the window off screen as backup
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_BOTTOM,
                        -10000,
                        -10000,
                        1,
                        1,
                        SWP_NOACTIVATE | SWP_HIDEWINDOW,
                    );

                    // Process any pending messages for this window
                    let mut msg = MSG::default();
                    while PeekMessageW(&mut msg, hwnd, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }

                    // Destroy the window
                    let _ = DestroyWindow(hwnd);
                }
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
            WM_ERASEBKGND => LRESULT(1),
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    // ============================================================================
    // Toast Window Implementation
    // ============================================================================

    const TOAST_WIDTH: i32 = 280;
    const TOAST_HEIGHT: i32 = 56;
    const TOAST_MARGIN: i32 = 24;
    const WM_TOAST_CLOSE: u32 = WM_USER + 1;

    pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
        // Store message for painting
        if let Ok(mut msg) = TOAST_MESSAGE.lock() {
            *msg = message.to_string();
        }

        let duration = duration_ms;

        // Spawn a dedicated thread with its own message loop
        std::thread::spawn(move || {
            unsafe {
                // Register toast window class if not already done
                if !TOAST_CLASS_REGISTERED.swap(true, Ordering::SeqCst) {
                    if let Err(e) = register_toast_class() {
                        eprintln!("Failed to register toast class: {}", e);
                        return;
                    }
                }

                // Get primary monitor work area (excludes taskbar)
                let mut work_area = RECT::default();
                if SystemParametersInfoW(
                    SPI_GETWORKAREA,
                    0,
                    Some(&mut work_area as *mut _ as *mut std::ffi::c_void),
                    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
                )
                .is_err()
                {
                    work_area.right = GetSystemMetrics(SM_CXSCREEN);
                    work_area.bottom = GetSystemMetrics(SM_CYSCREEN);
                }

                // Position in bottom-right corner
                let x = work_area.right - TOAST_WIDTH - TOAST_MARGIN;
                let y = work_area.bottom - TOAST_HEIGHT - TOAST_MARGIN;

                // Create the toast window
                let hwnd = match CreateWindowExW(
                    WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    w!("OpenScribeToast"),
                    w!(""),
                    WS_POPUP | WS_VISIBLE,
                    x,
                    y,
                    TOAST_WIDTH,
                    TOAST_HEIGHT,
                    HWND::default(),
                    HMENU::default(),
                    HINSTANCE::default(),
                    None,
                ) {
                    Ok(h) if !h.0.is_null() => h,
                    _ => {
                        eprintln!("Failed to create toast window");
                        return;
                    }
                };

                // Store the handle
                TOAST_HWND.store(hwnd.0 as isize, Ordering::SeqCst);

                // Set layered window with alpha (semi-transparent)
                let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 230, LWA_ALPHA);

                // Force initial paint
                let _ = InvalidateRect(hwnd, None, TRUE);
                let _ = UpdateWindow(hwnd);

                // Set a timer to close the toast (timer ID = 100)
                const TOAST_TIMER_ID: usize = 100;
                SetTimer(hwnd, TOAST_TIMER_ID, duration, None);

                // Run message loop
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                    // Check for our specific timer
                    if msg.message == WM_TIMER && msg.wParam.0 == TOAST_TIMER_ID {
                        // Timer fired, destroy window and exit loop
                        let _ = KillTimer(hwnd, TOAST_TIMER_ID);
                        let _ = DestroyWindow(hwnd);
                        TOAST_HWND.store(0, Ordering::SeqCst);
                        break;
                    }
                    if msg.message == WM_TOAST_CLOSE {
                        let _ = KillTimer(hwnd, TOAST_TIMER_ID);
                        let _ = DestroyWindow(hwnd);
                        TOAST_HWND.store(0, Ordering::SeqCst);
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });

        Ok(())
    }

    fn register_toast_class() -> Result<(), String> {
        unsafe {
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(toast_window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: HINSTANCE::default(),
                hIcon: HICON::default(),
                hCursor: LoadCursorW(HINSTANCE::default(), IDC_ARROW).unwrap_or_default(),
                hbrBackground: HBRUSH::default(),
                lpszMenuName: windows::core::PCWSTR::null(),
                lpszClassName: w!("OpenScribeToast"),
                hIconSm: HICON::default(),
            };

            let result = RegisterClassExW(&wc);
            if result == 0 {
                return Err("RegisterClassExW for toast failed".to_string());
            }
            Ok(())
        }
    }

    unsafe extern "system" fn toast_window_proc(
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

                // Draw rounded rectangle background (glass-surface-2 style)
                let bg_brush = CreateSolidBrush(TOAST_BG_COLOR);
                let round_rect = CreateRoundRectRgn(0, 0, rect.right + 1, rect.bottom + 1, 16, 16);
                let _ = FillRgn(hdc, round_rect, bg_brush);
                let _ = DeleteObject(bg_brush);

                // Draw subtle border
                let border_pen = CreatePen(PS_SOLID, 1, TOAST_BORDER_COLOR);
                let old_pen = SelectObject(hdc, border_pen);
                let null_brush = GetStockObject(NULL_BRUSH);
                let old_brush = SelectObject(hdc, null_brush);
                let _ = RoundRect(hdc, 0, 0, rect.right, rect.bottom, 16, 16);
                SelectObject(hdc, old_brush);
                SelectObject(hdc, old_pen);
                let _ = DeleteObject(border_pen);
                let _ = DeleteObject(round_rect);

                // Draw primary color accent bar on left (matching app's left border accent)
                let accent_brush = CreateSolidBrush(TOAST_PRIMARY_COLOR);
                let accent_rgn = CreateRoundRectRgn(0, 0, 5, rect.bottom + 1, 4, 4);
                let _ = FillRgn(hdc, accent_rgn, accent_brush);
                let _ = DeleteObject(accent_rgn);
                let _ = DeleteObject(accent_brush);

                // Draw cyan checkmark icon (matching app's cyan accent)
                let icon_x = 18;
                let icon_y = (rect.bottom / 2) - 10;
                let icon_brush = CreateSolidBrush(TOAST_ACCENT_COLOR);
                let icon_rgn = CreateEllipticRgn(icon_x, icon_y, icon_x + 22, icon_y + 22);
                let _ = FillRgn(hdc, icon_rgn, icon_brush);
                let _ = DeleteObject(icon_rgn);
                let _ = DeleteObject(icon_brush);

                // Draw checkmark inside the circle (dark color for contrast)
                let check_pen = CreatePen(PS_SOLID, 2, TOAST_BG_COLOR);
                let old_pen2 = SelectObject(hdc, check_pen);
                let _ = MoveToEx(hdc, icon_x + 6, icon_y + 11, None);
                let _ = LineTo(hdc, icon_x + 10, icon_y + 15);
                let _ = LineTo(hdc, icon_x + 16, icon_y + 7);
                SelectObject(hdc, old_pen2);
                let _ = DeleteObject(check_pen);

                // Draw text
                SetBkMode(hdc, TRANSPARENT);
                SetTextColor(hdc, TOAST_TEXT_COLOR);

                // Create font (matching Space Grotesk style - using Segoe UI as fallback)
                let font = CreateFontW(
                    15,
                    0,
                    0,
                    0,
                    FW_MEDIUM.0 as i32,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET.0 as u32,
                    OUT_DEFAULT_PRECIS.0 as u32,
                    CLIP_DEFAULT_PRECIS.0 as u32,
                    CLEARTYPE_QUALITY.0 as u32,
                    DEFAULT_PITCH.0 as u32 | FF_SWISS.0 as u32,
                    w!("Segoe UI"),
                );
                let old_font = SelectObject(hdc, font);

                // Get message text
                let message = TOAST_MESSAGE.lock().map(|m| m.clone()).unwrap_or_default();
                let mut text: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();

                let mut text_rect = RECT {
                    left: 50,
                    top: 0,
                    right: rect.right - 16,
                    bottom: rect.bottom,
                };
                DrawTextW(
                    hdc,
                    &mut text,
                    &mut text_rect,
                    DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS,
                );

                SelectObject(hdc, old_font);
                let _ = DeleteObject(font);

                let _ = EndPaint(hwnd, &ps);
                LRESULT(0)
            }
            WM_ERASEBKGND => LRESULT(1),
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

// ============================================================================
// macOS Implementation
// ============================================================================

#[cfg(target_os = "macos")]
mod macos_impl {
    use objc2::rc::Retained;
    use objc2::{msg_send, MainThreadOnly};
    use objc2_app_kit::{
        NSBezierPath, NSColor, NSGraphicsContext, NSScreen, NSView, NSWindow, NSWindowStyleMask,
    };
    use objc2_core_foundation::{CGFloat, CGPoint, CGRect, CGSize};
    use objc2_foundation::MainThreadMarker;
    use std::cell::RefCell;

    // NSWindow is main-thread-only, so we use thread_local storage instead of Mutex
    thread_local! {
        static OVERLAY_WINDOW: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
    }
    const BORDER_WIDTH: CGFloat = 4.0;

    // NSBackingStoreBuffered = 2 (raw value for backing store type)
    const NS_BACKING_STORE_BUFFERED: u64 = 2;

    // NSScreenSaverWindowLevel = 1000, we want above that
    const OVERLAY_WINDOW_LEVEL: isize = 1001;

    // Custom view that draws the green border
    #[allow(dead_code)]
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

        OVERLAY_WINDOW.with(|window_cell| {
            let mut guard = window_cell.borrow_mut();

            // macOS uses bottom-left origin, so we need to flip Y coordinate
            // Get screen height to flip Y
            let screen_height: CGFloat = unsafe {
                if let Some(main_screen) = NSScreen::mainScreen(mtm) {
                    main_screen.frame().size.height
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

            // Create new window using MainThreadOnly alloc pattern
            unsafe {
                let style = NSWindowStyleMask::Borderless;

                // Use mtm.alloc() for main-thread-only types
                let window: Retained<NSWindow> = msg_send![
                    mtm.alloc::<NSWindow>(),
                    initWithContentRect: frame,
                    styleMask: style,
                    backing: NS_BACKING_STORE_BUFFERED,
                    defer: false,
                ];

                // Configure window properties
                window.setOpaque(false);
                window.setBackgroundColor(Some(&NSColor::clearColor()));
                window.setHasShadow(false);
                window.setIgnoresMouseEvents(true);
                window.setLevel(OVERLAY_WINDOW_LEVEL);

                // Create content view that draws the border
                let content_view: Retained<NSView> = msg_send![
                    mtm.alloc::<NSView>(),
                    initWithFrame: frame,
                ];

                // We need to draw the border - for now, use a simple approach
                // by setting up a display link or using layer-backed view
                // For simplicity, we'll use setWantsLayer and draw via CALayer

                window.setContentView(Some(&content_view));
                window.makeKeyAndOrderFront(None);

                // Store window reference
                *guard = Some(window);
            }

            Ok(())
        })
    }

    pub fn hide_border() -> Result<(), String> {
        OVERLAY_WINDOW.with(|window_cell| {
            let mut guard = window_cell.borrow_mut();

            if let Some(window) = guard.take() {
                window.close();
            }

            Ok(())
        })
    }

    // ============================================================================
    // Toast Notification Implementation
    // ============================================================================

    thread_local! {
        static TOAST_WINDOW: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
    }

    // Toast constants matching Windows design
    const TOAST_WIDTH: CGFloat = 280.0;
    const TOAST_HEIGHT: CGFloat = 56.0;
    const TOAST_MARGIN: CGFloat = 24.0;
    const TOAST_WINDOW_LEVEL: isize = 1002; // Above overlay

    pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
        // Must be called on main thread for AppKit
        let mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => {
                // If not on main thread, we need to dispatch to main thread
                // For now, just return Ok - the toast will be skipped
                eprintln!("Toast must be shown from main thread");
                return Ok(());
            }
        };

        // Close any existing toast
        TOAST_WINDOW.with(|window_cell| {
            if let Some(window) = window_cell.borrow_mut().take() {
                window.close();
            }
        });

        let _message = message.to_string(); // Reserved for future text rendering
        let duration = duration_ms;

        TOAST_WINDOW.with(|window_cell| {
            let mut guard = window_cell.borrow_mut();

            unsafe {
                // Get screen dimensions for positioning
                let screen_frame = if let Some(main_screen) = NSScreen::mainScreen(mtm) {
                    main_screen.visibleFrame()
                } else {
                    CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1920.0, 1080.0))
                };

                // Position in bottom-right corner (macOS uses bottom-left origin)
                let x = screen_frame.origin.x + screen_frame.size.width - TOAST_WIDTH - TOAST_MARGIN;
                let y = screen_frame.origin.y + TOAST_MARGIN;

                let frame = CGRect::new(
                    CGPoint::new(x, y),
                    CGSize::new(TOAST_WIDTH, TOAST_HEIGHT),
                );

                // Create window
                let style = NSWindowStyleMask::Borderless;
                let window: Retained<NSWindow> = msg_send![
                    mtm.alloc::<NSWindow>(),
                    initWithContentRect: frame,
                    styleMask: style,
                    backing: NS_BACKING_STORE_BUFFERED,
                    defer: false,
                ];

                // Configure window properties
                window.setOpaque(false);
                window.setAlphaValue(0.9); // Semi-transparent
                window.setHasShadow(true);
                window.setIgnoresMouseEvents(true);
                window.setLevel(TOAST_WINDOW_LEVEL);

                // Create background color (glass-surface-2: rgb(30, 27, 35))
                let bg_color = NSColor::colorWithRed_green_blue_alpha(
                    30.0 / 255.0,
                    27.0 / 255.0,
                    35.0 / 255.0,
                    1.0,
                );
                window.setBackgroundColor(Some(&bg_color));

                // Create content view
                let content_frame = CGRect::new(
                    CGPoint::new(0.0, 0.0),
                    CGSize::new(TOAST_WIDTH, TOAST_HEIGHT),
                );
                let content_view: Retained<NSView> = msg_send![
                    mtm.alloc::<NSView>(),
                    initWithFrame: content_frame,
                ];

                // Enable layer-backing
                content_view.setWantsLayer(true);
                // Note: Rounded corners would require objc2-quartz-core CALayer features
                // For now, toast will have square corners

                window.setContentView(Some(&content_view));
                window.makeKeyAndOrderFront(None);

                // Store window reference
                *guard = Some(window);
            }

            Ok(())
        })?;

        // Schedule auto-dismiss using a background thread
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(duration as u64));

            // Need to dispatch back to main thread to close the window
            // Since we can't easily dispatch to main thread from here,
            // we'll use a simple approach: just mark for cleanup
            // The window will be cleaned up on next toast or app can call hide
            TOAST_WINDOW.with(|window_cell| {
                if let Some(window) = window_cell.borrow_mut().take() {
                    // This may not work from background thread, but try anyway
                    window.close();
                }
            });
        });

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
                XMoveResizeWindow(state.display, state.window, x, y, width, height);
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
        XFillRectangle(
            display,
            window,
            gc,
            0,
            0,
            BORDER_WIDTH as u32,
            height as u32,
        );
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

    // ============================================================================
    // Toast Notification Implementation
    // ============================================================================

    static TOAST_STATE: Mutex<Option<ToastState>> = Mutex::new(None);

    // Toast constants matching Windows design
    const TOAST_WIDTH: u32 = 280;
    const TOAST_HEIGHT: u32 = 56;
    const TOAST_MARGIN: i32 = 24;

    // Colors (RGB format for X11)
    const TOAST_BG_COLOR: u64 = 0x1E1B23; // rgb(30, 27, 35) - glass-surface-2
    const TOAST_ACCENT_COLOR: u64 = 0x2721E8; // rgb(39, 33, 232) - primary blue
    const TOAST_ICON_COLOR: u64 = 0x49B8D3; // rgb(73, 184, 211) - cyan accent
    const TOAST_TEXT_COLOR: u64 = 0xFFFFFF; // white

    struct ToastState {
        display: *mut Display,
        window: Window,
    }

    // Safety: X11 handles are thread-safe when properly synchronized
    unsafe impl Send for ToastState {}

    pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
        // Close any existing toast first
        hide_toast()?;

        let message_owned = message.to_string();
        let duration = duration_ms;

        // Create toast in a new thread to avoid blocking
        std::thread::spawn(move || {
            if let Err(e) = show_toast_internal(&message_owned, duration) {
                eprintln!("Failed to show toast: {}", e);
            }
        });

        Ok(())
    }

    fn show_toast_internal(message: &str, duration_ms: u32) -> Result<(), String> {
        let mut guard = TOAST_STATE.lock().map_err(|e| e.to_string())?;

        unsafe {
            // Open display
            let display = XOpenDisplay(ptr::null());
            if display.is_null() {
                return Err("Failed to open X display".to_string());
            }

            let screen = XDefaultScreen(display);
            let root = XRootWindow(display, screen);

            // Get screen dimensions for positioning
            let screen_width = XDisplayWidth(display, screen);
            let screen_height = XDisplayHeight(display, screen);

            // Position in bottom-right corner
            let x = screen_width - TOAST_WIDTH as i32 - TOAST_MARGIN;
            let y = screen_height - TOAST_HEIGHT as i32 - TOAST_MARGIN;

            // Create window attributes
            let mut attrs: XSetWindowAttributes = std::mem::zeroed();
            attrs.override_redirect = True;
            attrs.background_pixel = TOAST_BG_COLOR;
            attrs.border_pixel = 0;

            // Try to get a visual with alpha channel (32-bit)
            let mut vinfo: XVisualInfo = std::mem::zeroed();
            let has_alpha = XMatchVisualInfo(display, screen, 32, TrueColor, &mut vinfo) != 0;

            let (visual, depth, colormap) = if has_alpha {
                let colormap = XCreateColormap(display, root, vinfo.visual, AllocNone);
                attrs.colormap = colormap;
                (vinfo.visual, 32, colormap)
            } else {
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
                TOAST_WIDTH,
                TOAST_HEIGHT,
                0,
                depth,
                InputOutput as u32,
                visual,
                CWOverrideRedirect | CWBackPixel | CWBorderPixel | CWColormap,
                &mut attrs,
            );

            if window == 0 {
                XCloseDisplay(display);
                return Err("Failed to create toast window".to_string());
            }

            // Set window type to notification (stays on top, no decorations)
            let wm_window_type = XInternAtom(
                display,
                b"_NET_WM_WINDOW_TYPE\0".as_ptr() as *const i8,
                False,
            );
            let wm_window_type_notification = XInternAtom(
                display,
                b"_NET_WM_WINDOW_TYPE_NOTIFICATION\0".as_ptr() as *const i8,
                False,
            );
            XChangeProperty(
                display,
                window,
                wm_window_type,
                XA_ATOM,
                32,
                PropModeReplace,
                &wm_window_type_notification as *const u64 as *const u8,
                1,
            );

            // Make window click-through
            set_click_through(display, window);

            // Show the window
            XMapRaised(display, window);
            XFlush(display);

            // Draw toast content
            draw_toast(display, window, message);

            // Store state
            *guard = Some(ToastState { display, window });

            // Release lock before sleeping
            drop(guard);

            // Wait for duration
            std::thread::sleep(std::time::Duration::from_millis(duration_ms as u64));

            // Close the toast
            let _ = hide_toast();
        }

        Ok(())
    }

    fn hide_toast() -> Result<(), String> {
        let mut guard = TOAST_STATE.lock().map_err(|e| e.to_string())?;

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

    unsafe fn draw_toast(display: *mut Display, window: Window, _message: &str) {
        let gc = XCreateGC(display, window, 0, ptr::null_mut());

        // Fill background
        XSetForeground(display, gc, TOAST_BG_COLOR);
        XFillRectangle(display, window, gc, 0, 0, TOAST_WIDTH, TOAST_HEIGHT);

        // Draw accent bar on left (4px wide)
        XSetForeground(display, gc, TOAST_ACCENT_COLOR);
        XFillRectangle(display, window, gc, 0, 0, 4, TOAST_HEIGHT);

        // Draw icon circle (cyan)
        XSetForeground(display, gc, TOAST_ICON_COLOR);
        // X11 doesn't have native circle drawing, use XFillArc
        // Arc: x, y, width, height, angle1 (in 64ths of degree), angle2
        XFillArc(display, window, gc, 16, 17, 22, 22, 0, 360 * 64);

        // Draw checkmark inside circle (dark background color for contrast)
        XSetForeground(display, gc, TOAST_BG_COLOR);
        XSetLineAttributes(display, gc, 2, LineSolid, CapRound, JoinRound);
        // Checkmark path: start at (22, 28), to (26, 32), to (34, 24)
        let points = [
            XPoint { x: 22, y: 28 },
            XPoint { x: 26, y: 32 },
            XPoint { x: 34, y: 24 },
        ];
        XDrawLines(display, window, gc, points.as_ptr() as *mut XPoint, 3, CoordModeOrigin);

        // Note: Text rendering with X11 requires font setup which is complex
        // For full text support, consider using XFT or Pango
        // For now, the toast shows the visual elements without text

        XFreeGC(display, gc);
        XFlush(display);
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

/// Show a native toast notification
pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_impl::show_toast(message, duration_ms);
    }

    #[cfg(target_os = "macos")]
    {
        return macos_impl::show_toast(message, duration_ms);
    }

    #[cfg(target_os = "linux")]
    {
        return linux_impl::show_toast(message, duration_ms);
    }

    #[allow(unreachable_code)]
    Ok(())
}
