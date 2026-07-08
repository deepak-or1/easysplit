import { Suspense } from "react";
import { CreateFlow } from "@/components/new/CreateFlow";
import { Spinner } from "@/components/ui";

// CreateFlow reads useSearchParams (?demo=1), so it must live under a Suspense
// boundary per Next 16's rules.
export default function NewSplitPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-24">
          <Spinner className="size-7" />
        </div>
      }
    >
      <CreateFlow />
    </Suspense>
  );
}
