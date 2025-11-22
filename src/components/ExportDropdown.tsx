import { useState, useRef, useEffect } from "react";
import { Download, FileText, FileCode, FileType, Check } from "lucide-react";
import { exportToPdf, exportToHtml, exportToWord, exportToMarkdown, copyToClipboard } from "../lib/export";
import Tooltip from "./Tooltip";

interface ExportDropdownProps {
    markdown: string;
    fileName: string;
}

export default function ExportDropdown({ markdown, fileName }: ExportDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleCopy = async () => {
        await copyToClipboard(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        setIsOpen(false);
    };

    const handleExportMarkdown = () => {
        exportToMarkdown(markdown, fileName);
        setIsOpen(false);
    };

    const handleExportHtml = async () => {
        setIsExporting(true);
        try {
            await exportToHtml(markdown, fileName);
            setIsOpen(false);
        } catch (e) {
            console.error("HTML Export failed", e);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPdf = async () => {
        setIsExporting(true);
        try {
            await exportToPdf(markdown, fileName);
            setIsOpen(false);
        } catch (e) {
            console.error("PDF Export failed", e);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportWord = async () => {
        setIsExporting(true);
        try {
            await exportToWord(markdown, fileName);
            setIsOpen(false);
        } catch (e) {
            console.error("Word Export failed", e);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="relative inline-flex items-center" ref={dropdownRef}>
            <Tooltip content="Export">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isExporting}
                    className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50"
                >
                    {isExporting ? (
                        <div className="w-[18px] h-[18px] border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Download size={18} />
                    )}
                </button>
            </Tooltip>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-50 py-1">
                    <button
                        onClick={handleCopy}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                    >
                        {copied ? <Check size={16} className="text-green-500" /> : <FileText size={16} />}
                        Copy to Markdown
                    </button>
                    <div className="h-px bg-zinc-800 my-1" />
                    <button
                        onClick={handleExportPdf}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                    >
                        <FileType size={16} />
                        Export to PDF
                    </button>
                    <button
                        onClick={handleExportMarkdown}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                    >
                        <FileCode size={16} />
                        Export to Markdown
                    </button>
                    <button
                        onClick={handleExportHtml}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                    >
                        <FileCode size={16} />
                        Export to HTML
                    </button>
                    <button
                        onClick={handleExportWord}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
                    >
                        <FileText size={16} />
                        Export to Word
                    </button>
                </div>
            )}
        </div>
    );
}
