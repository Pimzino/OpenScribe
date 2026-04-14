import { useState, useRef, useEffect } from "react";
import { Download, FileText, FileCode, FileType } from "lucide-react";
import Tooltip from "./Tooltip";

interface ExportDropdownProps {
    markdown: string;
    fileName: string;
}

export default function ExportDropdown({ markdown, fileName }: ExportDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [exportingFormat, setExportingFormat] = useState<string | null>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const runExport = async (format: string, exporter: () => Promise<void>) => {
        setIsExporting(true);
        setExportingFormat(format);
        try {
            await exporter();
            setIsOpen(false);
        } catch (e) {
            console.error(`${format} export failed`, e);
        } finally {
            setIsExporting(false);
            setExportingFormat(null);
        }
    };

    const handleExportMarkdown = async () => {
        await runExport("Markdown", async () => {
            const { exportToMarkdown } = await import("../lib/export/markdownExporter");
            await exportToMarkdown(markdown, fileName);
        });
    };

    const handleExportHtml = async () => {
        await runExport("HTML", async () => {
            const { exportToHtml } = await import("../lib/export/htmlExporter");
            await exportToHtml(markdown, fileName);
        });
    };

    const handleExportPdf = async () => {
        await runExport("PDF", async () => {
            const { exportToPdf } = await import("../lib/export/pdfExporter");
            await exportToPdf(markdown, fileName);
        });
    };

    const handleExportWord = async () => {
        await runExport("Word", async () => {
            const { exportToWord } = await import("../lib/export/wordExporter");
            await exportToWord(markdown, fileName);
        });
    };

    return (
        <div className="relative inline-flex items-center" ref={dropdownRef}>
            <Tooltip content="Export">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isExporting}
                    className="p-2 bg-white/10 hover:bg-white/15 rounded-md transition-colors disabled:opacity-50"
                >
                    {isExporting ? (
                        <div
                            className="w-[18px] h-[18px] border-2 border-zinc-400 border-t-transparent rounded-full animate-spin"
                            aria-label={exportingFormat ? `Exporting ${exportingFormat}` : "Exporting"}
                        />
                    ) : (
                        <Download size={18} />
                    )}
                </button>
            </Tooltip>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 glass-surface-3 rounded-xl shadow-xl z-50 overflow-hidden">
                    <button
                        onClick={handleExportPdf}
                        disabled={isExporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed rounded-t-xl"
                    >
                        <FileType size={16} />
                        Export to PDF
                    </button>
                    <button
                        onClick={handleExportMarkdown}
                        disabled={isExporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileCode size={16} />
                        Export to Markdown
                    </button>
                    <button
                        onClick={handleExportHtml}
                        disabled={isExporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileCode size={16} />
                        Export to HTML
                    </button>
                    <button
                        onClick={handleExportWord}
                        disabled={isExporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed rounded-b-xl"
                    >
                        <FileText size={16} />
                        Export to Word
                    </button>
                </div>
            )}
        </div>
    );
}
