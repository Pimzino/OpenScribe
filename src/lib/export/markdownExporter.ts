import { downloadFile } from "./utils";

export function exportToMarkdown(markdown: string, fileName: string): void {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    downloadFile(blob, `${fileName}.md`);
}

export async function copyToClipboard(markdown: string): Promise<void> {
    await navigator.clipboard.writeText(markdown);
}
