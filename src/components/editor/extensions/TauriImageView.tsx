import { useEffect, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { Expand } from 'lucide-react';
import ImageViewer from '../../ImageViewer';
import { isLocalPath } from './TauriImage';
import { resolveDisplayImageSrc } from '../../../lib/localAssets';

export const TauriImageView = memo(function TauriImageView({ node, selected }: NodeViewProps) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const { src: rawSrc, alt, title } = node.attrs;

  // Convert local file paths to Tauri asset URLs
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;

    const updateSrc = async () => {
      if (!rawSrc) {
        if (!cancelled) {
          setSrc('');
        }
        return;
      }

      try {
        const resolvedSrc = await resolveDisplayImageSrc(rawSrc);
        if (!cancelled) {
          setSrc(resolvedSrc);
          setImageError(false);
        }
      } catch (error) {
        console.error('Failed to resolve editor image source:', error);
        if (!cancelled) {
          setSrc(isLocalPath(rawSrc) ? '' : rawSrc);
          setImageError(isLocalPath(rawSrc));
        }
      }
    };

    updateSrc();

    return () => {
      cancelled = true;
    };
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
