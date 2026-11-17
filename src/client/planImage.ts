"use client";
import { AREA_TYPES } from "@/lib/catalog";
import { centroid } from "@/lib/geometry";
import { tilesForExtent } from "@/lib/projection";
import { FOV } from "@/lib/camera";
import type { Camera, Job } from "@/lib/types";

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = no;
    i.src = src;
  });

/**
 * A top down picture of the plan with a lettered grid, for Claude to match a
 * ground photo against. Tiles come from our own proxy, so the canvas stays clean.
 */
export async function planImage(job: Job, sampleSvg: string | null, opts: { camera?: Camera | null } = {}): Promise<Blob> {
  const W = 1500;
  const ext = job.site.extent;
  const H = Math.round((W * ext.h) / ext.w);
  const k = W / ext.w;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#9a9a90";
  g.fillRect(0, 0, W, H);
  const X = (x: number) => (x - ext.x) * k;
  const Y = (y: number) => (y - ext.y) * k;
  if (job.site.origin && job.site.imagery) {
    const tiles = tilesForExtent(job.site.origin, ext, job.site.imagery.zoom);
    await Promise.all(
      tiles.map(async (t) => {
        const im = await loadImg(`/api/imagery/${t.z}/${t.x}/${t.y}`).catch(() => null);
        if (im) g.drawImage(im, X(t.px), Y(t.py), t.w * k + 1, t.h * k + 1);
      }),
    );
  } else if (sampleSvg) {
    const im = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg)}`);
    g.drawImage(im, 0, 0, W, H);
  }
  g.lineJoin = "round";
  if (job.lot && job.lot.length > 2) {
    g.strokeStyle = "#ffb020";
    g.lineWidth = 3;
    g.setLineDash([14, 8]);
    g.beginPath();
    job.lot.forEach((q, j) => (j ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))));
    g.closePath();
    g.stroke();
    g.setLineDash([]);
  }
  const cam = opts.camera;
  if (cam) {
    const R = 70 * k;
    g.fillStyle = "rgba(143,227,255,.28)";
    g.strokeStyle = "#8fe3ff";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(cam.x), Y(cam.y));
    g.arc(X(cam.x), Y(cam.y), R, cam.angle - FOV / 2, cam.angle + FOV / 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#0b6f8f";
    g.beginPath();
    g.arc(X(cam.x), Y(cam.y), 10, 0, Math.PI * 2);
    g.fill();
    g.font = "bold 20px Arial";
    g.fillStyle = "#8fe3ff";
    g.textAlign = "center";
    g.fillText("PHOTO", X(cam.x), Y(cam.y) + 32);
  }
  job.areas.forEach((a, i) => {
    g.strokeStyle = AREA_TYPES[a.type].color;
    g.lineWidth = 4;
    g.beginPath();
    a.pts.forEach((q, j) => (j ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))));
    g.closePath();
    g.stroke();
    const c = centroid(a.pts);
    const label = `${AREA_TYPES[a.type].label} ${i + 1}`;
    g.font = "bold 22px Arial";
    g.textAlign = "center";
    g.lineWidth = 5;
    g.strokeStyle = "#000";
    g.fillStyle = "#fff";
    g.strokeText(label, X(c[0]), Y(c[1]));
    g.fillText(label, X(c[0]), Y(c[1]));
  });
  g.strokeStyle = "rgba(255,255,255,.55)";
  g.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) {
    g.beginPath();
    g.moveTo((i * W) / 10, 0);
    g.lineTo((i * W) / 10, H);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (i * H) / 10);
    g.lineTo(W, (i * H) / 10);
    g.stroke();
  }
  g.font = "bold 18px Arial";
  g.fillStyle = "#ffe14d";
  g.textAlign = "center";
  for (let i = 0; i < 10; i++) g.fillText("ABCDEFGHIJ"[i], ((i + 0.5) * W) / 10, 22);
  g.textAlign = "left";
  for (let j = 0; j < 10; j++) g.fillText(String(j + 1), 6, ((j + 0.55) * H) / 10);
  g.fillStyle = "#fff";
  g.font = "bold 24px Arial";
  g.fillText("N ↑", W - 70, H - 24);
  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("Could not draw the plan"))), "image/png"));
}
