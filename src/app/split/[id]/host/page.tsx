import { Suspense } from "react";
import { HostDashboard } from "@/components/host/HostDashboard";
import { Spinner } from "@/components/ui";

export default async function HostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-24">
          <Spinner className="size-7" />
        </div>
      }
    >
      <HostDashboard splitId={id} />
    </Suspense>
  );
}
