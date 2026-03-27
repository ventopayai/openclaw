/**
 * WhatsApp Business client that sends messages via the hub's outbound API.
 *
 * The hub owns the Meta API credentials. Instances call
 * POST {HUB_URL}/api/whatsapp-business/send with their gateway token, and the
 * hub forwards the message to Meta on their behalf.
 */

function getHubUrl(): string {
  const url = process.env.HUB_URL;
  if (!url) throw new Error("HUB_URL not set — cannot send WhatsApp Business messages");
  return url.replace(/\/+$/, "");
}

function getGatewayToken(): string {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN not set — cannot authenticate with hub");
  return token;
}

async function postToHub(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const hubUrl = getHubUrl();
  const token = getGatewayToken();
  const url = `${hubUrl}/api/whatsapp-business/send`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[whatsapp-business] Hub returned ${res.status}: ${body}`);
    throw new Error(`WhatsApp Business send failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return data;
}

export async function sendWhatsAppMessage(content: string): Promise<Record<string, unknown>> {
  console.log(`[whatsapp-business] Sending text (${content.length} chars)`);
  const data = await postToHub({ text: content });
  console.log(`[whatsapp-business] Text message sent successfully via hub`);
  return data;
}

export async function sendWhatsAppTyping(action: "typing_on" | "typing_off"): Promise<void> {
  await postToHub({ action });
}
