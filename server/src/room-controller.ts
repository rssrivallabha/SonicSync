import { CommandMessage } from "../../core/protocol/src/messages.js";
import { CommandGate } from "../../core/security/src/index.js";
import { applyCommand, RoomAuthority } from "../../core/sync/src/index.js";
import { RoomRegistry } from "./room-registry.js";

export interface CommandResult {
  readonly accepted: boolean;
  readonly reason: string;
  readonly authority: RoomAuthority;
}

export class RoomController {
  private readonly registry: RoomRegistry;
  private readonly gates = new Map<string, CommandGate>();

  constructor(registry = new RoomRegistry()) {
    this.registry = registry;
  }

  createRoom(hostId: string) {
    return this.registry.createRoom(hostId);
  }

  private gateFor(roomId: string): CommandGate {
    let gate = this.gates.get(roomId);
    if (!gate) {
      gate = new CommandGate();
      this.gates.set(roomId, gate);
    }
    return gate;
  }

  async authenticate(
    message: Parameters<RoomRegistry["verifyAuthentication"]>[0],
    nowSeconds: number,
  ) {
    return this.registry.verifyAuthentication(message, nowSeconds);
  }

  issueCommand(
    roomId: string,
    senderId: string,
    role: "HOST" | "PARTICIPANT",
    command: Extract<CommandMessage["command"], "PLAY" | "PAUSE" | "STOP" | "RESET" | "SEEK" | "RATE" | "VOLUME" | "MUTE" | "SYNC">,
    nowSeconds: number,
    effectiveAtSeconds: number,
    options: {
      readonly positionSeconds?: number;
      readonly rate?: number;
      readonly volume?: number;
      readonly mute?: boolean;
    } = {},
  ): CommandResult {
    const current = this.registry.getAuthority(roomId);
    const timelineChanging = new Set([
      "PLAY",
      "PAUSE",
      "STOP",
      "RESET",
      "SEEK",
      "RATE",
    ]).has(command);

    const generated = {
      kind:
        command === "SYNC"
          ? "PLAY"
          : command,
      revision: current.revision + 1,
      timelineEpoch:
        current.timelineEpoch + (timelineChanging ? 1 : 0),
      effectiveAtSeconds,
      ...options,
    } as const;
    const gate = this.gateFor(roomId);
    const decision = gate.check({
      senderId,
      role,
      command,
      messageId: globalThis.crypto.randomUUID(),
      sequence: generated.revision,
      nowSeconds,
      expirySeconds: effectiveAtSeconds + 30,
    });

    if (!decision.accepted) {
      return { accepted: false, reason: decision.reason, authority: current };
    }

    if (command === "SYNC") {
      return { accepted: true, reason: "sync request accepted", authority: current };
    }

    const authority = applyCommand(current, generated);
    this.registry.setAuthority(roomId, authority);
    return { accepted: true, reason: "accepted", authority };
  }

  getAuthority(roomId: string): RoomAuthority {
    return this.registry.getAuthority(roomId);
  }
}
