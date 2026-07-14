import { useRef, useState } from "react";
import { screenshotUrl, uploadScreenshot } from "../lib/images";
import { IconPlus, IconX } from "./Icons";

export function ScreenshotPicker({
  ids,
  onChange,
  max = 3,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    const room = max - ids.length;
    const list = [...files].slice(0, room);
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        added.push(await uploadScreenshot(f));
      } catch {
        setError("Upload failed — check your connection.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) onChange([...ids, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <div key={id} className="relative">
            <img
              src={screenshotUrl(id)}
              alt="chart screenshot"
              className="h-20 w-28 rounded-lg border border-white/10 object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(ids.filter((x) => x !== id))}
              aria-label="Remove screenshot"
              className="absolute -right-1.5 -top-1.5 rounded-full border border-white/20 bg-ink-950 p-1 text-ink-300 hover:text-white"
            >
              <IconX className="h-3 w-3" />
            </button>
          </div>
        ))}
        {uploading > 0 && (
          <div className="flex h-20 w-28 animate-pulse items-center justify-center rounded-lg border border-white/10 bg-ink-800 text-xs text-ink-400">
            uploading…
          </div>
        )}
        {ids.length + uploading < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 bg-ink-800/60 text-[11px] text-ink-400 transition hover:border-gold-500/50 hover:text-gold-300"
          >
            <IconPlus className="h-4 w-4" />
            chart shot
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />
      {error && <p className="mt-1.5 text-xs text-down">{error}</p>}
    </div>
  );
}
