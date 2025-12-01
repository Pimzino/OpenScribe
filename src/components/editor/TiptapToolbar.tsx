import { useState, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  FileCode,
} from 'lucide-react';
import type { ToolbarGroup } from './TiptapEditor';
import { ImageModal } from './ImageModal';

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      type="button"
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-[rgba(39,33,232,0.3)] text-white'
          : 'text-white/70 hover:text-white hover:bg-white/10'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-6 bg-white/10 mx-1" />;
}

interface TiptapToolbarProps {
  editor: Editor;
  groups?: ToolbarGroup[];
  disabled?: boolean;
}

export function TiptapToolbar({
  editor,
  groups = ['history', 'heading', 'format', 'list', 'insert', 'code'],
  disabled = false,
}: TiptapToolbarProps) {
  // Force re-render on editor selection/transaction changes
  const [, forceUpdate] = useState(0);

  // Image modal state
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [currentImageSrc, setCurrentImageSrc] = useState('');
  const [currentImageAlt, setCurrentImageAlt] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      forceUpdate((n) => n + 1);
    };

    editor.on('selectionUpdate', handleUpdate);
    editor.on('transaction', handleUpdate);

    return () => {
      editor.off('selectionUpdate', handleUpdate);
      editor.off('transaction', handleUpdate);
    };
  }, [editor]);

  const openImageModal = () => {
    // Check if an image is currently selected (tauriImage is the custom extension name)
    const isTauriImage = editor.isActive('tauriImage');
    const isStandardImage = editor.isActive('image');
    const isImageSelected = isTauriImage || isStandardImage;

    let imageSrc = '';
    let imageAlt = '';

    if (isImageSelected) {
      // Get attributes from the correct node type
      const attrs = isTauriImage
        ? editor.getAttributes('tauriImage')
        : editor.getAttributes('image');

      imageSrc = attrs.src || '';
      imageAlt = attrs.alt || '';
    }

    // Also try to get from the selected node directly if attrs didn't work
    if (!imageSrc) {
      const { selection } = editor.state;
      const node = selection.$anchor.parent;

      // Check if parent is an image
      if (node.type.name === 'tauriImage' || node.type.name === 'image') {
        imageSrc = node.attrs.src || '';
        imageAlt = node.attrs.alt || '';
      }

      // Check the node at the current position
      const nodeAt = editor.state.doc.nodeAt(selection.from);
      if (nodeAt && (nodeAt.type.name === 'tauriImage' || nodeAt.type.name === 'image')) {
        imageSrc = nodeAt.attrs.src || '';
        imageAlt = nodeAt.attrs.alt || '';
      }
    }

    if (imageSrc) {
      setCurrentImageSrc(imageSrc);
      setCurrentImageAlt(imageAlt);
      setIsEditingImage(true);
    } else {
      setCurrentImageSrc('');
      setCurrentImageAlt('');
      setIsEditingImage(false);
    }

    setImageModalOpen(true);
  };

  const handleImageInsert = (src: string, alt: string) => {
    if (src === '' && isEditingImage) {
      // Remove the image if user clears the path
      editor.chain().focus().deleteSelection().run();
    } else if (src) {
      editor.chain().focus().setImage({ src, alt: alt || undefined }).run();
    }
    setImageModalOpen(false);
  };

  const addLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter link URL:', previousUrl || 'https://');

    if (url === null) {
      return; // User cancelled
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  const renderGroup = (group: ToolbarGroup) => {
    switch (group) {
      case 'history':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => editor.chain().focus().undo().run()}
              disabled={disabled || !editor.can().undo()}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().redo().run()}
              disabled={disabled || !editor.can().redo()}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </ToolbarButton>
          </div>
        );

      case 'heading':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              isActive={editor.isActive('heading', { level: 1 })}
              disabled={disabled}
              title="Heading 1"
            >
              <Heading1 size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              isActive={editor.isActive('heading', { level: 2 })}
              disabled={disabled}
              title="Heading 2"
            >
              <Heading2 size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              isActive={editor.isActive('heading', { level: 3 })}
              disabled={disabled}
              title="Heading 3"
            >
              <Heading3 size={16} />
            </ToolbarButton>
          </div>
        );

      case 'format':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              disabled={disabled}
              title="Bold (Ctrl+B)"
            >
              <Bold size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              disabled={disabled}
              title="Italic (Ctrl+I)"
            >
              <Italic size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              disabled={disabled}
              title="Underline (Ctrl+U)"
            >
              <UnderlineIcon size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
              disabled={disabled}
              title="Strikethrough"
            >
              <Strikethrough size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive('code')}
              disabled={disabled}
              title="Inline Code"
            >
              <Code size={16} />
            </ToolbarButton>
          </div>
        );

      case 'list':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              isActive={editor.isActive('bulletList')}
              disabled={disabled}
              title="Bullet List"
            >
              <List size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              isActive={editor.isActive('orderedList')}
              disabled={disabled}
              title="Numbered List"
            >
              <ListOrdered size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              isActive={editor.isActive('blockquote')}
              disabled={disabled}
              title="Block Quote"
            >
              <Quote size={16} />
            </ToolbarButton>
          </div>
        );

      case 'insert':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={addLink}
              isActive={editor.isActive('link')}
              disabled={disabled}
              title="Insert/Edit Link"
            >
              <LinkIcon size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={openImageModal}
              isActive={editor.isActive('image') || editor.isActive('tauriImage')}
              disabled={disabled}
              title="Insert/Edit Image"
            >
              <ImageIcon size={16} />
            </ToolbarButton>
            <ToolbarButton onClick={addTable} disabled={disabled} title="Insert Table">
              <TableIcon size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              disabled={disabled}
              title="Horizontal Rule"
            >
              <Minus size={16} />
            </ToolbarButton>
          </div>
        );

      case 'code':
        return (
          <div key={group} className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              isActive={editor.isActive('codeBlock')}
              disabled={disabled}
              title="Code Block"
            >
              <FileCode size={16} />
            </ToolbarButton>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div
        className={`flex items-center gap-1 flex-wrap ${
          disabled ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        {groups.map((group, index) => (
          <div key={group} className="flex items-center">
            {index > 0 && <ToolbarSeparator />}
            {renderGroup(group)}
          </div>
        ))}
      </div>

      <ImageModal
        isOpen={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        onInsert={handleImageInsert}
        initialSrc={currentImageSrc}
        initialAlt={currentImageAlt}
        isEditing={isEditingImage}
      />
    </>
  );
}

export default TiptapToolbar;
