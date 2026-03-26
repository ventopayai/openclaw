/**
 * Inbound webhook handler for WhatsApp Business messages forwarded from the hub.
 * Receives either the enriched payload (with media) or the raw Meta webhook payload (backward compat).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/whatsapp-business";
import type { WabEnrichedPayload, WabEnrichedMessage } from "./types.js";

// 25 MB to accommodate base64-encoded media
const PREAUTH_MAX_BODY_BYTES = 25 * 1024 * 1024;
const PREAUTH_BODY_TIMEOUT_MS = 30_000;

/** Read the full request body as a string. */
async function readBody(req: IncomingMessage): Promise<
  | { ok: true; body: string }
  | { ok: false; statusCode: number; error: string }
> {
  try {
    const body = await readRequestBodyWithLimit(req, {
      maxBytes: PREAUTH_MAX_BODY_BYTES,
      timeoutMs: PREAUTH_BODY_TIMEOUT_MS,
    });
    return { ok: true, body };
  } catch (err) {
    if (isRequestBodyLimitError(err)) {
      return {
        ok: false,
        statusCode: err.statusCode,
        error: requestBodyErrorToText(err.code),
      };
    }
    return { ok: false, statusCode: 400, error: "Invalid request body" };
  }
}

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface WhatsAppBusinessWebhookHandlerDeps {
  deliver: (msg: {
    body: string;
    from: string;
    provider: string;
    chatType: string;
    accountId: string;
    commandAuthorized: boolean;
    mediaBuffer?: Buffer;
    mediaMimeType?: string;
    mediaFileName?: string;
  }) => Promise<string | null>;
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Try to parse as enriched payload from hub. Returns messages if valid, null otherwise.
 */
function parseEnrichedPayload(payload: Record<string, unknown>): WabEnrichedMessage[] | null {
  if (payload.type !== "whatsapp-business-enriched") return null;
  const messages = payload.messages;
  if (!Array.isArray(messages)) return null;
  return messages as WabEnrichedMessage[];
}

/**
 * Extract messages from Meta's raw webhook payload (backward compatibility).
 */
function extractFromRawMeta(payload: Record<string, unknown>): Array<{ from: string; text: string }> {
  const results: Array<{ from: string; text: string }> = [];
  const entries = payload.entry as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(entries)) return results;

  for (const entry of entries) {
    const changes = entry.changes as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const msgs = value.messages as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(msgs)) continue;

      for (const msg of msgs) {
        const from = msg.from as string | undefined;
        const textObj = msg.text as { body?: string } | undefined;
        const text = textObj?.body;
        if (from && text) {
          results.push({ from, text });
        }
      }
    }
  }

  return results;
}

/**
 * Create an HTTP request handler for WhatsApp Business webhooks forwarded from the hub.
 *
 * Supports two payload formats:
 * 1. Enriched payload (from hub with media): { type: "whatsapp-business-enriched", messages: [...] }
 * 2. Raw Meta webhook payload (backward compatibility): entry[].changes[].value.messages[]
 */
export function createWhatsAppBusinessWebhookHandler(deps: WhatsAppBusinessWebhookHandlerDeps) {
  const { deliver, log } = deps;

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const bodyResult = await readBody(req);
    if (!bodyResult.ok) {
      log?.error("Failed to read request body", bodyResult.error);
      respondJson(res, bodyResult.statusCode, { error: bodyResult.error });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(bodyResult.body) as Record<string, unknown>;
    } catch {
      respondJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    // ACK immediately
    respondJson(res, 200, { ok: true });

    // Try enriched payload first, fall back to raw Meta format
    const enrichedMessages = parseEnrichedPayload(payload);

    if (enrichedMessages) {
      // Process enriched messages (with potential media)
      for (const msg of enrichedMessages) {
        if (!msg.from || !msg.text) continue;

        const preview = msg.text.length > 100 ? `${msg.text.slice(0, 100)}...` : msg.text;
        log?.info(`WhatsApp Business ${msg.messageType} from ${msg.from}: ${preview}`);

        let mediaBuffer: Buffer | undefined;
        if (msg.mediaBase64) {
          try {
            mediaBuffer = Buffer.from(msg.mediaBase64, "base64");
          } catch {
            log?.error(`Failed to decode base64 media for message from ${msg.from}`);
          }
        }

        try {
          await deliver({
            body: msg.text,
            from: msg.from,
            provider: "whatsapp-business",
            chatType: "direct",
            accountId: "default",
            commandAuthorized: true,
            ...(mediaBuffer ? {
              mediaBuffer,
              mediaMimeType: msg.mediaMimeType,
              mediaFileName: msg.mediaFileName,
            } : {}),
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log?.error(`Failed to process WhatsApp Business message from ${msg.from}: ${errMsg}`);
        }
      }
    } else {
      // Backward compatibility: raw Meta webhook payload
      const rawMessages = extractFromRawMeta(payload);
      for (const msg of rawMessages) {
        const preview = msg.text.length > 100 ? `${msg.text.slice(0, 100)}...` : msg.text;
        log?.info(`WhatsApp Business from ${msg.from}: ${preview}`);

        try {
          await deliver({
            body: msg.text,
            from: msg.from,
            provider: "whatsapp-business",
            chatType: "direct",
            accountId: "default",
            commandAuthorized: true,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log?.error(`Failed to process WhatsApp Business message from ${msg.from}: ${errMsg}`);
        }
      }
    }
  };
}
