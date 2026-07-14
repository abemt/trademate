import type { ReactNode } from "react";
import { IconX } from "./Icons";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div
        onClick={onClose}
        className="animate-fade-in fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
      />
      <div className="animate-sheet-in fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-white/10 bg-ink-900 p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-[0_-20px_60px_rgb(0_0_0/0.5)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-white/10 bg-ink-800 p-2 text-ink-300 transition hover:text-white"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
