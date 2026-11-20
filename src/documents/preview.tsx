"use client";

import { useState } from "react";

/**
 * Original file next to the extracted fields, in the browser's own viewer (#165). Only PDF and images: XML and text
 * are already shown as fields. The iframe/img mounts only once the user opens the section, so no signed URL is
 * requested (and no PDF viewer keeps the network busy) while it is closed.
 * Example: `<Preview id="..." name="nota.pdf" mime="application/pdf" />`.
 */
export function Preview({ id, name, mime }: { id: string; name: string; mime: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const src = `/api/documents/${id}?inline=1`;
  if (mime !== "application/pdf" && !mime?.startsWith("image/")) return null;
  return (
    <details className="mt-1 text-xs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer underline">Ver original</summary>
      {open &&
        (mime === "application/pdf" ? (
          <iframe src={src} title={`Original: ${name}`} className="mt-2 h-[70vh] w-full rounded-xl border border-line bg-surface" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from storage, not a static asset
          <img src={src} alt={`Original: ${name}`} className="mt-2 max-h-[70vh] w-auto rounded-xl border border-line" />
        ))}
    </details>
  );
}
