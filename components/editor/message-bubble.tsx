"use client";

import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, Wrench } from "lucide-react";
import { ChatMessage, ImageAttachment } from "@/types/chat";
import { getModelById } from "@/lib/models";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { GenerationProgress } from "./generation-progress";

export interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isAutoHealInProgress?: boolean;
}

const FILE_TAG_REGEX = /<file\s+path="[^"]+">\n?[\s\S]*?\n?<\/file>/g;

const PARTIAL_FILE_REGEX = /<file\s+path="[^"]+">[\s\S]*$/;

/** A trailing "<", "<fi", '<file path="src/Ap' … that may become a file tag */
const PARTIAL_OPEN_TAG_REGEX = /<(?:f(?:i(?:l(?:e(?:\s[^>]*)?)?)?)?)?$/;

function stripFileTags(content: string, isStreaming: boolean): string {
  let cleaned = content.replace(FILE_TAG_REGEX, "").replace(/\n{3,}/g, "\n\n");

  // Strip partial/incomplete <file> blocks (opening tag without closing tag).
  // Always clean these — old messages saved with fullResponse may have orphans.
  cleaned = cleaned.replace(PARTIAL_FILE_REGEX, "");

  // While streaming, hide a half-received opening tag at the very end.
  if (isStreaming) {
    cleaned = cleaned.replace(PARTIAL_OPEN_TAG_REGEX, "");
  }

  // Strip any leftover closing </file> tags that survived the regex
  cleaned = cleaned.replace(/<\/file>/g, "");

  return cleaned.trim();
}

function formatModelName(modelId: string): string {
  const modelInfo = getModelById(modelId);

  if (modelInfo) return modelInfo.name;

  if (modelId.includes("claude")) return "Claude";
  if (modelId.includes("gemini")) return "Gemini";
  if (modelId.includes("gpt-4o-mini")) return "GPT-4o Mini";
  if (modelId.includes("gpt-4o")) return "GPT-4o";
  if (modelId.includes("deepseek")) return "DeepSeek";
  return modelId; // Fallback to raw ID if no match
}

/** Prefix used by the auto-heal request built in the project page */
export const AUTO_HEAL_PREFIX = "The app has a build/runtime error";

function extractAttemptNumber(content: string): number {
  const match = content.match(/\(attempt (\d+)\/\d+\)/);
  return match ? parseInt(match[1], 10) : 1;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function imageSrc(img: ImageAttachment): string {
  return `data:${img.mediaType};base64,${img.base64}`;
}

/** Small centered pill used for system and auto-heal notices */
function SystemPill({
  children,
  icon,
  pulse,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className="flex justify-center">
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border/60 bg-secondary/50 px-3 py-1 text-[11px] font-medium text-muted-foreground",
          pulse && "animate-pulse",
        )}
      >
        {icon}
        {children}
      </span>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words dark:prose-invert",
        "prose-p:my-1.5 prose-p:leading-relaxed prose-headings:mb-2 prose-headings:mt-3",
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5",
        "prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-secondary/60 prose-pre:text-foreground",
        "prose-code:rounded prose-code:bg-secondary/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none",
        "prose-table:my-2 prose-table:text-xs prose-th:px-2 prose-td:px-2",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MessageBubbleImpl({
  message,
  isStreaming = false,
  isAutoHealInProgress = false,
}: MessageBubbleProps) {
  const [lightboxImage, setLightboxImage] = useState<ImageAttachment | null>(
    null,
  );

  const displayContent = useMemo(
    () => stripFileTags(message.content, isStreaming),
    [message.content, isStreaming],
  );

  // --- System messages: small centered pill ---
  if (message.role === "system") {
    return <SystemPill>{message.content}</SystemPill>;
  }

  // --- Auto-heal requests render as a pill instead of the raw error dump ---
  if (
    message.role === "user" &&
    message.content.startsWith(AUTO_HEAL_PREFIX)
  ) {
    const attempt = extractAttemptNumber(message.content);
    return (
      <SystemPill
        pulse={isAutoHealInProgress}
        icon={<Wrench className="size-3" />}
      >
        {isAutoHealInProgress ? "Auto-fixing error…" : "Auto-fixed error"}
        {attempt > 1 && ` (attempt ${attempt})`}
      </SystemPill>
    );
  }

  const isUser = message.role === "user";
  const images = message.images ?? [];

  return (
    <div
      className={cn(
        "group flex gap-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "border border-primary/20 bg-primary/10 text-primary",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      <div
        className={cn(
          "flex min-w-0 max-w-[85%] flex-col gap-1.5",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* Name + time */}
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {isUser
              ? "You"
              : message.model
                ? formatModelName(message.model)
                : "Assistant"}
          </span>
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* Image thumbnails */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {images.map((img, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setLightboxImage(img)}
                className="size-16 overflow-hidden rounded-lg border border-border/50 transition-opacity hover:opacity-80"
                aria-label={`Open ${img.name || "attached image"}`}
              >
                <img
                  src={imageSrc(img)}
                  alt={img.name || "Attached image"}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Text content */}
        {displayContent && (
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2.5 text-sm",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-card text-card-foreground ring-1 ring-border/50",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {displayContent}
              </p>
            ) : (
              <MarkdownContent content={displayContent} />
            )}
          </div>
        )}

        {/* Generation progress (assistant only) */}
        {!isUser && (
          <div className="w-full min-w-[240px]">
            <GenerationProgress
              content={message.content}
              isStreaming={isStreaming}
              changedFiles={message.changedFiles}
            />
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog
        open={lightboxImage !== null}
        onOpenChange={(open) => !open && setLightboxImage(null)}
      >
        <DialogContent className="max-w-[90vw] border-none bg-transparent p-0 ring-0 sm:max-w-4xl">
          <DialogTitle className="sr-only">
            {lightboxImage?.name || "Image preview"}
          </DialogTitle>
          {lightboxImage && (
            <img
              src={imageSrc(lightboxImage)}
              alt={lightboxImage.name || "Image preview"}
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
