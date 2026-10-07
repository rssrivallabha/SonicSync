export const PROTOCOL_VERSION = 1 as const;

export type MessageType =
  | "HELLO" | "AUTH" | "ACK" | "CLOCK_PROBE" | "CLOCK_REPLY"
  | "TRACK" | "READY" | "COMMAND" | "TELEMETRY" | "HEARTBEAT";

export interface BaseMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly messageType: MessageType;
  readonly messageId: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly timelineEpoch: number;
  readonly commandRevision: number;
  readonly timestamp: number;
  readonly sequence?: number;
  readonly expiry?: number;
}

export interface AuthMessage extends BaseMessage {
  readonly messageType: "AUTH";
  readonly nonce: string;
  readonly proof: string;
}

export interface CommandMessage extends BaseMessage {
  readonly messageType: "COMMAND";
  readonly command: "PLAY" | "PAUSE" | "STOP" | "RESET" | "SEEK" | "RATE" | "VOLUME" | "MUTE" | "SYNC";
  readonly effectiveAt: number;
  readonly positionSeconds?: number;
  readonly rate?: number;
  readonly volume?: number;
  readonly mute?: boolean;
}

export type ProtocolMessage = BaseMessage | AuthMessage | CommandMessage;

export function isCommandMessage(message: ProtocolMessage): message is CommandMessage {
  return message.messageType === "COMMAND";
}

export function isAuthMessage(message: ProtocolMessage): message is AuthMessage {
  return message.messageType === "AUTH";
}
