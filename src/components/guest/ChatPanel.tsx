"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Clarification, FeedMessage } from "@/lib/types";
import type { ClaimResponse } from "@/lib/api";
import { Avatar, Chip } from "@/components/ui";

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 ml-9 max-w-[85%] break-words rounded-2xl rounded-tl-sm bg-cream px-3.5 py-2 text-sm text-ink">
      {children}
    </div>
  );
}

export function ChatPanel({
  feed,
  participantId,
  onSend,
}: {
  feed: FeedMessage[];
  participantId: string;
  onSend: (message: string) => Promise<ClaimResponse | null>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clarify, setClarify] = useState<Clarification | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const sorted = [...feed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [feed.length, clarify]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const res = await onSend(trimmed);
    setSending(false);
    setClarify(res?.parse?.clarification ?? null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = text;
    setText("");
    await send(message);
  }

  return (
    <div className="rounded-card border border-line/60 bg-card p-3.5 shadow-card">
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No messages yet — try “I had the burger and half the fries”.
          </p>
        ) : (
          sorted.map((m) => {
            const isMe = m.participantId === participantId;
            const label = isMe ? "You" : m.participantName ?? "Someone";
            return (
              <div key={m.id}>
                <div className="flex items-start gap-2">
                  <Avatar name={m.participantName ?? "?"} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-muted">{label}</p>
                    <p className="break-words text-[15px] leading-snug text-ink">{m.body}</p>
                  </div>
                </div>
                {m.reply && <BotBubble>{m.reply}</BotBubble>}
              </div>
            );
          })
        )}

        {clarify && clarify.options && clarify.options.length > 0 && (
          <div className="no-scrollbar ml-9 flex flex-wrap gap-1.5">
            {clarify.options.map((opt) => (
              <Chip key={opt} disabled={sending} onClick={() => void send(opt)}>
                {opt}
              </Chip>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I had the burger and half the fries…"
          enterKeyHint="send"
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-4 py-2.5 text-base text-ink outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-deep active:scale-95 disabled:opacity-45 disabled:pointer-events-none"
        >
          {sending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span className="text-lg leading-none">↑</span>
          )}
        </button>
      </form>
    </div>
  );
}
