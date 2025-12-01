import { saveFile } from "./utils";

export async function exportToMarkdown(markdown: string, fileName: string): Promise<void> {
    const data = new TextEncoder().encode(markdown);
    await saveFile(data, `${fileName}.md`, [{ name: "Markdown", extensions: ["md"] }]);
}
