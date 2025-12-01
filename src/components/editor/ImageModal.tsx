import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Link, FolderOpen, ImageIcon } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

type TabType = 'url' | 'browse';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (src: string, alt: string) => void;
  initialSrc?: string;
  initialAlt?: string;
  isEditing?: boolean;
}

export function ImageModal({
  isOpen,
  onClose,
  onInsert,
  initialSrc = '',
  initialAlt = '',
  isEditing = false,
}: ImageModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('url');
  const [urlInput, setUrlInput] = useState('');
  const [filePath, setFilePath] = useState('');
  const [altText, setAltText] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewError, setPreviewError] = useState(false);

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Handle different source formats
      let srcToUse = initialSrc;

      // Check if it's a Tauri asset URL (already converted) - extract original path
      // asset://localhost/C%3A/path/to/image.png -> C:/path/to/image.png
      if (initialSrc.startsWith('asset://') || initialSrc.startsWith('https://asset.')) {
        try {
          const url = new URL(initialSrc);
          let path = decodeURIComponent(url.pathname);
          // Remove leading slash for Windows paths
          if (path.startsWith('/') && path.match(/^\/[A-Z]:/i)) {
            path = path.slice(1);
          }
          srcToUse = path;
        } catch {
          // If URL parsing fails, use as-is
        }
      }

      const isLocalPath = srcToUse && (
        /^[A-Z]:/i.test(srcToUse) ||
        (srcToUse.startsWith('/') && !srcToUse.startsWith('//')) ||
        srcToUse.startsWith('file://')
      );

      if (isLocalPath) {
        setActiveTab('browse');
        setFilePath(srcToUse);
        setUrlInput('');
      } else if (srcToUse) {
        setActiveTab('url');
        setUrlInput(srcToUse);
        setFilePath('');
      } else {
        setActiveTab('url');
        setUrlInput('');
        setFilePath('');
      }
      setAltText(initialAlt);
      updatePreview(srcToUse);
    }
  }, [isOpen, initialSrc, initialAlt]);

  // Update preview when inputs change
  const updatePreview = (src: string) => {
    setPreviewError(false);
    if (!src) {
      setPreviewSrc('');
      return;
    }

    // Check if it's a local path
    const isLocalPath = /^[A-Z]:/i.test(src) ||
      src.startsWith('/') ||
      src.startsWith('file://');

    if (isLocalPath) {
      // Clean up file:// prefix if present
      let cleanPath = src;
      if (cleanPath.startsWith('file://')) {
        cleanPath = cleanPath.slice(7);
        if (cleanPath.startsWith('/') && cleanPath.includes(':')) {
          cleanPath = cleanPath.slice(1);
        }
      }
      setPreviewSrc(convertFileSrc(cleanPath));
    } else {
      setPreviewSrc(src);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        setFilePath(selected);
        updatePreview(selected);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  const handleUrlChange = (value: string) => {
    setUrlInput(value);
    updatePreview(value);
  };

  const handleInsert = () => {
    const src = activeTab === 'url' ? urlInput : filePath;
    if (src) {
      onInsert(src, altText);
      handleClose();
    }
  };

  const handleClose = () => {
    setUrlInput('');
    setFilePath('');
    setAltText('');
    setPreviewSrc('');
    setPreviewError(false);
    onClose();
  };

  const handleRemove = () => {
    onInsert('', '');
    handleClose();
  };

  const currentSrc = activeTab === 'url' ? urlInput : filePath;
  const canInsert = currentSrc.trim().length > 0;

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1e1b23] border border-white/10 rounded-2xl shadow-2xl w-[480px] relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ImageIcon size={20} />
            {isEditing ? 'Edit Image' : 'Insert Image'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('url')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'url'
                ? 'text-white border-b-2 border-[#2721E8] bg-white/5'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Link size={16} />
            URL
          </button>
          <button
            onClick={() => setActiveTab('browse')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'browse'
                ? 'text-white border-b-2 border-[#2721E8] bg-white/5'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <FolderOpen size={16} />
            Browse
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* URL Tab Content */}
          {activeTab === 'url' && (
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">
                Image URL
              </label>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://example.com/image.png"
                className="w-full px-3 py-2.5 bg-[#0d0b0e] border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#2721E8] focus:ring-1 focus:ring-[#2721E8] transition-colors"
                autoFocus
              />
            </div>
          )}

          {/* Browse Tab Content */}
          {activeTab === 'browse' && (
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">
                Local File
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => {
                    setFilePath(e.target.value);
                    updatePreview(e.target.value);
                  }}
                  placeholder="C:\path\to\image.png"
                  className="flex-1 px-3 py-2.5 bg-[#0d0b0e] border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#2721E8] focus:ring-1 focus:ring-[#2721E8] transition-colors"
                />
                <button
                  onClick={handleBrowse}
                  className="px-4 py-2.5 bg-[#2721E8] hover:bg-[#4a45f5] text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <FolderOpen size={16} />
                  Browse
                </button>
              </div>
            </div>
          )}

          {/* Alt Text */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-1.5">
              Alt Text <span className="text-white/50 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Describe the image for accessibility"
              className="w-full px-3 py-2.5 bg-[#0d0b0e] border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#2721E8] focus:ring-1 focus:ring-[#2721E8] transition-colors"
            />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-1.5">
              Preview
            </label>
            <div className="bg-[#0d0b0e] border border-white/20 rounded-lg min-h-[120px] flex items-center justify-center overflow-hidden">
              {previewSrc && !previewError ? (
                <img
                  src={previewSrc}
                  alt={altText || 'Preview'}
                  className="max-w-full max-h-[200px] object-contain"
                  onError={() => setPreviewError(true)}
                />
              ) : previewError ? (
                <div className="text-white/50 text-sm flex flex-col items-center gap-2 py-4">
                  <ImageIcon size={32} className="opacity-50" />
                  <span>Failed to load image</span>
                </div>
              ) : (
                <div className="text-white/50 text-sm flex flex-col items-center gap-2 py-4">
                  <ImageIcon size={32} className="opacity-50" />
                  <span>Enter a URL or browse for an image</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/15 bg-[#161316]">
          <div>
            {isEditing && (
              <button
                onClick={handleRemove}
                className="px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors text-sm font-medium"
              >
                Remove Image
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleInsert}
              disabled={!canInsert}
              className="px-5 py-2 bg-[#2721E8] hover:bg-[#4a45f5] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isEditing ? 'Update' : 'Insert'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ImageModal;
