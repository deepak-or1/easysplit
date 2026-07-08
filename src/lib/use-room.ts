"use client";

import useSWR from "swr";
import type { RoomState } from "./types";
import { getRoom } from "./api";

/**
 * Live room state via polling (4s). Simple, robust, and plenty for a dinner
 * table; swap for Supabase Realtime/websockets later without touching UIs.
 */
export function useRoom(splitId: string) {
  const { data, error, isLoading, mutate } = useSWR<RoomState>(
    splitId ? `room:${splitId}` : null,
    () => getRoom(splitId),
    { refreshInterval: 4000, revalidateOnFocus: true },
  );
  return { room: data, error, isLoading, mutate };
}
