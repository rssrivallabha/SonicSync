export type SessionRole = "HOST" | "PARTICIPANT";
export type ProtectedCommand = "PLAY" | "PAUSE" | "STOP" | "RESET" | "SEEK" | "RATE" | "VOLUME" | "MUTE" | "SYNC" | "KICK" | "LOCK" | "QUEUE";

const participantAllowed = new Set<ProtectedCommand>(["SYNC"]);

export function isCommandAuthorized(role: SessionRole, command: ProtectedCommand): boolean {
  if (role === "HOST") return true;
  return participantAllowed.has(command);
}
