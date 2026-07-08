import { PayPage } from "@/components/pay/PayPage";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; personId: string }>;
}) {
  const { id, personId } = await params;
  return <PayPage splitId={id} personId={personId} />;
}
