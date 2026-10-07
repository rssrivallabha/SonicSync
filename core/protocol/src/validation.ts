import { CommandMessage, MessageType, PROTOCOL_VERSION, ProtocolMessage } from "./messages.js";

export interface ValidationLimits {
  readonly maxMessageIdLength: number;
  readonly maxRoomIdLength: number;
  readonly maxSenderIdLength: number;
}

const DEFAULT_LIMITS: ValidationLimits = { maxMessageIdLength: 128, maxRoomIdLength: 64, maxSenderIdLength: 128 };

const MESSAGE_TYPES = new Set<MessageType>(["HELLO", "AUTH", "ACK", "CLOCK_PROBE", "CLOCK_REPLY", "TRACK", "READY", "COMMAND", "TELEMETRY", "HEARTBEAT"]);
const COMMANDS = new Set<CommandMessage["command"]>(["PLAY", "PAUSE", "STOP", "RESET", "SEEK", "RATE", "VOLUME", "MUTE", "SYNC"]);

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

function invalid(reason: string): ValidationResult { return { valid: false, reason }; }

export function validateProtocolMessage(value: unknown, limits: ValidationLimits = DEFAULT_LIMITS): ValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("message must be an object");

  const message = value as Partial<ProtocolMessage>;
  if (message.protocolVersion !== PROTOCOL_VERSION) return invalid("unsupported protocol version");

  if (typeof message.messageType !== "string" || !MESSAGE_TYPES.has(message.messageType as MessageType)) return invalid("invalid messageType");
  const stringLimits: ReadonlyArray<[keyof Pick<ProtocolMessage, "messageId" | "roomId" | "senderId">, number]> = [
    ["messageId", limits.maxMessageIdLength],
    ["roomId", limits.maxRoomIdLength],
    ["senderId", limits.maxSenderIdLength],
  ];
  for (const [key, maxLength] of stringLimits) {
    const valueForKey = message[key];
    if (typeof valueForKey !== "string" || valueForKey.length === 0 || valueForKey.length > maxLength) return invalid(`invalid ${String(key)}`);
  }

  for (const key of ["timelineEpoch", "commandRevision", "timestamp"] as const) {
    const valueForKey = message[key];
    if (typeof valueForKey !== "number" || !Number.isSafeInteger(valueForKey) || valueForKey < 0) return invalid(`invalid ${key}`);
  }

  if (message.sequence !== undefined && (!Number.isSafeInteger(message.sequence) || message.sequence < 0)) return invalid("invalid sequence");
  if (message.expiry !== undefined && (typeof message.expiry !== "number" || !Number.isFinite(message.expiry) || message.expiry < message.timestamp!)) return invalid("invalid expiry");

  if (message.messageType !== "COMMAND") return { valid: true, reason: "accepted" };

  const command = message as CommandMessage;
  if (!COMMANDS.has(command.command)) return invalid("invalid command");
  if (!Number.isFinite(command.effectiveAt) || command.effectiveAt < 0) return invalid("invalid effectiveAt");

  if (command.positionSeconds !== undefined && (!Number.isFinite(command.positionSeconds) || command.positionSeconds < 0)) return invalid("invalid positionSeconds");
  if (command.rate !== undefined && (!Number.isFinite(command.rate) || command.rate <= 0)) return invalid("invalid rate");
  if (command.volume !== undefined && (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1)) return invalid("invalid volume");
  if (command.mute !== undefined && typeof command.mute !== "boolean") return invalid("invalid mute");

  if ((command.command === "SEEK" || command.command === "PLAY") && command.positionSeconds === undefined) return invalid(`${command.command} requires positionSeconds`);
  if (command.command === "RATE" && command.rate === undefined) return invalid("RATE requires rate");
  if (command.command === "VOLUME" && command.volume === undefined) return invalid("VOLUME requires volume");
  if (command.command === "MUTE" && command.mute === undefined) return invalid("MUTE requires mute");

  return { valid: true, reason: "accepted" };
}
