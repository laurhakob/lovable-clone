"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Code, MessageSquare, Sparkles } from "lucide-react";
import { ChatMessage, ImageAttachment } from "@/types/chat";
import { getModelById } from "@/lib/models";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { ModelSelector } from "./model-selector";
import { UpgradeCta } from "./upgrade-cta";

export interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (message: string, images?: ImageAttachment[]) => void;
  creditsRemaining?: number;
  creditsTotal?: number;
  creditsResetDays?: number;
  isCreditsExhausted?: boolean;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  userPlan: "free" | "pro";
}

/** Distance from the bottom (px) within which we keep following new content */
const STICK_TO_BOTTOM_THRESHOLD = 120;

export function ChatPanel({
  messages,
  isStreaming,
  onSendMessage,
  creditsRemaining,
  creditsTotal = 50,
  creditsResetDays,
  isCreditsExhausted,
  selectedModelId,
  onModelChange,
  userPlan,
}: ChatPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Whether the user is near the bottom — if they scrolled up to read, don't yank them down */
  const stickToBottomRef = useRef(true);

  const selectedModel = getModelById(selectedModelId);
  const supportsVision = selectedModel?.supportsVision ?? false;

  /** The Radix viewport (not the Root) is the element that actually scrolls */
  const getViewport = () =>
    scrollContainerRef.current?.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]',
    ) ?? null;

  // Track whether the user is near the bottom
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;
    const onScroll = () => {
      const distance =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      stickToBottomRef.current = distance < STICK_TO_BOTTOM_THRESHOLD;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id;
  const lastContentLength = lastMessage?.content.length ?? 0;

  // Follow new messages and streaming chunks. A brand-new message always
  // scrolls to the bottom; streamed growth only while the user is at the bottom.
  const prevLastIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;
    if (prevLastIdRef.current !== lastMessageId) {
      stickToBottomRef.current = true;
      prevLastIdRef.current = lastMessageId;
    }
    if (stickToBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages.length, lastMessageId, lastContentLength, isStreaming]);

  return (
    <div className="flex h-full flex-col bg-background">
      <ScrollArea
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex flex-col gap-5 p-4">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              {/* Glowing icon */}
              <div className="relative mb-5">
                <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-xl" />
                <div className="relative flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <Sparkles className="size-7 text-primary" />
                </div>
              </div>

              <h3 className="text-base font-semibold text-foreground">
                What do you want to build?
              </h3>
              <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
                Describe your app and the AI will generate working code with a
                live preview.
              </p>

              {/* Suggestion chips */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {[
                  { icon: Code, label: "A landing page" },
                  { icon: MessageSquare, label: "A chat app" },
                ].map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => onSendMessage(suggestion.label)}
                    disabled={isStreaming || isCreditsExhausted}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <suggestion.icon className="size-3" />
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={
                isStreaming &&
                message.role === "assistant" &&
                index === messages.length - 1
              }
              isAutoHealInProgress={
                isStreaming &&
                message.role === "user" &&
                index === messages.length - 2
              }
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-border/50 bg-card/50 backdrop-blur-sm">
        {isCreditsExhausted ? (
          <div className="px-3 pt-3">
            <UpgradeCta
              reason={`You've used all ${creditsTotal} free messages this month`}
              resetDays={creditsResetDays}
            />
          </div>
        ) : (
          <div className="px-3 pt-2">
            <ModelSelector
              selectedModelId={selectedModelId}
              onModelChange={onModelChange}
              userPlan={userPlan}
              disabled={isStreaming}
            />
          </div>
        )}
        <ChatInput
          onSend={onSendMessage}
          isStreaming={isStreaming}
          creditsRemaining={creditsRemaining}
          isCreditsExhausted={isCreditsExhausted}
          supportsVision={supportsVision}
        />
      </div>
    </div>
  );
}
