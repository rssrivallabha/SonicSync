import { CommandMessage } from "../../core/protocol/src/messages.js";
import { CommandGate } from "../../core/security/src/index.js";
import { applyCommand, CommandSequencer, initialAuthority, RoomAuthority } from "../../core/sync/src/index.js";
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
    const sequencer = new CommandSequencer();

    // Synchronize the sequencer to the authority revision/epoch before issuing.
    while (sequencer.snapshot().revision < current.revision) {
      sequencer.next("VOLUME", effectiveAtSeconds, { volume: current.volume });
    }

    const generated = sequencer.next(command, effectiveAtSeconds, options);
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

    const authority = applyCommand(current, generated);
    this.registry.setAuthority(roomId, authority);
    return { accepted: true, reason: "accepted", authority };
  }

  getAuthority(roomId: string): RoomAuthority {
    return this.registry.getAuthority(roomId);
  }
}
