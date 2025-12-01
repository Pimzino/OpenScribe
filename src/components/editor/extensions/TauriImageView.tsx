import { useState, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Expand } from 'lucide-react';
import ImageViewer from '../../ImageViewer';
import { normalizeImagePath, isLocalPath } from './TauriImage';

export const TauriImageView = memo(function TauriImageView({ node, selected }: NodeViewProps) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const { src: rawSrc, alt, title } = node.attrs;

  // Convert local file paths to Tauri asset URLs
  const src = useMemo(() => {
    if (!rawSrc) return '';
    if (isLocalPath(rawSrc)) {
      const normalizedPath = normalizeImagePath(rawSrc);
      return convertFileSrc(normalizedPath);
    }
    return rawSrc;
  }, [rawSrc]);

  return (
    <>
      {isViewerOpen && createPortal(
        <ImageViewer
          imageSrc={src}
          title={alt || title || 'Image'}
          onClose={() => setIsViewerOpen(false)}
        />,
        document.body
      )}
      <NodeViewWrapper className="tiptap-image-container relative inline-block my-4 group">
        <img
          src={src}
          alt={alt || ''}
          title={title || ''}
          loading="lazy"
          decoding="async"
          className={`tiptap-image max-w-full max-h-80 w-auto h-auto object-contain rounded-lg ${
            selected ? 'ring-2 ring-[#2721E8]' : ''
          } ${imageError ? 'opacity-50' : ''}`}
          onError={() => setImageError(true)}
        />
        <button
          onClick={() => setIsViewerOpen(true)}
          className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          contentEditable={false}
        >
          <Expand size={14} className="text-white" />
        </button>
      </NodeViewWrapper>
    </>
  );
});
