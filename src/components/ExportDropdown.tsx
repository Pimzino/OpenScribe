import { useState, useRef, useEffect } from "react";
import { Download, FileText, FileCode, FileType, Check } from "lucide-react";
import { exportToPdf, exportToHtml, exportToWord, exportToMarkdown, copyToClipboard } from "../lib/export";
import Tooltip from "./Tooltip";
import Spinner from "./Spinner";

interface ExportDropdownProps {
    markdown: string;
    fileName: string;
}

export default function ExportDropdown({ markdown, fileName }: ExportDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isCopying, setIsCopying] = useState(false);

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
        setIsCopying(true);
        try {
            await copyToClipboard(markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            setIsOpen(false);
        } finally {
            setIsCopying(false);
        }
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
                    className="p-2 bg-white/10 hover:bg-white/15 rounded-md transition-colors disabled:opacity-50"
                >
                    {isExporting ? (
                        <div className="w-[18px] h-[18px] border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Download size={18} />
                    )}
                </button>
            </Tooltip>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 glass-surface-3 rounded-xl shadow-xl z-50 py-1">
                    <button
                        onClick={handleCopy}
                        disabled={isCopying || isExporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isCopying ? <Spinner size="sm" /> : copied ? <Check size={16} className="text-green-500" /> : <FileText size={16} />}
                        Copy to Markdown
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                    <button
                        onClick={handleExportPdf}
                        disabled={isExporting || isCopying}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileType size={16} />
                        Export to PDF
                    </button>
                    <button
                        onClick={handleExportMarkdown}
                        disabled={isExporting || isCopying}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileCode size={16} />
                        Export to Markdown
                    </button>
                    <button
                        onClick={handleExportHtml}
                        disabled={isExporting || isCopying}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileCode size={16} />
                        Export to HTML
                    </button>
                    <button
                        onClick={handleExportWord}
                        disabled={isExporting || isCopying}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <FileText size={16} />
                        Export to Word
                    </button>
                </div>
            )}
        </div>
    );
}
