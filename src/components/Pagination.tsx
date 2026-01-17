import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPrevious: () => void;
    onNext: () => void;
    disabled?: boolean;
}

export default function Pagination({
    currentPage,
    totalPages,
    onPrevious,
    onNext,
    disabled = false
}: PaginationProps) {
    const canGoPrevious = currentPage > 1;
    const canGoNext = currentPage < totalPages;

    if (totalPages <= 1) {
        return null;
    }

    return (
        <div className="flex items-center justify-center gap-4 mt-6">
            <button
                onClick={onPrevious}
                disabled={disabled || !canGoPrevious}
                className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2721E8]"
                aria-label="Previous page"
            >
                <ChevronLeft size={18} />
            </button>
            
            <span className="text-sm text-white/70 min-w-[100px] text-center">
                Page {currentPage} of {totalPages}
            </span>
            
            <button
                onClick={onNext}
                disabled={disabled || !canGoNext}
                className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#2721E8]"
                aria-label="Next page"
            >
                <ChevronRight size={18} />
            </button>
        </div>
    );
}
