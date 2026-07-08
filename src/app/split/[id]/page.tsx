import { GuestRoom } from "@/components/guest/GuestRoom";

export default async function SplitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuestRoom splitId={id} />;
}
