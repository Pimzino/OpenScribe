//! Display server detection for Linux
//!
//! Detects whether the application is running on X11 or Wayland
//! to enable runtime dispatch to the appropriate backend.

/// Display server type for Linux
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayServer {
    /// X Window System (legacy)
    X11,
    /// Wayland compositor
    Wayland,
    /// Unknown or unsupported display server
    Unknown,
}

impl std::fmt::Display for DisplayServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DisplayServer::X11 => write!(f, "X11"),
            DisplayServer::Wayland => write!(f, "Wayland"),
            DisplayServer::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Detect the current display server from environment variables.
///
/// Detection order:
/// 1. `XDG_SESSION_TYPE` - Most reliable, set by systemd/login managers
/// 2. `WAYLAND_DISPLAY` - Present when Wayland compositor is running
/// 3. `DISPLAY` - Present when X11 is running
pub fn detect_display_server() -> DisplayServer {
    // Primary: Check XDG_SESSION_TYPE (set by systemd on most modern distros)
    if let Ok(session) = std::env::var("XDG_SESSION_TYPE") {
        match session.to_lowercase().as_str() {
            "wayland" => return DisplayServer::Wayland,
            "x11" => return DisplayServer::X11,
            _ => {} // Continue to fallback checks
        }
    }

    // Fallback: Check for WAYLAND_DISPLAY (Wayland-specific)
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return DisplayServer::Wayland;
    }

    // Fallback: Check for DISPLAY (X11-specific)
    if std::env::var("DISPLAY").is_ok() {
        return DisplayServer::X11;
    }

    DisplayServer::Unknown
}

/// Check if running on Wayland
#[inline]
pub fn is_wayland() -> bool {
    detect_display_server() == DisplayServer::Wayland
}

/// Check if running on X11
#[inline]
pub fn is_x11() -> bool {
    detect_display_server() == DisplayServer::X11
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_server_display() {
        assert_eq!(format!("{}", DisplayServer::X11), "X11");
        assert_eq!(format!("{}", DisplayServer::Wayland), "Wayland");
        assert_eq!(format!("{}", DisplayServer::Unknown), "Unknown");
    }
}
