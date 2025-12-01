/**
 * Markdown and path utilities for the Tiptap editor
 */

/**
 * Normalize image path by decoding URI components and handling file:// prefix
 */
export function normalizeImagePath(path: string): string {
  let cleanPath = path;

  // Decode URI components (e.g., %20 -> space)
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch {
    // Ignore if malformed
  }

  // Remove file:// prefix for local paths
  if (cleanPath.startsWith('file://')) {
    cleanPath = cleanPath.slice(7);
    // Handle Windows /C:/... -> C:/...
    if (cleanPath.startsWith('/') && cleanPath.includes(':')) {
      cleanPath = cleanPath.slice(1);
    }
  }

  return cleanPath;
}

/**
 * Check if path is a local file path (Windows or Unix)
 */
export function isLocalPath(path: string): boolean {
  const normalized = normalizeImagePath(path);
  // Windows absolute path (C:, D:, etc.) or Unix absolute path (/)
  return /^[A-Z]:/i.test(normalized) || normalized.startsWith('/');
}

/**
 * Encode path for use in markdown image syntax
 * Spaces become %20, etc.
 */
export function encodePathForMarkdown(path: string): string {
  // Normalize forward slashes
  const normalized = path.replace(/\\/g, '/');
  // Encode spaces and special characters
  return normalized.replace(/ /g, '%20');
}

/**
 * Extract image paths from markdown content
 */
export function extractImagePaths(markdown: string): string[] {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const paths: string[] = [];
  let match;

  while ((match = imageRegex.exec(markdown)) !== null) {
    paths.push(match[2]);
  }

  return paths;
}

/**
 * Replace image paths in markdown content
 */
export function replaceImagePaths(
  markdown: string,
  replacer: (path: string) => string
): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, path) => `![${alt}](${replacer(path)})`
  );
}
