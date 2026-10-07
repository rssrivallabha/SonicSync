import { PROTOCOL_VERSION, ProtocolMessage } from "./messages";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

export function validateProtocolMessage(value: unknown): ValidationResult {
  if (!value || typeof value !== "object") {
    return { valid: false, reason: "message must be an object" };
  }

  const message = value as Partial<ProtocolMessage>;

  if (message.protocolVersion !== PROTOCOL_VERSION) {
    return { valid: false, reason: "unsupported protocol version" };
  }

  const requiredStrings = ["messageType", "messageId", "roomId", "senderId"] as const;
  for (const key of requiredStrings) {
    if (typeof message[key] !== "string" || message[key].length === 0) {
      return { valid: false, reason: `invalid ${key}` };
    }
  }

  for (const key of ["timelineEpoch", "commandRevision", "timestamp"] as const) {
    if (typeof message[key] !== "number" || !Number.isFinite(message[key]) || message[key] < 0) {
      return { valid: false, reason: `invalid ${key}` };
    }
  }

  if (message.messageType === "COMMAND") {
    const command = message as CommandMessage;
    if (typeof command.effectiveAt !== "number" || !Number.isFinite(command.effectiveAt)) {
      return { valid: false, reason: "invalid effectiveAt" };
    }
  }

  return { valid: true, reason: "accepted" };
}
