"use client";

import { useMemo } from "react";
import * as THREE from "three";

interface Props {
  text: string;
  width?: number;
  height?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  background?: string;
  color?: string;
  fontSize?: number;
  radius?: number;
}

/** Text rendered into a canvas texture so Korean labels work without font files. */
export function CanvasLabel({
  text,
  width = 1.6,
  height = 0.42,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  background = "#fbf7ef",
  color = "#2b2f36",
  fontSize = 56,
  radius = 28,
}: Props) {
  const texture = useMemo(() => {
    const pxW = 512;
    const pxH = Math.round((pxW * height) / width);
    const canvas = document.createElement("canvas");
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.fillStyle = background;
    roundRect(ctx, 2, 2, pxW - 4, pxH - 4, radius);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${fontSize}px "Pretendard Variable", Pretendard, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.fillText(text, pxW / 2, pxH / 2 + fontSize * 0.04);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [text, width, height, background, color, fontSize, radius]);

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
