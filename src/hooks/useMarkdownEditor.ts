import { useState, useCallback } from 'react';

export function useMarkdownEditor(initialContent: string) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(initialContent);

    const startEditing = useCallback(() => {
        setEditedContent(initialContent);
        setIsEditing(true);
    }, [initialContent]);

    const cancelEditing = useCallback(() => {
        setEditedContent(initialContent);
        setIsEditing(false);
    }, [initialContent]);

    const saveEdit = useCallback(async (saveFn: (content: string) => Promise<void>) => {
        await saveFn(editedContent);
        setIsEditing(false);
    }, [editedContent]);

    const updateContent = useCallback((content: string) => {
        setEditedContent(content);
    }, []);

    return {
        isEditing,
        editedContent,
        startEditing,
        cancelEditing,
        saveEdit,
        updateContent,
        setEditedContent,
    };
}
