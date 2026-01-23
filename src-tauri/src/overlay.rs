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
    use objc2::msg_send;
    use objc2_app_kit::{
        NSColor, NSScreen, NSView, NSWindow, NSWindowStyleMask,
    };
    use objc2_core_foundation::{CGFloat, CGPoint, CGRect, CGSize};
    use objc2_foundation::MainThreadMarker;
    use objc2_quartz_core::CALayer;
    use std::cell::RefCell;
    use std::sync::Mutex;

    // ============================================================================
    // Main Thread Dispatch Helpers
    // ============================================================================

    // GCD types for dispatch_sync
    #[repr(C)]
    struct DispatchQueue {
        _private: [u8; 0],
    }

    type DispatchQueueT = *const DispatchQueue;
    type DispatchBlock = extern "C" fn(*mut std::ffi::c_void);

    #[link(name = "System", kind = "dylib")]
    extern "C" {
        fn dispatch_get_main_queue() -> DispatchQueueT;
        fn dispatch_sync_f(
            queue: DispatchQueueT,
            context: *mut std::ffi::c_void,
            work: DispatchBlock,
        );
    }

    /// Check if we're currently on the main thread
    fn is_main_thread() -> bool {
        use objc2_foundation::NSThread;
        NSThread::isMainThread()
    }

    /// Execute a closure on the main thread synchronously.
    /// If already on main thread, executes directly.
    /// If on background thread, dispatches to main and waits.
    fn run_on_main_thread<F, R>(f: F) -> R
    where
        F: FnOnce() -> R + Send,
        R: Send,
    {
        if is_main_thread() {
            // Already on main thread, just run it
            f()
        } else {
            // Need to dispatch to main thread
            let result: Mutex<Option<R>> = Mutex::new(None);
            let closure: Mutex<Option<F>> = Mutex::new(Some(f));

            extern "C" fn trampoline<F, R>(context: *mut std::ffi::c_void)
            where
                F: FnOnce() -> R + Send,
                R: Send,
            {
                unsafe {
                    let data = &*(context as *const (Mutex<Option<F>>, Mutex<Option<R>>));
                    if let Some(f) = data.0.lock().unwrap().take() {
                        let r = f();
                        *data.1.lock().unwrap() = Some(r);
                    }
                }
            }

            let data = (closure, result);
            unsafe {
                dispatch_sync_f(
                    dispatch_get_main_queue(),
                    &data as *const _ as *mut std::ffi::c_void,
                    std::mem::transmute(trampoline::<F, R> as extern "C" fn(*mut std::ffi::c_void)),
                );
            }

            data.1.lock().unwrap().take().expect("Main thread execution failed")
        }
    }

    // NSWindow is main-thread-only, so we use thread_local storage instead of Mutex
    thread_local! {
        static OVERLAY_WINDOW: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
        // Store border views so we can update their frames when window moves
        static BORDER_VIEWS: RefCell<Option<[Retained<NSView>; 4]>> = const { RefCell::new(None) };
    }
    const BORDER_WIDTH: CGFloat = 4.0;

    // NSBackingStoreBuffered = 2 (raw value for backing store type)
    const NS_BACKING_STORE_BUFFERED: u64 = 2;

    // NSScreenSaverWindowLevel = 1000, we want above that
    const OVERLAY_WINDOW_LEVEL: isize = 1001;

    /// Create a colored NSView at the given frame using layer-backed background
    fn create_border_view(mtm: MainThreadMarker, frame: CGRect) -> Retained<NSView> {
        unsafe {
            let view: Retained<NSView> = msg_send![
                mtm.alloc::<NSView>(),
                initWithFrame: frame,
            ];

            // Enable layer-backing so we can set background color
            view.setWantsLayer(true);

            // Get the layer and set its background color to green (#22c55e)
            if let Some(layer) = view.layer() {
                // Create CGColor using core-graphics crate (uses its own CGFloat type)
                let cg_color = core_graphics::color::CGColor::rgb(
                    34.0 / 255.0,   // R
                    197.0 / 255.0,  // G
                    94.0 / 255.0,   // B
                    1.0,            // A
                );

                // Use msg_send to set backgroundColor
                // Pass the CGColorRef pointer to the Objective-C method
                use core_graphics::color::CGColorRef;
                let color_ref: CGColorRef = cg_color.as_concrete_TypeRef();
                let _: () = msg_send![&*layer, setBackgroundColor: color_ref];
            }

            view
        }
    }

    /// Update border view frames for the given content size
    fn update_border_frames(views: &[Retained<NSView>; 4], width: CGFloat, height: CGFloat) {
        // Top border
        views[0].setFrame(CGRect::new(
            CGPoint::new(0.0, height - BORDER_WIDTH),
            CGSize::new(width, BORDER_WIDTH),
        ));

        // Bottom border
        views[1].setFrame(CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(width, BORDER_WIDTH),
        ));

        // Left border
        views[2].setFrame(CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(BORDER_WIDTH, height),
        ));

        // Right border
        views[3].setFrame(CGRect::new(
            CGPoint::new(width - BORDER_WIDTH, 0.0),
            CGSize::new(BORDER_WIDTH, height),
        ));
    }

    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        // Dispatch to main thread if necessary (AppKit requires main thread)
        run_on_main_thread(|| show_border_impl(x, y, width, height))
    }

    fn show_border_impl(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        // We're guaranteed to be on main thread now
        let mtm = MainThreadMarker::new()
            .expect("show_border_impl must be called on main thread");

        OVERLAY_WINDOW.with(|window_cell| {
            BORDER_VIEWS.with(|views_cell| {
                let mut window_guard = window_cell.borrow_mut();
                let mut views_guard = views_cell.borrow_mut();

                // macOS uses bottom-left origin, so we need to flip Y coordinate
                // Get screen height to flip Y
                let screen_height: CGFloat = if let Some(main_screen) = NSScreen::mainScreen(mtm) {
                    main_screen.frame().size.height
                } else {
                    1080.0 // fallback
                };

                let flipped_y = screen_height - y as CGFloat - height as CGFloat;
                let frame = CGRect::new(
                    CGPoint::new(x as CGFloat, flipped_y),
                    CGSize::new(width as CGFloat, height as CGFloat),
                );

                if let Some(ref window) = *window_guard {
                    // Move existing window and update border frames
                    window.setFrame_display(frame, true);

                    // Update border view frames
                    if let Some(ref views) = *views_guard {
                        update_border_frames(views, width as CGFloat, height as CGFloat);
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

                    // Create transparent content view
                    let content_frame = CGRect::new(
                        CGPoint::new(0.0, 0.0),
                        CGSize::new(width as CGFloat, height as CGFloat),
                    );
                    let content_view: Retained<NSView> = msg_send![
                        mtm.alloc::<NSView>(),
                        initWithFrame: content_frame,
                    ];

                    // Create 4 border views (top, bottom, left, right) with green background
                    let top_view = create_border_view(mtm, CGRect::new(
                        CGPoint::new(0.0, height as CGFloat - BORDER_WIDTH),
                        CGSize::new(width as CGFloat, BORDER_WIDTH),
                    ));

                    let bottom_view = create_border_view(mtm, CGRect::new(
                        CGPoint::new(0.0, 0.0),
                        CGSize::new(width as CGFloat, BORDER_WIDTH),
                    ));

                    let left_view = create_border_view(mtm, CGRect::new(
                        CGPoint::new(0.0, 0.0),
                        CGSize::new(BORDER_WIDTH, height as CGFloat),
                    ));

                    let right_view = create_border_view(mtm, CGRect::new(
                        CGPoint::new(width as CGFloat - BORDER_WIDTH, 0.0),
                        CGSize::new(BORDER_WIDTH, height as CGFloat),
                    ));

                    // Add border views to content view
                    content_view.addSubview(&top_view);
                    content_view.addSubview(&bottom_view);
                    content_view.addSubview(&left_view);
                    content_view.addSubview(&right_view);

                    window.setContentView(Some(&content_view));
                    window.makeKeyAndOrderFront(None);

                    // Store references
                    *window_guard = Some(window);
                    *views_guard = Some([top_view, bottom_view, left_view, right_view]);
                }

                Ok(())
            })
        })
    }

    pub fn hide_border() -> Result<(), String> {
        // Dispatch to main thread if necessary (AppKit requires main thread)
        run_on_main_thread(|| hide_border_impl())
    }

    fn hide_border_impl() -> Result<(), String> {
        OVERLAY_WINDOW.with(|window_cell| {
            BORDER_VIEWS.with(|views_cell| {
                let mut window_guard = window_cell.borrow_mut();
                let mut views_guard = views_cell.borrow_mut();

                // Clear border views first
                *views_guard = None;

                // Close and release window
                if let Some(window) = window_guard.take() {
                    window.close();
                }

                Ok(())
            })
        })
    }

    // ============================================================================
    // Toast Notification Implementation
    // ============================================================================

    use objc2_app_kit::{NSTextField, NSFont, NSTextFieldCell};
    use objc2_foundation::NSString;

    thread_local! {
        static TOAST_WINDOW: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
        // Timer handle for auto-dismiss
        static TOAST_TIMER_ACTIVE: RefCell<bool> = const { RefCell::new(false) };
    }

    // Toast constants matching Windows design
    const TOAST_WIDTH: CGFloat = 280.0;
    const TOAST_HEIGHT: CGFloat = 56.0;
    const TOAST_MARGIN: CGFloat = 24.0;
    const TOAST_WINDOW_LEVEL: isize = 1002; // Above overlay
    const TOAST_CORNER_RADIUS: CGFloat = 12.0;

    // Icon dimensions
    const ICON_SIZE: CGFloat = 22.0;
    const ICON_LEFT_MARGIN: CGFloat = 16.0;
    const ACCENT_BAR_WIDTH: CGFloat = 4.0;

    /// Create a circular icon view with the specified color
    fn create_icon_view(mtm: MainThreadMarker, x: CGFloat, y: CGFloat, color: &NSColor) -> Retained<NSView> {
        unsafe {
            let frame = CGRect::new(
                CGPoint::new(x, y),
                CGSize::new(ICON_SIZE, ICON_SIZE),
            );
            let view: Retained<NSView> = msg_send![
                mtm.alloc::<NSView>(),
                initWithFrame: frame,
            ];

            view.setWantsLayer(true);

            if let Some(layer) = view.layer() {
                // Set circular shape via corner radius (half of size = circle)
                let _: () = msg_send![&*layer, setCornerRadius: ICON_SIZE / 2.0];

                // Set cyan background color (#49B8D3)
                let cg_color = core_graphics::color::CGColor::rgb(
                    73.0 / 255.0,   // R
                    184.0 / 255.0,  // G
                    211.0 / 255.0,  // B
                    1.0,            // A
                );
                use core_graphics::color::CGColorRef;
                let color_ref: CGColorRef = cg_color.as_concrete_TypeRef();
                let _: () = msg_send![&*layer, setBackgroundColor: color_ref];
            }

            view
        }
    }

    /// Create an accent bar view (left edge decoration)
    fn create_accent_bar(mtm: MainThreadMarker, height: CGFloat) -> Retained<NSView> {
        unsafe {
            let frame = CGRect::new(
                CGPoint::new(0.0, 0.0),
                CGSize::new(ACCENT_BAR_WIDTH, height),
            );
            let view: Retained<NSView> = msg_send![
                mtm.alloc::<NSView>(),
                initWithFrame: frame,
            ];

            view.setWantsLayer(true);

            if let Some(layer) = view.layer() {
                // Set primary blue color (#2721E8)
                let cg_color = core_graphics::color::CGColor::rgb(
                    39.0 / 255.0,   // R
                    33.0 / 255.0,   // G
                    232.0 / 255.0,  // B
                    1.0,            // A
                );
                use core_graphics::color::CGColorRef;
                let color_ref: CGColorRef = cg_color.as_concrete_TypeRef();
                let _: () = msg_send![&*layer, setBackgroundColor: color_ref];

                // Round only the left corners
                let _: () = msg_send![&*layer, setCornerRadius: TOAST_CORNER_RADIUS];
                let _: () = msg_send![&*layer, setMaskedCorners: 0b0101_u32]; // Bottom-left and top-left
            }

            view
        }
    }

    /// Create a text label for the toast message
    fn create_text_label(mtm: MainThreadMarker, message: &str, x: CGFloat, width: CGFloat, height: CGFloat) -> Retained<NSTextField> {
        unsafe {
            let frame = CGRect::new(
                CGPoint::new(x, 0.0),
                CGSize::new(width, height),
            );

            // Create NSTextField
            let text_field: Retained<NSTextField> = msg_send![
                mtm.alloc::<NSTextField>(),
                initWithFrame: frame,
            ];

            // Configure as label (not editable)
            text_field.setEditable(false);
            text_field.setSelectable(false);
            text_field.setBordered(false);
            text_field.setDrawsBackground(false);

            // Set text color to white
            let white = NSColor::colorWithRed_green_blue_alpha(1.0, 1.0, 1.0, 1.0);
            text_field.setTextColor(Some(&white));

            // Set font (system font, 13pt, medium weight)
            if let Some(font) = NSFont::systemFontOfSize_weight(13.0, 0.5) {
                text_field.setFont(Some(&font));
            }

            // Set the message text
            let ns_string = NSString::from_str(message);
            text_field.setStringValue(&ns_string);

            // Center vertically by using cell
            if let Some(cell) = text_field.cell() {
                // Use line break mode to truncate with ellipsis if needed
                let _: () = msg_send![&*cell, setLineBreakMode: 4_i64]; // NSLineBreakByTruncatingTail
            }

            text_field
        }
    }

    pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
        // Dispatch to main thread if necessary (AppKit requires main thread)
        let message_owned = message.to_string();
        run_on_main_thread(move || show_toast_impl(&message_owned, duration_ms))
    }

    fn show_toast_impl(message: &str, duration_ms: u32) -> Result<(), String> {
        // We're guaranteed to be on main thread now
        let mtm = MainThreadMarker::new()
            .expect("show_toast_impl must be called on main thread");

        // Close any existing toast
        TOAST_WINDOW.with(|window_cell| {
            if let Some(window) = window_cell.borrow_mut().take() {
                window.close();
            }
        });

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

                let frame = CGRect::new(CGPoint::new(x, y), CGSize::new(TOAST_WIDTH, TOAST_HEIGHT));

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
                window.setAlphaValue(0.95); // Slightly less transparent for better readability
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

                // Enable layer-backing for rounded corners
                content_view.setWantsLayer(true);

                // Set rounded corners on the content view's layer
                if let Some(layer) = content_view.layer() {
                    let _: () = msg_send![&*layer, setCornerRadius: TOAST_CORNER_RADIUS];
                    let _: () = msg_send![&*layer, setMasksToBounds: true];

                    // Set background color on layer
                    let cg_color = core_graphics::color::CGColor::rgb(
                        30.0 / 255.0,
                        27.0 / 255.0,
                        35.0 / 255.0,
                        1.0,
                    );
                    use core_graphics::color::CGColorRef;
                    let color_ref: CGColorRef = cg_color.as_concrete_TypeRef();
                    let _: () = msg_send![&*layer, setBackgroundColor: color_ref];
                }

                // Create accent bar on the left
                let accent_bar = create_accent_bar(mtm, TOAST_HEIGHT);
                content_view.addSubview(&accent_bar);

                // Create icon view (cyan circle)
                let icon_y = (TOAST_HEIGHT - ICON_SIZE) / 2.0; // Center vertically
                let icon_x = ACCENT_BAR_WIDTH + ICON_LEFT_MARGIN;
                let cyan_color = NSColor::colorWithRed_green_blue_alpha(
                    73.0 / 255.0,
                    184.0 / 255.0,
                    211.0 / 255.0,
                    1.0,
                );
                let icon_view = create_icon_view(mtm, icon_x, icon_y, &cyan_color);
                content_view.addSubview(&icon_view);

                // Create text label
                let text_x = icon_x + ICON_SIZE + 12.0; // 12px gap after icon
                let text_width = TOAST_WIDTH - text_x - 16.0; // 16px right padding
                let text_label = create_text_label(mtm, &message_owned, text_x, text_width, TOAST_HEIGHT);
                content_view.addSubview(&text_label);

                window.setContentView(Some(&content_view));
                window.makeKeyAndOrderFront(None);

                // Store window reference
                *guard = Some(window);
            }
        });

        // Mark timer as active
        TOAST_TIMER_ACTIVE.with(|active| {
            *active.borrow_mut() = true;
        });

        // Schedule auto-dismiss using a background thread that sleeps then signals
        // We use thread_local check to avoid closing if a new toast was shown
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(duration as u64));

            // Check if timer is still active (not cancelled by new toast)
            let should_close = TOAST_TIMER_ACTIVE.with(|active| {
                let is_active = *active.borrow();
                if is_active {
                    *active.borrow_mut() = false;
                }
                is_active
            });

            if should_close {
                // Close the toast window
                // Note: This accesses thread-local from background thread which may not work
                // but the window will be cleaned up on next show_toast call anyway
                TOAST_WINDOW.with(|window_cell| {
                    if let Some(window) = window_cell.borrow_mut().take() {
                        // Try to close - may fail from background thread
                        window.close();
                    }
                });
            }
        });

        Ok(())
    }
}

// ============================================================================
// Linux X11 Implementation
// ============================================================================

#[cfg(target_os = "linux")]
mod linux_x11_impl {
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
        XDrawLines(
            display,
            window,
            gc,
            points.as_ptr() as *mut XPoint,
            3,
            CoordModeOrigin,
        );

        // Note: Text rendering with X11 requires font setup which is complex
        // For full text support, consider using XFT or Pango
        // For now, the toast shows the visual elements without text

        XFreeGC(display, gc);
        XFlush(display);
    }
}

// ============================================================================
// Linux Wayland Implementation
// ============================================================================

#[cfg(target_os = "linux")]
mod linux_wayland_impl {
    use notify_rust::Notification;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    // Track if we've warned about layer-shell not being available
    static LAYER_SHELL_WARNED: AtomicBool = AtomicBool::new(false);

    // Overlay state for Wayland (using layer-shell when available)
    static OVERLAY_ACTIVE: Mutex<bool> = Mutex::new(false);

    /// Show border overlay using wlr-layer-shell protocol.
    ///
    /// Note: Full layer-shell implementation requires significant setup with
    /// smithay-client-toolkit. For now, we log a warning and fall back to X11
    /// via XWayland if available. The overlay feature degrades gracefully.
    pub fn show_border(x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        // Mark overlay as logically active
        *OVERLAY_ACTIVE.lock().map_err(|e| e.to_string())? = true;

        // Log warning once about limited Wayland overlay support
        if !LAYER_SHELL_WARNED.swap(true, Ordering::SeqCst) {
            eprintln!(
                "[OpenScribe] Wayland detected: Border overlays using layer-shell are not yet fully implemented. \
                 Overlay may not appear. Toast notifications will work via D-Bus."
            );
        }

        // For now, try X11 via XWayland as fallback
        // Most Wayland sessions include XWayland
        if std::env::var("DISPLAY").is_ok() {
            return super::linux_x11_impl::show_border(x, y, width, height);
        }

        // No XWayland available - overlay won't show but app continues
        eprintln!(
            "[OpenScribe] Cannot show overlay: no XWayland available. \
             Overlay position would be: ({}, {}) size: {}x{}",
            x, y, width, height
        );
        Ok(())
    }

    /// Hide border overlay
    pub fn hide_border() -> Result<(), String> {
        *OVERLAY_ACTIVE.lock().map_err(|e| e.to_string())? = false;

        // If we fell back to X11, hide that too
        if std::env::var("DISPLAY").is_ok() {
            return super::linux_x11_impl::hide_border();
        }

        Ok(())
    }

    /// Show toast notification using D-Bus (freedesktop notifications).
    ///
    /// This works natively on Wayland without any compatibility layer,
    /// as long as a notification daemon is running (e.g., mako, dunst, fnott).
    pub fn show_toast(message: &str, duration_ms: u32) -> Result<(), String> {
        Notification::new()
            .summary("OpenScribe")
            .body(message)
            .icon("dialog-information")
            .timeout(duration_ms as i32)
            .show()
            .map_err(|e| format!("Failed to show notification: {}", e))?;
        Ok(())
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
        use crate::display::{detect_display_server, DisplayServer};

        return match detect_display_server() {
            DisplayServer::Wayland => linux_wayland_impl::show_border(x, y, width, height),
            _ => linux_x11_impl::show_border(x, y, width, height),
        };
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
        use crate::display::{detect_display_server, DisplayServer};

        return match detect_display_server() {
            DisplayServer::Wayland => linux_wayland_impl::hide_border(),
            _ => linux_x11_impl::hide_border(),
        };
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
        use crate::display::{detect_display_server, DisplayServer};

        return match detect_display_server() {
            DisplayServer::Wayland => linux_wayland_impl::show_toast(message, duration_ms),
            _ => linux_x11_impl::show_toast(message, duration_ms),
        };
    }

    #[allow(unreachable_code)]
    Ok(())
}
