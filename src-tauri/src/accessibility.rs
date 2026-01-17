// Cross-platform accessibility API for getting UI element info at coordinates

#[derive(Clone, serde::Serialize, Debug)]
pub struct ElementInfo {
    pub name: String,
    pub element_type: String,
    pub value: Option<String>,
    pub app_name: Option<String>,
}

impl Default for ElementInfo {
    fn default() -> Self {
        Self {
            name: String::new(),
            element_type: String::new(),
            value: None,
            app_name: None,
        }
    }
}

// Windows implementation using UI Automation
#[cfg(target_os = "windows")]
pub fn get_element_at_point(x: f64, y: f64) -> Option<ElementInfo> {
    use windows::Win32::System::Com::{CoInitializeEx, CoCreateInstance, COINIT_MULTITHREADED, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};
    use windows::Win32::Foundation::POINT;

    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        // Create UI Automation instance
        let automation: IUIAutomation = match CoCreateInstance(
            &CUIAutomation,
            None,
            CLSCTX_INPROC_SERVER,
        ) {
            Ok(a) => a,
            Err(_) => return None,
        };

        // Get element at point
        let point = POINT { x: x as i32, y: y as i32 };
        let element = match automation.ElementFromPoint(point) {
            Ok(e) => e,
            Err(_) => return None,
        };

        // Get element properties using direct methods
        let name = element.CurrentName().ok()
            .map(|s| s.to_string())
            .unwrap_or_default();

        let element_type = element.CurrentLocalizedControlType().ok()
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Value pattern is more complex, skip for now
        let value = None;

        // Try to get app name by walking up to root
        let app_name = if let Ok(walker) = automation.ControlViewWalker() {
            let mut current = element.clone();
            let mut root_name = None;
            for _ in 0..10 {
                if let Ok(parent) = walker.GetParentElement(&current) {
                    if let Ok(n) = parent.CurrentName() {
                        let s = n.to_string();
                        if !s.is_empty() {
                            root_name = Some(s);
                        }
                    }
                    current = parent;
                } else {
                    break;
                }
            }
            root_name
        } else {
            None
        };

        Some(ElementInfo {
            name,
            element_type,
            value,
            app_name,
        })
    }
}

// macOS implementation using Accessibility API
#[cfg(target_os = "macos")]
pub fn get_element_at_point(x: f64, y: f64) -> Option<ElementInfo> {
    use core_foundation::base::CFRelease;
    use std::ptr;

    // macOS accessibility requires AXUIElementCopyElementAtPosition
    // This is a simplified implementation - full implementation would use objc crate

    unsafe {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXUIElementCreateSystemWide() -> *mut std::ffi::c_void;
            fn AXUIElementCopyElementAtPosition(
                element: *mut std::ffi::c_void,
                x: f32,
                y: f32,
                element_at_position: *mut *mut std::ffi::c_void,
            ) -> i32;
            // Reserved for future use when we implement full attribute reading
            #[allow(dead_code)]
            fn AXUIElementCopyAttributeValue(
                element: *mut std::ffi::c_void,
                attribute: *const std::ffi::c_void,
                value: *mut *mut std::ffi::c_void,
            ) -> i32;
        }

        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return None;
        }

        let mut element_at_pos: *mut std::ffi::c_void = ptr::null_mut();
        let result = AXUIElementCopyElementAtPosition(
            system_wide,
            x as f32,
            y as f32,
            &mut element_at_pos,
        );

        CFRelease(system_wide as *const _);

        if result != 0 || element_at_pos.is_null() {
            return None;
        }

        // Get attributes - simplified, would need proper CFString handling
        // For now return basic info
        CFRelease(element_at_pos as *const _);

        Some(ElementInfo {
            name: "UI Element".to_string(),
            element_type: "unknown".to_string(),
            value: None,
            app_name: None,
        })
    }
}

// Linux implementation using AT-SPI
#[cfg(target_os = "linux")]
pub fn get_element_at_point(x: f64, y: f64) -> Option<ElementInfo> {
    // AT-SPI requires async runtime, simplified sync wrapper
    use std::process::Command;

    // Use gdbus or similar to query AT-SPI
    // This is a placeholder - full implementation would use atspi crate
    let output = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest=org.a11y.atspi.Registry",
            "--object-path=/org/a11y/atspi/accessible/root",
            "--method=org.a11y.atspi.Component.GetAccessibleAtPoint",
            &format!("{}", x as i32),
            &format!("{}", y as i32),
            "0", // CoordType: screen
        ])
        .output()
        .ok()?;

    if output.status.success() {
        Some(ElementInfo {
            name: "UI Element".to_string(),
            element_type: "unknown".to_string(),
            value: None,
            app_name: None,
        })
    } else {
        None
    }
}

// Fallback for other platforms
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn get_element_at_point(_x: f64, _y: f64) -> Option<ElementInfo> {
    None
}
