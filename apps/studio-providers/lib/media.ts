/**
 * Lengths of the files the studio sells, read from the files themselves: a WAV's data size over its
 * byte rate, an MP4's movie header (mvhd) duration over its timescale. Standard library only.
 */

/** Seconds of audio in a WAV, or throws. */
export function wavSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 20 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") {
      if (!byteRate) throw new Error("WAV has no format chunk before its data");
      return Math.min(size, bytes.length - at - 8) / byteRate;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("WAV has no data chunk");
}

/** Seconds of an MP4 from its moov/mvhd box, or throws. */
export function mp4Seconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  function find(start: number, end: number, want: string): [number, number] | undefined {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return undefined;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return undefined;
      if (tag(at + 4) === want) return [at + header, at + size];
      at += size;
    }
    return undefined;
  }
  const moov = find(0, bytes.length, "moov");
  if (!moov) throw new Error("MP4 has no moov box");
  const mvhd = find(moov[0], moov[1], "mvhd");
  if (!mvhd) throw new Error("MP4 has no mvhd box");
  const [at] = mvhd;
  const version = bytes[at];
  const timescale = version === 1 ? view.getUint32(at + 20) : view.getUint32(at + 12);
  const duration = version === 1 ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16);
  if (!timescale) throw new Error("MP4 has no timescale");
  return duration / timescale;
}
