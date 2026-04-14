import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { TauriImageView } from './TauriImageView';
import { isLocalFilePath, normalizeImagePath } from '../../../lib/pathUtils';

/**
 * Custom Image extension for Tiptap that handles Tauri local file paths
 * using convertFileSrc for proper asset URL conversion
 */
export const TauriImage = Image.extend({
  name: 'tauriImage',

  // Ensure the node is selectable
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          const src = attributes.src;
          if (!src) return {};

          // Convert local file paths to Tauri asset URLs for display
          if (isLocalFilePath(src)) {
            const normalizedPath = normalizeImagePath(src);
            return {
              src: convertFileSrc(normalizedPath),
              'data-original-src': src, // Preserve original for serialization
            };
          }

          return { src };
        },
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes) => {
          if (!attributes.alt) return {};
          return { alt: attributes.alt };
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { title: attributes.title };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TauriImageView);
  },
});

export { normalizeImagePath, isLocalFilePath as isLocalPath };
