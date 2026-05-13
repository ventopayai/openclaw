import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  createReasoningFinalAnswerMessage,
  createSubscribedSessionHarness,
} from "./pi-embedded-subscribe.e2e-harness.js";

describe("subscribeEmbeddedPiSession raw payload", () => {
  it("exposes raw text and thinking separately on block reply at message_end", () => {
    const onBlockReply = vi.fn();
    const { emit } = createSubscribedSessionHarness({
      runId: "run",
      onBlockReply,
      blockReplyBreak: "message_end",
    });

    const assistantMessage = createReasoningFinalAnswerMessage();
    emit({ type: "message_end", message: assistantMessage });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    const payload = onBlockReply.mock.calls[0][0];
    expect(payload.text).toBe("Final answer");
    expect(payload.raw).toEqual({
      text: "Final answer",
      thinking: "Because it helps",
    });
  });

  it("promotes inline <think> tags into raw.thinking and keeps raw.text clean", () => {
    const onBlockReply = vi.fn();
    const { emit } = createSubscribedSessionHarness({
      runId: "run",
      onBlockReply,
      blockReplyBreak: "message_end",
    });

    const assistantMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "<think>\nBecause it helps\n</think>\n\nFinal answer",
        },
      ],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    const payload = onBlockReply.mock.calls[0][0];
    expect(payload.text).toBe("Final answer");
    expect(payload.raw).toEqual({
      text: "Final answer",
      thinking: "Because it helps",
    });
  });

  it("returns empty raw.thinking when the assistant message has no thinking", () => {
    const onBlockReply = vi.fn();
    const { emit } = createSubscribedSessionHarness({
      runId: "run",
      onBlockReply,
      blockReplyBreak: "message_end",
    });

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Just the final answer" }],
    } as AssistantMessage;
    emit({ type: "message_end", message: assistantMessage });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    const payload = onBlockReply.mock.calls[0][0];
    expect(payload.text).toBe("Just the final answer");
    expect(payload.raw).toEqual({
      text: "Just the final answer",
      thinking: "",
    });
  });
});
