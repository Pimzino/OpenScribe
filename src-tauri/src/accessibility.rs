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
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::ptr;

    // AX error code for success
    const K_AX_ERROR_SUCCESS: i32 = 0;

    // Attribute name constants
    fn cf_string(s: &str) -> CFString {
        CFString::new(s)
    }

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
            fn AXUIElementCopyAttributeValue(
                element: *mut std::ffi::c_void,
                attribute: CFStringRef,
                value: *mut CFTypeRef,
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

        if result != K_AX_ERROR_SUCCESS || element_at_pos.is_null() {
            return None;
        }

        // Helper to get string attribute from an AX element
        let get_string_attr = |element: *mut std::ffi::c_void, attr_name: &str| -> Option<String> {
            let attr = cf_string(attr_name);
            let mut value: CFTypeRef = ptr::null();
            let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
            if result == K_AX_ERROR_SUCCESS && !value.is_null() {
                // Try to interpret as CFString
                let cf_str = CFString::wrap_under_create_rule(value as CFStringRef);
                Some(cf_str.to_string())
            } else {
                None
            }
        };

        // Get title (name) - try multiple attributes
        let name = get_string_attr(element_at_pos, "AXTitle")
            .or_else(|| get_string_attr(element_at_pos, "AXDescription"))
            .or_else(|| get_string_attr(element_at_pos, "AXHelp"))
            .unwrap_or_default();

        // Get role (element type)
        let role = get_string_attr(element_at_pos, "AXRole").unwrap_or_default();
        // Convert AX role to human-readable type
        let element_type = match role.as_str() {
            "AXButton" => "Button".to_string(),
            "AXTextField" => "Text Field".to_string(),
            "AXStaticText" => "Text".to_string(),
            "AXLink" => "Link".to_string(),
            "AXCheckBox" => "Checkbox".to_string(),
            "AXRadioButton" => "Radio Button".to_string(),
            "AXPopUpButton" => "Dropdown".to_string(),
            "AXComboBox" => "Combo Box".to_string(),
            "AXSlider" => "Slider".to_string(),
            "AXTabGroup" => "Tab Group".to_string(),
            "AXTab" => "Tab".to_string(),
            "AXTable" => "Table".to_string(),
            "AXRow" => "Row".to_string(),
            "AXCell" => "Cell".to_string(),
            "AXImage" => "Image".to_string(),
            "AXMenu" => "Menu".to_string(),
            "AXMenuItem" => "Menu Item".to_string(),
            "AXMenuBar" => "Menu Bar".to_string(),
            "AXToolbar" => "Toolbar".to_string(),
            "AXWindow" => "Window".to_string(),
            "AXGroup" => "Group".to_string(),
            "AXScrollArea" => "Scroll Area".to_string(),
            "AXList" => "List".to_string(),
            "AXOutline" => "Outline".to_string(),
            "AXTextArea" => "Text Area".to_string(),
            "AXWebArea" => "Web Content".to_string(),
            _ => if role.starts_with("AX") { role[2..].to_string() } else { role },
        };

        // Get value
        let value = get_string_attr(element_at_pos, "AXValue");

        // Walk up the element tree to find the app name
        let mut app_name: Option<String> = None;
        let mut current_element = element_at_pos;
        for _ in 0..20 {
            // Get parent element
            let attr = cf_string("AXParent");
            let mut parent_value: CFTypeRef = ptr::null();
            let result = AXUIElementCopyAttributeValue(current_element, attr.as_concrete_TypeRef(), &mut parent_value);

            if result != K_AX_ERROR_SUCCESS || parent_value.is_null() {
                break;
            }

            // Check if this element has a title we can use as app name
            if let Some(title) = get_string_attr(parent_value as *mut std::ffi::c_void, "AXTitle") {
                if !title.is_empty() {
                    app_name = Some(title);
                }
            }

            // Also check AXRoleDescription for top-level window/app
            if let Some(role) = get_string_attr(parent_value as *mut std::ffi::c_void, "AXRole") {
                if role == "AXApplication" {
                    // Found the application - get its title
                    if let Some(title) = get_string_attr(parent_value as *mut std::ffi::c_void, "AXTitle") {
                        if !title.is_empty() {
                            app_name = Some(title);
                        }
                    }
                    CFRelease(parent_value);
                    break;
                }
            }

            // Release current element if it's not the original
            if current_element != element_at_pos {
                CFRelease(current_element as *const _);
            }
            current_element = parent_value as *mut std::ffi::c_void;
        }

        // Clean up remaining element references
        if current_element != element_at_pos && !current_element.is_null() {
            CFRelease(current_element as *const _);
        }
        CFRelease(element_at_pos as *const _);

        Some(ElementInfo {
            name,
            element_type,
            value,
            app_name,
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
