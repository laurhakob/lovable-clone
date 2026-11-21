import { Hono } from "hono";
import { AppVariables, Env } from "../types";
import { ChatMessage, ChatSession, ImageAttachment } from "../types/chat";
import { sanitizeChatMessage } from "../services/sanitize";
import { DEFAULT_MODEL, MODEL_REGISTRY, getModel } from "../ai/providers";
import { checkCredits, deductCredits } from "../services/credits";
import { Project, ProjectFile, Version } from "../types/project";
import { buildSystemPrompt, prepareChatHistory } from "../ai/system-prompt";
import { ModelMessage, streamText } from "ai";
import {
  mergeFiles,
  parseFilesFromResponse,
  extractExplanation,
} from "../ai/file-parser";
import { streamSSE } from "hono/streaming";

const chatRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------
// GET /api/chat/:projectId – Get chat history
// ---------------------------------------------------------------

/**
 * Returns the chat history for a project.
 * Used by the editor page to restore chat messages on mount.
 * A project with no chat yet simply returns an empty message list.
 */

chatRoutes.get("/:projectId", async (c) => {
  const userId = c.var.userId;
  const projectId = c.req.param("projectId");

  const project = await c.env.METADATA.get<Project>(
    `project:${projectId}`,
    "json",
  );

  if (!project) {
    return c.json({ error: "Project not found", code: "NOT_FOUND" }, 404);
  }

  if (project.userId !== userId) {
    return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 403);
  }

  const chatHistory = await c.env.METADATA.get<ChatSession>(
    `chat:${projectId}`,
    "json",
  );

  return c.json({ messages: chatHistory?.messages ?? [] });
});

chatRoutes.post("/:projectId", async (c) => {
  const userId = c.var.userId;
  const projectId = c.req.param("projectId");

  // --- 1. Parse and validate request body ---
  const body = await c.req.json<{
    message: string;
    model?: string;
    images?: ImageAttachment[];
  }>();

  const userMessage = sanitizeChatMessage(body.message || "");
  if (!userMessage) {
    return c.json(
      { error: "Message is required", code: "VALIDATION_ERROR" },
      400,
    );
  }
  const modelId = body.model || DEFAULT_MODEL;

  // Validate images – max 5 images, max 4MB each
  const images = body.images || [];
  if (images.length > 5) {
    return c.json(
      { error: "Maximum 5 images per message", code: "VALIDATION_ERROR" },
      400,
    );
  }
  for (const img of images) {
    const sizeBytes = (img.base64.length * 3) / 4; // approximate base64 decoded size
    if (sizeBytes > 4 * 1024 * 1024) {
      return c.json(
        { error: "Each image must be under 4MB", code: "VALIDATION_ERROR" },
        400,
      );
    }
  }

  // Validate model exists in registry
  const modelConfig = MODEL_REGISTRY[modelId];
  if (!modelConfig) {
    return c.json(
      { error: `Unknown model: ${modelId}`, code: "INVALID_MODEL" },
      400,
    );
  }

  // --- 2. Verify project exists and belongs to user ---
  const project = await c.env.METADATA.get<Project>(
    `project:${projectId}`,
    "json",
  );

  if (!project) {
    return c.json({ error: "Project not found", code: "NOT_FOUND" }, 404);
  }

  if (project.userId !== userId) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  // --- 3. Check credits and plan-based model gating ---
  const creditCheck = await checkCredits(userId, modelConfig.creditCost, c.env);

  // Block free users from premium-tier models
  if (modelConfig.tier === "premium" && creditCheck.credits.plan === "free") {
    return c.json(
      {
        error:
          "Premium models require a Pro plan. Upgrade to access Claude Sonnet, GPT-4o, and more.",
        code: "PREMIUM_MODEL_LOCKED",
        plan: creditCheck.credits.plan,
      },
      403,
    );
  }

  if (!creditCheck.allowed) {
    return c.json(
      {
        error: "You've used all your credits. Upgrade to Pro for unlimited.",
        code: "CREDITS_EXHAUSTED",
        remaining: creditCheck.credits.remaining,
        required: modelConfig.creditCost,
      },
      402,
    );
  }

  // --- 4. Load existing project files from R2 ---
  const versionKey = `${projectId}/v${project.currentVersion}/files.json`;
  const versionObject = await c.env.FILES.get(versionKey);

  let existingFiles: ProjectFile[] = [];
  if (versionObject) {
    const versionData = (await versionObject.json()) as Version;
    existingFiles = versionData.files || [];
  }

  // --- 5. Load chat history from KV ---
  const chatSession = await c.env.METADATA.get<ChatSession>(
    `chat:${projectId}`,
    "json",
  );
  const chatHistory = chatSession?.messages || [];

  // --- 6. Build the AI prompt with context management ---
  const systemPrompt = buildSystemPrompt(existingFiles);

  // Build message history for the AI using sliding window + summaries
  const rawMessages: Array<{ role: "user" | "assistant"; content: string }> =
    [];

  for (const msg of chatHistory) {
    // Skip system messages (e.g. "Restored to version X") – they're UI-only
    if (msg.role === "system") continue;
    rawMessages.push({ role: msg.role, content: msg.content });
  }

  // Apply context window management – trim old messages, summarize long ones
  const trimmedHistory = prepareChatHistory(rawMessages);

  // Build messages in AI SDK format using ModelMessage type
  // trimmedHistory entries have { role: "user"|"assistant", content: string }
  // We map them to properly typed ModelMessage objects
  const sdkMessages: ModelMessage[] = trimmedHistory.map((msg) =>
    msg.role === "user"
      ? { role: "user" as const, content: msg.content }
      : { role: "assistant" as const, content: msg.content },
  );

  // Append current user message – multimodal if images + vision model
  if (images.length > 0 && modelConfig.supportsVision) {
    sdkMessages.push({
      role: "user" as const,
      content: [
        { type: "text" as const, text: userMessage },
        ...images.map((img) => ({
          type: "image" as const,
          image: img.base64, // AI SDK field name (was: base64)
          mimeType: img.mediaType, // AI SDK field name (was: mediaType)
        })),
      ],
    });
  } else {
    sdkMessages.push({ role: "user" as const, content: userMessage });
  }

  // --- 7. Stream the AI response ---
  return streamSSE(c, async (stream) => {
    let fullResponse = "";
    let eventId = 0;

    try {
      // Get the AI SDK model instance for the selected model
      const model = getModel(modelId, c.env);

      // streamText returns immediately – streaming happens when we iterate textStream
      const result = streamText({
        model,
        system: systemPrompt,
        messages: sdkMessages,
        maxOutputTokens: modelConfig.maxOutputTokens,
      });

      // Iterate the text stream – each chunk is forwarded as our custom SSE event
      // This replaces the onChunk callback pattern from our custom providers
      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        await stream.writeSSE({
          event: "chunk",
          data: JSON.stringify({ text: chunk }),
          id: String(eventId++),
        });
      }

      // --- 8. Parse files from the complete response ---
      const parsedFiles = parseFilesFromResponse(fullResponse);
      const changedFilePaths = parsedFiles.map((f) => f.path);
      console.log(`[chat] Parsed ${parsedFiles.length} files from AI response`);

      // If the AI returned no files, just send the text as explanation
      // This handles cases where the AI only provides advice without code
      const mergedFiles =
        parsedFiles.length > 0
          ? mergeFiles(existingFiles, parsedFiles)
          : existingFiles;

      // --- 9. Store new version in R2 (only if files changed) ---
      let newVersionNumber = project.currentVersion;

      if (parsedFiles.length > 0) {
        newVersionNumber = project.currentVersion + 1;
        console.log(
          `[chat] Creating version v${newVersionNumber} with ${mergedFiles.length} files`,
        );

        const newVersion: Version = {
          versionNumber: newVersionNumber,
          prompt: userMessage,
          model: modelId,
          files: mergedFiles,
          changedFiles: changedFilePaths,
          type: "ai",
          createdAt: new Date().toISOString(),
          fileCount: mergedFiles.length,
        };

        try {
          await c.env.FILES.put(
            `${projectId}/v${newVersionNumber}/files.json`,
            JSON.stringify(newVersion),
          );
          console.log(
            `[chat] R2 put SUCCESS: ${projectId}/v${newVersionNumber}/files.json`,
          );
        } catch (r2Error) {
          console.error(`[chat] R2 put FAILED:`, r2Error);
          throw r2Error;
        }

        // Update project metadata
        project.currentVersion = newVersionNumber;
        project.updatedAt = new Date().toISOString();

        try {
          await c.env.METADATA.put(
            `project:${projectId}`,
            JSON.stringify(project),
          );
          console.log(
            `[chat] KV put SUCCESS: project:${projectId} (v${newVersionNumber})`,
          );
        } catch (kvError) {
          console.error(`[chat] KV put FAILED (project metadata):`, kvError);
          throw kvError;
        }
      }

      // --- 10. Deduct credits after successful generation ---
      const updatedCredits = await deductCredits(
        userId,
        modelConfig.creditCost,
        c.env,
      );
      console.log(
        `[chat] Credits deducted. Remaining: ${updatedCredits.remaining}`,
      );

      // --- 11. Save chat messages to KV ---
      const explanationText = extractExplanation(fullResponse);

      const newUserMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
        images: images.length > 0 ? images : undefined,
      };

      const newAssistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: "assistant",
        content: explanationText,
        timestamp: new Date().toISOString(),
        versionNumber: parsedFiles.length > 0 ? newVersionNumber : undefined,
        model: modelId,
        changedFiles: parsedFiles.length > 0 ? changedFilePaths : undefined,
      };

      const updatedChatSession: ChatSession = {
        projectId,
        messages: [...chatHistory, newUserMessage, newAssistantMessage],
        createdAt: chatSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await c.env.METADATA.put(
          `chat:${projectId}`,
          JSON.stringify(updatedChatSession),
        );
        console.log(
          `[chat] KV put SUCCESS: chat:${projectId} (${updatedChatSession.messages.length} messages)`,
        );
      } catch (kvError) {
        console.error(`[chat] KV put FAILED (chat history):`, kvError);
        throw kvError;
      }

      // --- 12. Send final events ---
      // Send parsed files so the client can update Sandpack + Monaco
      if (parsedFiles.length > 0) {
        await stream.writeSSE({
          event: "files",
          data: JSON.stringify({ files: mergedFiles }),
          id: String(eventId++),
        });
      }

      // Send done event with metadata
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          versionId: `v${newVersionNumber}`,
          model: modelId,
          changedFiles: changedFilePaths,
          creditsRemaining: updatedCredits.remaining,
        }),
        id: String(eventId++),
      });
    } catch (error) {
      // --- Error handling with categorized messages ---
      const rawError =
        error instanceof Error ? error.message : "Unknown error occurred";

      console.error("Chat generation error:", rawError);

      // Categorize the error for a user-friendly message
      let userMessage: string;
      let errorCode: string;

      if (rawError.includes("429") || rawError.includes("rate limit")) {
        userMessage = "Too many requests. Please wait a moment and try again.";
        errorCode = "RATE_LIMITED";
      } else if (rawError.includes("401") || rawError.includes("api key")) {
        userMessage = "AI service configuration error. Please contact support.";
        errorCode = "AUTH_FAILED";
      } else if (
        rawError.includes("500") ||
        rawError.includes("503") ||
        rawError.includes("unavailable")
      ) {
        userMessage =
          "The AI service is temporarily unavailable. Please try again.";
        errorCode = "SERVICE_UNAVAILABLE";
      } else if (rawError.includes("timeout") || rawError.includes("TIMEOUT")) {
        userMessage = "Generation timed out. Please try a simpler request.";
        errorCode = "TIMEOUT";
      } else {
        userMessage = "Failed to generate code. Please try again.";
        errorCode = "GENERATION_FAILED";
      }

      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: userMessage,
          code: errorCode,
        }),
        id: String(eventId++),
      });
    }
  });
});

export { chatRoutes };