import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { MapPin } from "lucide-react";

import DraggableStepCard from "../../components/DraggableStepCard";
import type { Step } from "../../store/recordingsStore";

interface StepsTabProps {
    steps: Step[];
    isSelectingPosition: boolean;
    insertPosition: number | null;
    deletingStepId: string | null;
    cropTimestamps: Record<string, number>;
    onDeleteStep: (stepId: string) => void;
    onCropStep: (stepId: string) => void;
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
    onSelectInsertPosition,
    onReorder,
}: StepsTabProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

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
                strategy={rectSortingStrategy}
            >
                <div className="grid grid-cols-1 gap-4 scroll-optimized md:grid-cols-2 lg:grid-cols-3">
                    {steps.map((step, index) => (
                        <div key={step.id} className="relative">
                            {isSelectingPosition && (
                                <button
                                    onClick={() => onSelectInsertPosition(index)}
                                    className={`absolute -top-3 left-0 right-0 z-20 flex h-6 items-center justify-center transition-all ${
                                        insertPosition === index
                                            ? "border-2 border-green-500 bg-green-500/20"
                                            : "border border-white/10 bg-white/10 hover:bg-white/15"
                                    }`}
                                >
                                    <MapPin size={14} className={insertPosition === index ? "text-green-500" : "text-white/60"} />
                                    {insertPosition === index && (
                                        <span className="ml-1 text-xs font-medium text-green-500">Insert Here</span>
                                    )}
                                </button>
                            )}
                            <DraggableStepCard
                                id={step.id}
                                step={step}
                                index={index}
                                onDelete={() => onDeleteStep(step.id)}
                                onCrop={() => onCropStep(step.id)}
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
