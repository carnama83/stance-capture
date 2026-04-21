// src/components/AvatarUploader.tsx
// M-A02: Canvas-based crop/preview modal before upload (no external dependency).
// M-A03: Storage cleanup — removes old file from Storage on replace and on remove.
//        Requires currentPath prop so the caller can pass the stored path alongside the URL.
//        Falls back gracefully when path is unknown (old rows without path).
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

// ── Crop modal ──────────────────────────────────────────────────────────────

interface CropModalProps {
  src: string;    // object URL of the selected file
  file: File;
  onAccept: (cropped: Blob, ext: string) => void;
  onCancel: () => void;
}

function CropModal({ src, file, onAccept, onCancel }: CropModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef    = React.useRef<HTMLImageElement>(null);

  const [drag, setDrag] = React.useState<{
    startX: number; startY: number; startOx: number; startOy: number;
  } | null>(null);
  const [cropBox, setCropBox] = React.useState({ ox: 0, oy: 0, size: 0 });
  const [naturalW, setNaturalW] = React.useState(0);
  const [naturalH, setNaturalH] = React.useState(0);
  const [canvasDims, setCanvasDims] = React.useState({ w: 0, h: 0 });

  const CANVAS_MAX = 320;

  function drawOverlay(
    img: HTMLImageElement,
    box: { ox: number; oy: number; size: number },
    cw: number,
    ch: number,
  ) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    // draw full image dimmed
    ctx.drawImage(img, 0, 0, cw, ch);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, cw, ch);
    // draw clear crop area from image
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.ox, box.oy, box.size, box.size);
    ctx.clip();
    ctx.drawImage(img, 0, 0, cw, ch);
    ctx.restore();
    // crop border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(box.ox, box.oy, box.size, box.size);
  }

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    setNaturalW(nw);
    setNaturalH(nh);
    const scale = CANVAS_MAX / Math.max(nw, nh);
    const cw = Math.round(nw * scale);
    const ch = Math.round(nh * scale);
    const size = Math.min(cw, ch);
    const box = { ox: Math.round((cw - size) / 2), oy: Math.round((ch - size) / 2), size };
    if (canvasRef.current) {
      canvasRef.current.width  = cw;
      canvasRef.current.height = ch;
    }
    setCanvasDims({ w: cw, h: ch });
    setCropBox(box);
    drawOverlay(img, box, cw, ch);
  }

  React.useEffect(() => {
    if (!imgRef.current || !canvasDims.w) return;
    drawOverlay(imgRef.current, cropBox, canvasDims.w, canvasDims.h);
  }, [cropBox, canvasDims]); // eslint-disable-line react-hooks/exhaustive-deps

  function getCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = canvasRef.current!.width  / rect.width;
    const sy = canvasRef.current!.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = getCanvasCoords(e);
    if (
      x >= cropBox.ox && x <= cropBox.ox + cropBox.size &&
      y >= cropBox.oy && y <= cropBox.oy + cropBox.size
    ) {
      setDrag({ startX: x, startY: y, startOx: cropBox.ox, startOy: cropBox.oy });
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag || !canvasRef.current) return;
    const { x, y } = getCanvasCoords(e);
    const newOx = Math.max(0, Math.min(canvasDims.w - cropBox.size, drag.startOx + (x - drag.startX)));
    const newOy = Math.max(0, Math.min(canvasDims.h - cropBox.size, drag.startOy + (y - drag.startY)));
    setCropBox(b => ({ ...b, ox: newOx, oy: newOy }));
  }

  function onMouseUp() { setDrag(null); }

  function onSizeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newSize = parseInt(e.target.value, 10);
    const newOx = Math.max(0, Math.min(canvasDims.w - newSize, cropBox.ox));
    const newOy = Math.max(0, Math.min(canvasDims.h - newSize, cropBox.oy));
    setCropBox({ ox: newOx, oy: newOy, size: newSize });
  }

  function onConfirm() {
    if (!canvasRef.current || !imgRef.current || !naturalW) return;
    const scaleX = naturalW / canvasDims.w;
    const scaleY = naturalH / canvasDims.h;
    const sx = Math.round(cropBox.ox * scaleX);
    const sy = Math.round(cropBox.oy * scaleY);
    const sw = Math.round(cropBox.size * scaleX);
    const sh = Math.round(cropBox.size * scaleY);
    const out = document.createElement("canvas");
    out.width  = sw;
    out.height = sh;
    out.getContext("2d")!.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);
    const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const ext      = file.type === "image/png" ? "png" : "jpg";
    out.toBlob(blob => { if (blob) onAccept(blob, ext); }, mimeType, 0.92);
  }

  const maxSize = Math.min(canvasDims.w, canvasDims.h);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-lg shadow-xl p-4 space-y-3 max-w-sm w-full mx-4">
        <div className="text-sm font-semibold">Crop your avatar</div>
        <p className="text-xs text-slate-500">Drag the white square to reposition. Use the slider to resize.</p>

        {/* Hidden img element — used for natural dimensions and drawImage source */}
        <img ref={imgRef} src={src} alt="" className="hidden" onLoad={onImgLoad} crossOrigin="anonymous" />

        <canvas
          ref={canvasRef}
          className="w-full rounded cursor-move select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />

        {naturalW > 0 && maxSize > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Crop size</label>
            <input
              type="range"
              min={50}
              max={maxSize}
              value={cropBox.size}
              onChange={onSizeChange}
              className="w-full"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" className="flex-1 border rounded px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={onConfirm}
            disabled={!naturalW}
          >
            Use this crop
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AvatarUploader ──────────────────────────────────────────────────────────

interface AvatarUploaderProps {
  uid: string;
  handle: string;
  /** Current avatar public URL (or empty string / null) */
  currentUrl?: string | null;
  /**
   * Current avatar storage path, e.g. "avatars/uid/1234567890.jpg".
   * Required for M-A03 storage cleanup. Pass null/undefined for legacy rows
   * where the path was not stored — cleanup will be skipped gracefully.
   */
  currentPath?: string | null;
  /**
   * Called after a successful upload or remove.
   * Receives the new URL (or null) and the new storage path (or null).
   */
  onChange: (url: string | null, path: string | null) => void;
}

export default function AvatarUploader({
  uid,
  handle,
  currentUrl,
  currentPath,
  onChange,
}: AvatarUploaderProps) {
  const client = React.useMemo(getSupabase, []);
  const [msg, setBusy_msg]      = React.useState("");
  const [busy, setBusy]         = React.useState(false);
  const [cropSrc, setCropSrc]   = React.useState<string | null>(null);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  // helper: set message
  function setMsg(m: string) { setBusy_msg(m); }

  // ── File selected — validate then open crop modal ──
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selection of same file after cancel
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setMsg("Use JPG/PNG/WebP"); return;
    }
    if (f.size > 5 * 1024 * 1024) { setMsg("Max 5MB"); return; }

    const objUrl = URL.createObjectURL(f);
    const img = new Image();
    img.src = objUrl;
    img.onload = () => {
      if (img.width < 200 || img.height < 200) {
        URL.revokeObjectURL(objUrl);
        setMsg("Min 200×200px");
        return;
      }
      setPendingFile(f);
      setCropSrc(objUrl);
      setMsg("");
    };
  }

  // ── Crop accepted — upload the cropped blob ──
  async function onCropAccept(cropped: Blob, ext: string) {
    if (!client || !pendingFile) return;
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setPendingFile(null);
    setBusy(true);
    setMsg("");

    try {
      const newPath = `avatars/${uid}/${Date.now()}.${ext}`;
      const mimeType =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

      const { error: uploadErr } = await client.storage
        .from("avatars")
        .upload(newPath, cropped, { upsert: true, contentType: mimeType });
      if (uploadErr) throw uploadErr;

      // M-A03: delete old file after successful upload
      if (currentPath && currentPath !== newPath) {
        await client.storage
          .from("avatars")
          .remove([currentPath])
          .catch(() => {/* non-fatal — orphan is better than blocking the user */});
      }

      const { data } = client.storage.from("avatars").getPublicUrl(newPath);
      const url  = data.publicUrl;
      const alt  = `Avatar of @${handle}`;

      // avatars table insert is best-effort — failure doesn't block the upload
      try {
        await client.from("avatars").insert({ user_id: uid, url, alt_text: alt });
      } catch { /* non-fatal */ }

      onChange(url, newPath);
      setMsg("Uploaded.");
    } catch (err: any) {
      setMsg(err.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function onCropCancel() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setPendingFile(null);
  }

  // ── Remove avatar ──
  async function remove() {
    if (!client) { setMsg("Supabase OFF"); return; }
    setBusy(true);
    setMsg("");
    try {
      // M-A03: remove from Storage if path is known
      if (currentPath) {
        await client.storage
          .from("avatars")
          .remove([currentPath])
          .catch(() => {});
      }
      onChange(null, null);
      setMsg("Removed (fallback in use).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {cropSrc && pendingFile && (
        <CropModal
          src={cropSrc}
          file={pendingFile}
          onAccept={onCropAccept}
          onCancel={onCropCancel}
        />
      )}

      <div className="space-y-2">
        {currentUrl && (
          <img
            src={currentUrl}
            alt={`Avatar of @${handle}`}
            className="h-16 w-16 rounded-full object-cover border"
          />
        )}
        <label className="inline-block">
          <span className="cursor-pointer rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
            {currentUrl ? "Replace avatar" : "Upload avatar"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFile}
            disabled={busy}
          />
        </label>
        {currentUrl && (
          <button
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 ml-2"
            type="button"
            onClick={remove}
            disabled={busy}
          >
            Remove avatar
          </button>
        )}
        {busy  && <div className="text-xs text-slate-500">Uploading…</div>}
        {msg   && <div className="text-xs text-slate-700">{msg}</div>}
      </div>
    </>
  );
}
