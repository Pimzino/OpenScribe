/**
 * Markdown and path utilities for Tiptap editor
 */
import { normalizeImagePath, encodePathForMarkdown, normalizeForwardSlashes, normalizePathForMarkdown } from '../pathUtils';

/**
 * Check if path is a local file path (Windows or Unix)
 */
export function isLocalPath(path: string): boolean {
  const normalized = normalizeImagePath(path);
  // Windows absolute path (C:, D:, etc.) or Unix absolute path (/)
  return /^[A-Z]:/i.test(normalized) || normalized.startsWith('/');
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

// Re-export path utilities from pathUtils for convenience
export { normalizeImagePath, encodePathForMarkdown, normalizeForwardSlashes, normalizePathForMarkdown };