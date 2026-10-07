import { AuthMessage } from "../../core/protocol/src/messages.js";
import { createSessionProof, generateSessionToken, verifySessionProof } from "../../core/security/src/index.js";
import { CommandSequencer, initialAuthority, RoomAuthority } from "../../core/sync/src/index.js";

export interface RoomParticipant {
  readonly senderId: string;
  readonly authenticatedAtSeconds: number;
  readonly role: "HOST" | "PARTICIPANT";
}

interface RoomRecord {
  readonly roomId: string;
  readonly roomCode: string;
  readonly secretHex: string;
  readonly hostId: string;
  readonly sequencer: CommandSequencer;
  readonly participants: Map<string, RoomParticipant>;
  authority: RoomAuthority;
  nonce: string | null;
}

export interface CreatedRoom {
  readonly roomId: string;
  readonly roomCode: string;
  readonly hostId: string;
}

export class RoomRegistry {
  private readonly roomsById = new Map<string, RoomRecord>();
  private readonly idsByCode = new Map<string, string>();

  createRoom(hostId: string): CreatedRoom {
    if (!hostId || hostId.length > 128) throw new RangeError("invalid hostId");
    let roomCode = "";
    do {
      roomCode = this.createCode();
    } while (this.idsByCode.has(roomCode));

    const roomId = globalThis.crypto.randomUUID();
    const secretHex = generateSessionToken(32);
    const record: RoomRecord = {
      roomId,
      roomCode,
      secretHex,
      hostId,
      sequencer: new CommandSequencer(),
      participants: new Map([[hostId, { senderId: hostId, authenticatedAtSeconds: 0, role: "HOST" }]]),
      authority: initialAuthority(),
      nonce: null,
    };
    this.roomsById.set(roomId, record);
    this.idsByCode.set(roomCode, roomId);
    return { roomId, roomCode, hostId };
  }

  private createCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const random = new Uint8Array(6);
    globalThis.crypto.getRandomValues(random);
    return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
  }

  getRoomIdByCode(roomCode: string): string | null { return this.idsByCode.get(roomCode) ?? null; }

  issueParticipantNonce(roomId: string): string {
    const room = this.roomsById.get(roomId);
    if (!room) throw new Error("room not found");
    room.nonce = generateSessionToken(16);
    return room.nonce;
  }

  async verifyAuthentication(message: AuthMessage, nowSeconds: number): Promise<RoomParticipant> {
    const room = this.roomsById.get(message.roomId);
    if (!room) throw new Error("room not found");
    if (room.nonce === null || message.nonce !== room.nonce) throw new Error("invalid or expired nonce");
    if (!(await verifySessionProof(room.secretHex, room.roomId, message.senderId, message.nonce, message.proof))) throw new Error("authentication failed");
    const role = message.senderId === room.hostId ? "HOST" : "PARTICIPANT";
    const participant = { senderId: message.senderId, authenticatedAtSeconds: nowSeconds, role } as const;
    room.participants.set(message.senderId, participant);
    room.nonce = null;
    return participant;
  }

  async createAuthProof(roomId: string, senderId: string, nonce: string): Promise<string> {
    const room = this.roomsById.get(roomId);
    if (!room) throw new Error("room not found");
    return createSessionProof(room.secretHex, room.roomId, senderId, nonce);
  }

  getAuthority(roomId: string): RoomAuthority {
    const room = this.roomsById.get(roomId);
    if (!room) throw new Error("room not found");
    return { ...room.authority };
  }

  setAuthority(roomId: string, authority: RoomAuthority): void {
    const room = this.roomsById.get(roomId);
    if (!room) throw new Error("room not found");
    room.authority = { ...authority };
  }
}
