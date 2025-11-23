/**
 * Path utilities for safe filesystem operations
 * Based on sanitize-filename best practices for cross-platform compatibility
 */

// Characters that are invalid in Windows filenames (including spaces for URL/markdown compatibility)
const INVALID_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1f\x80-\x9f\s]/g;

// Windows reserved filenames
const RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
];

// Maximum filename length (common filesystem limit)
const MAX_LENGTH = 255;

/**
 * Sanitizes a string to be safe for use as a filename or directory name
 * @param name - The original filename/directory name
 * @param replacement - Character to replace invalid chars with (default: '_')
 * @returns Sanitized name safe for filesystem use
 */
export function sanitizeFilename(name: string, replacement: string = '_'): string {
  if (!name || typeof name !== 'string') {
    return 'untitled';
  }

  let sanitized = name
    // Replace invalid characters
    .replace(INVALID_CHARS_REGEX, replacement)
    // Remove leading/trailing dots and spaces (problematic on Windows)
    .replace(/^[\s.]+|[\s.]+$/g, '')
    // Collapse multiple replacement characters
    .replace(new RegExp(`${escapeRegex(replacement)}+`, 'g'), replacement);

  // Check for reserved names (case-insensitive)
  const upperName = sanitized.toUpperCase();
  const baseName = upperName.split('.')[0]; // Check without extension
  if (RESERVED_NAMES.includes(baseName)) {
    sanitized = `_${sanitized}`;
  }

  // Truncate to max length (accounting for potential multi-byte chars)
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH);
    // Don't end with a dot or space after truncation
    sanitized = sanitized.replace(/[\s.]+$/, '');
  }

  // Fallback if everything was stripped
  if (!sanitized) {
    return 'untitled';
  }

  return sanitized;
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates if a path string is a valid directory path
 * @param path - Path to validate
 * @returns true if path appears valid
 */
export function isValidPath(path: string): boolean {
  if (!path || typeof path !== 'string') {
    return false;
  }

  // Check for empty path after trimming
  if (!path.trim()) {
    return false;
  }

  // Basic validation - path shouldn't contain null bytes
  if (path.includes('\x00')) {
    return false;
  }

  return true;
}

/**
 * Joins path segments safely
 * @param segments - Path segments to join
 * @returns Joined path with forward slashes (platform-normalized by Tauri)
 */
export function joinPath(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}
