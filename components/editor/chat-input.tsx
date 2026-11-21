"use client";

import { cn } from "@/lib/utils";
import { ImageAttachment } from "@/types/chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Paperclip, SendHorizontal, X } from "lucide-react";

const MAX_IMAGES = 5;
/** Maximum image file size in bytes (4MB) */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
/** Accepted image MIME types */
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface ChatInputProps {
  onSend: (message: string, images?: ImageAttachment[]) => void;
  isStreaming: boolean;
  creditsRemaining?: number;
  isCreditsExhausted?: boolean;
  supportsVision?: boolean;
}

export function ChatInput({
  onSend,
  isStreaming,
  creditsRemaining,
  isCreditsExhausted = false,
  supportsVision = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const processFile = useCallback(
    async (file: File): Promise<ImageAttachment | null> => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error("Only PNG, JPEG, GIF, and WebP images are supported.");
        return null;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error("Image must be under 4MB.");
        return null;
      }

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Strip the "data:image/...;base64," prefix
          const base64 = dataUrl.split(",")[1];
          resolve({
            base64,
            mediaType: file.type,
            name: file.name,
          });
        };
        reader.onerror = () => {
          toast.error("Failed to read image file.");
          resolve(null);
        };
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const remaining = MAX_IMAGES - attachedImages.length;
      const filesToProcess = Array.from(files).slice(0, remaining);

      if (Array.from(files).length > remaining) {
        toast.error(`Maximum ${MAX_IMAGES} images per message.`);
      }

      const results = await Promise.all(filesToProcess.map(processFile));
      const valid = results.filter(Boolean) as ImageAttachment[];
      if (valid.length > 0) {
        setAttachedImages((prev) => [...prev, ...valid]);
      }
    },
    [attachedImages.length, processFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!supportsVision) return;

      const imageFiles: File[] = [];
      for (const file of Array.from(event.dataTransfer.files)) {
        if (file.type.startsWith("image/")) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        handleFiles(imageFiles);
      }
    },
    [supportsVision, handleFiles],
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (
      (!trimmed && attachedImages.length === 0) ||
      isStreaming ||
      isCreditsExhausted
    )
      return;
    onSend(
      trimmed || "Describe this image",
      attachedImages.length > 0 ? attachedImages : undefined,
    );
    setValue("");
    setAttachedImages([]);
  }, [value, attachedImages, isStreaming, isCreditsExhausted, onSend]);

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) {
        handleFiles(event.target.files);
        // Reset the input so the same file can be selected again
        event.target.value = "";
      }
    },
    [handleFiles],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (!supportsVision) return;
      const items = event.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        event.preventDefault();
        handleFiles(imageFiles);
      }
    },
    [supportsVision, handleFiles],
  );
  
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const isDisabled = isStreaming || isCreditsExhausted;
  const hasContent = value.trim().length > 0 || attachedImages.length > 0;

  return (
    <div
      className="px-3 pb-3 pt-1.5"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border/50 bg-background transition-colors focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10",
        )}
      >
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
            {attachedImages.map((img, index) => (
              <div
                key={index}
                className="group/thumb relative size-14 shrink-0 overflow-hidden rounded-lg border border-border/50"
              >
                <img
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt={img.name || "Attached image"}
                  className="size-full object-cover"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover/thumb:opacity-100"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}

            {/* Image count indicator */}
            <span
              className={cn(
                "text-[11px] font-medium",
                attachedImages.length >= MAX_IMAGES
                  ? "text-amber-500"
                  : "text-muted-foreground/60",
              )}
            >
              {attachedImages.length}/{MAX_IMAGES}
            </span>
          </div>
        )}

        <div className="flex items-end gap-2 px-3 py-2">
          {supportsVision && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDisabled || attachedImages.length >= MAX_IMAGES}
              className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isCreditsExhausted
                ? "You've run out of credits"
                : isStreaming
                  ? "AI is generating..."
                  : "Describe what you want to build..."
            }
            disabled={isDisabled}
            rows={1}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none",
              "min-h-[24px] max-h-[200px]",
              isDisabled && "opacity-50 cursor-not-allowed",
            )}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!hasContent || isDisabled}
            className={cn(
              "shrink-0 rounded-lg transition-all duration-150",
              hasContent && !isDisabled
                ? "opacity-100 scale-100"
                : "opacity-30 scale-95",
            )}
          >
            <SendHorizontal className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}