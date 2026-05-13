import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MapPin, Plus } from "lucide-react";

import DraggableStepCard from "../../components/DraggableStepCard";
import type { Step } from "../../store/recordingsStore";

interface StepsTabProps {
    steps: Step[];
    isSelectingPosition: boolean;
    insertPosition: number | null;
    deletingStepId: string | null;
    cropTimestamps: Record<string, number>;
    onDeleteStep: (stepId: string) => void;
    onCropStep: (stepId: string, target: "before" | "after") => void;
    onUpdateDescription: (stepId: string, description: string) => void;
    onSelectInsertPosition: (index: number) => void;
    onReorder: (activeId: string, overId: string) => void;
}

export default function StepsTab({
    steps,
    isSelectingPosition,
    insertPosition,
    deletingStepId,
    cropTimestamps,
    onDeleteStep,
    onCropStep,
    onUpdateDescription,
    onUpdateTitle,
    onSelectInsertPosition,
    onReorder,
}: StepsTabProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    const renderInsertSlot = (index: number, isEnd: boolean = false) => {
        if (isSelectingPosition) {
            const isActive = insertPosition === index;
            return (
                <button
                    onClick={() => onSelectInsertPosition(index)}
                    className={`group relative flex w-full items-center justify-center py-2 transition-colors ${
                        isActive ? "text-green-400" : "text-white/35 hover:text-white/70"
                    }`}
                >
                    <span className={`h-px flex-1 ${isActive ? "bg-green-400" : "bg-white/10 group-hover:bg-white/20"}`} />
                    <span className={`mx-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                        isActive
                            ? "border-green-500 bg-green-500/15 text-green-400"
                            : "border-white/15 bg-white/5 group-hover:border-white/25 group-hover:bg-white/10"
                    }`}>
                        <MapPin size={12} />
                        {isActive ? "Insert Here" : isEnd ? "Insert at End" : "Insert here"}
                    </span>
                    <span className={`h-px flex-1 ${isActive ? "bg-green-400" : "bg-white/10 group-hover:bg-white/20"}`} />
                </button>
            );
        }

        return (
            <div className="relative flex w-full items-center justify-center py-1">
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/8" />
                <button
                    onClick={() => onSelectInsertPosition(index)}
                    className="relative inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-[#1a1718] px-3 py-1 text-xs font-medium text-white/60 hover:border-[#2721E8]/60 hover:bg-[#2721E8]/10 hover:text-white/90 transition-colors"
                >
                    <Plus size={12} />
                    Add step
                </button>
            </div>
        );
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) {
                    return;
                }

                onReorder(String(active.id), String(over.id));
            }}
        >
            <SortableContext
                items={steps.map((step) => step.id)}
                strategy={verticalListSortingStrategy}
            >
                <div className="mx-auto flex w-full max-w-3xl flex-col">
                    {steps.map((step, index) => (
                        <div key={step.id}>
                            {renderInsertSlot(index)}
                            <DraggableStepCard
                                id={step.id}
                                step={step}
                                index={index}
                                onDelete={() => onDeleteStep(step.id)}
                                onCrop={(target) => onCropStep(step.id, target)}
                                onUpdateDescription={(description) => onUpdateDescription(step.id, description)}
                                isDeleting={deletingStepId === step.id}
                                cropTimestamp={cropTimestamps[step.id]}
                            />
                        </div>
                    ))}
                    {isSelectingPosition && (
                        <button
                            onClick={() => onSelectInsertPosition(steps.length)}
                            className={`flex h-32 items-center justify-center rounded-lg transition-all ${
                                insertPosition === steps.length
                                    ? "border-2 border-green-500 bg-green-500/20"
                                    : "border-2 border-dashed border-white/20 bg-white/10 hover:bg-white/15"
                            }`}
                        >
                            <div className="text-center">
                                <MapPin
                                    size={24}
                                    className={insertPosition === steps.length ? "mx-auto text-green-500" : "mx-auto text-white/60"}
                                />
                                <span className={`text-sm ${insertPosition === steps.length ? "font-medium text-green-500" : "text-white/60"}`}>
                                    {insertPosition === steps.length ? "Insert Here" : "Insert at End"}
                                </span>
                            </div>
                        </button>
                    )}
                </div>
            </SortableContext>
        </DndContext>
    );
}
