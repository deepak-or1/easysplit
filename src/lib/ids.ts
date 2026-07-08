import { customAlphabet, nanoid } from "nanoid";

/** Room codes: short, unambiguous (no 0/O/1/l/I), URL-safe, easy to read aloud/text. */
const roomAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";
const roomCode = customAlphabet(roomAlphabet, 8);

export function newRoomId(): string {
  return roomCode();
}

export function newId(): string {
  return nanoid(16);
}

/** Secret bearer token proving host-ness. Never rendered to guests. */
export function newHostKey(): string {
  return nanoid(28);
}
