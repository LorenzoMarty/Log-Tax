/** Copies the computed style of every node onto the clone so the SVG snapshot renders without the page's stylesheets. */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) css += `${cs[i]}:${cs.getPropertyValue(cs[i])};`;
  dst.setAttribute("style", css);
  Array.from(src.children).forEach((child, i) => inlineStyles(child, dst.children[i]));
}

/**
 * PNG of a DOM element, built in the browser (SVG foreignObject drawn on a canvas); nothing leaves the device (#132).
 * ponytail: no web fonts or external images in the snapshot, add html-to-image (lazy) if that becomes needed.
 */
export async function elementToPng(el: HTMLElement): Promise<Blob> {
  const { width, height } = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(el, clone);
  clone.querySelectorAll("[data-export-skip]").forEach((n) => n.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const bg = getComputedStyle(el).backgroundColor;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">` +
    `${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg === "rgba(0, 0, 0, 0)" ? "#fff" : bg;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}
