"use client";

import type { ClaimAction, ItemWithClaims, Participant } from "@/lib/types";
import type { ClaimResponse } from "@/lib/api";
import { EmptyState } from "@/components/ui";
import { ItemRow } from "./ItemRow";

export function ReceiptList({
  items,
  participants,
  participantId,
  onClaim,
}: {
  items: ItemWithClaims[];
  participants: Participant[];
  participantId: string;
  onClaim: (actions: ClaimAction[]) => Promise<ClaimResponse | null>;
}) {
  if (items.length === 0) {
    return (
      <div className="receipt-edge rounded-sm px-5">
        <EmptyState emoji="🧾" title="No items yet" hint="The host is still setting up the receipt." />
      </div>
    );
  }

  return (
    <div className="receipt-edge px-5">
      {items.map((item, i) => (
        <div key={item.id}>
          {i > 0 && <hr className="receipt-rule" />}
          <ItemRow
            item={item}
            participants={participants}
            participantId={participantId}
            onClaim={onClaim}
          />
        </div>
      ))}
    </div>
  );
}
