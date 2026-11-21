"use client";

import { ChatMessage } from "@/types/chat";
import { getModelById } from "@/lib/models";

export interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isAutoHealInProgress?: boolean;
}

const FILE_TAG_REGEX = /<file\s+path="[^"]+">\n?[\s\S]*?\n?<\/file>/g;

const PARTIAL_FILE_REGEX = /<file\s+path="[^"]+">[\s\S]*$/;

function stripFileTags(content: string, isStreaming: boolean): string {
  let cleaned = content.replace(FILE_TAG_REGEX, "").replace(/\n{3,}/g, "\n\n");

  // Strip partial/incomplete <file> blocks (opening tag without closing tag).
  // Always clean these — old messages saved with fullResponse may have orphans.
  cleaned = cleaned.replace(PARTIAL_FILE_REGEX, "");

  // Strip any leftover closing </file> tags that survived the regex
  cleaned = cleaned.replace(/<\/file>/g, "");

  return cleaned.trim();
}

function hasFileTags(content: string): boolean {
  return /<file\s+path="/.test(content);
}

function formatModelName(modelId: string): string {
  const modelInfo = getModelById(modelId);

  if (modelInfo) return modelInfo.name;

  if (modelId.includes("claude")) return "Claude";
  if (modelId.includes("gemini")) return "Gemini";
  if (modelId.includes("gpt-4o")) return "GPT-4o";
  if (modelId.includes("gpt-4o-mini")) return "GPT-4o Mini";
  if (modelId.includes("deepseek")) return "DeepSeek";
  return modelId; // Fallback to raw ID if no match
}

const AUTO_HEAL_PREFIX = "The app has a build/runtime error";

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

export function MessageBubble({
  message,
  isStreaming,
  isAutoHealInProgress,
}: MessageBubbleProps) {
  return <>Message</>;
}