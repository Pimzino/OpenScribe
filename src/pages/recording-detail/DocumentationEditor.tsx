import { TiptapEditor } from "../../components/editor";

interface DocumentationEditorProps {
    content: string;
    onChange: (value: string) => void;
}

export default function DocumentationEditor({ content, onChange }: DocumentationEditorProps) {
    return (
        <TiptapEditor
            content={content}
            onChange={onChange}
            showSourceToggle={true}
            toolbarGroups={["history", "heading", "format", "list", "insert", "code"]}
            minHeight="500px"
            placeholder="Edit your documentation..."
        />
    );
}
