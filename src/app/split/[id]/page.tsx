import type { Metadata } from "next";
import { GuestRoom } from "@/components/guest/GuestRoom";
import { getRoomState } from "@/lib/store";
import { formatCents } from "@/lib/money";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const room = await getRoomState(id).catch(() => null);
  if (!room) return { title: "Split the bill · EasySplit" };
  const restaurant = room.split.restaurantName?.trim() || "Dinner";
  const total = formatCents(room.settlement.grandTotalCents);
  return {
    title: `${restaurant} · EasySplit`,
    description: `${room.split.hostName} split the ${total} bill from ${restaurant}. Tap to claim what you got — Venmo settles it.`,
  };
}

export default async function SplitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuestRoom splitId={id} />;
}
