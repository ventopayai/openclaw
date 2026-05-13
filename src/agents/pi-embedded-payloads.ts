export type BlockReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  audioAsVoice?: boolean;
  isReasoning?: boolean;
  replyToId?: string;
  replyToTag?: boolean;
  replyToCurrent?: boolean;
  /** Raw assistant output split into final text and thinking. Populated on the
   *  final block reply so plugins can handle thinking themselves (e.g. when an
   *  OpenAI-compat provider returns thinking inline with the final text). */
  raw?: {
    text: string;
    thinking: string;
  };
};
