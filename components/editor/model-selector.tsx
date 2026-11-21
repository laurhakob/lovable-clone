"use client";

import { useState } from "react";
import { Check, ChevronDown, Lock, Sparkles, Star, Zap } from "lucide-react";
import {
  getModelById,
  getQualityLabel,
  getQualityStars,
  getSpeedBolts,
  getSpeedLabel,
  MODELS,
  ModelInfo,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UpgradeCta } from "./upgrade-cta";

export interface ModelSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  userPlan: "free" | "pro";
  disabled?: boolean;
}

function Indicator({
  count,
  max = 3,
  icon: Icon,
  label,
}: {
  count: number;
  max?: number;
  icon: typeof Zap;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5" title={label}>
      {Array.from({ length: max }, (_, i) => (
        <Icon
          key={i}
          className={cn(
            "size-2.5",
            i < count ? "fill-current text-foreground/70" : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

export function ModelSelector({
  selectedModelId,
  onModelChange,
  userPlan,
  disabled,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  /** Premium model a free user tried to pick — shows the upgrade CTA */
  const [lockedModel, setLockedModel] = useState<ModelInfo | null>(null);

  const selected = getModelById(selectedModelId);

  const handleSelect = (model: ModelInfo) => {
    if (model.tier === "premium" && userPlan === "free") {
      setLockedModel(model);
      return;
    }
    setLockedModel(null);
    setOpen(false);
    if (model.id !== selectedModelId) onModelChange(model.id);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setLockedModel(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="Select AI model"
        >
          <Sparkles className="size-3 text-primary" />
          {selected?.name ?? selectedModelId}
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="max-h-[60vh] overflow-y-auto">
          {PROVIDER_ORDER.map((provider) => {
            const models = MODELS.filter((m) => m.provider === provider);
            if (models.length === 0) return null;
            return (
              <div key={provider} className="py-1">
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {PROVIDER_LABELS[provider]}
                </div>
                {models.map((model) => {
                  const isSelected = model.id === selectedModelId;
                  const isLocked =
                    model.tier === "premium" && userPlan === "free";
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => handleSelect(model)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60",
                        isSelected && "bg-secondary/80",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-xs font-medium",
                              isLocked ? "text-muted-foreground" : "text-foreground",
                            )}
                          >
                            {model.name}
                          </span>
                          {model.tier === "premium" && (
                            <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                              Pro
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {model.description}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Indicator
                              count={getSpeedBolts(model.speed)}
                              icon={Zap}
                              label={`Speed: ${getSpeedLabel(model.speed)}`}
                            />
                            {getSpeedLabel(model.speed)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Indicator
                              count={getQualityStars(model.quality)}
                              icon={Star}
                              label={`Quality: ${getQualityLabel(model.quality)}`}
                            />
                            {getQualityLabel(model.quality)}
                          </span>
                          <span>
                            {model.creditCost}{" "}
                            {model.creditCost === 1 ? "credit" : "credits"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-0.5 shrink-0">
                        {isLocked ? (
                          <Lock className="size-3.5 text-muted-foreground" />
                        ) : isSelected ? (
                          <Check className="size-3.5 text-primary" />
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {lockedModel && (
          <div className="border-t border-border/50 p-1.5 pt-2">
            <UpgradeCta
              reason={`${lockedModel.name} is available on the Pro plan`}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
