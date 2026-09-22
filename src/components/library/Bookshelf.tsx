"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CanvasLabel } from "./CanvasLabel";
import { BOOK_COLORS, mulberry32, SHELF, type ShelfSpot } from "./layout";

const FRAME = "#d46a4c";
const BOARD = "#e08a6c";

interface Props {
  spot: ShelfSpot;
  index: number;
  active: boolean;
}

interface BookSpec {
  x: number;
  w: number;
  h: number;
  color: string;
  tilt: number;
}

export function Bookshelf({ spot, index, active }: Props) {
  const { width, depth, height, rows } = SHELF;
  const glow = useRef<THREE.Mesh>(null);

  const rowsOfBooks = useMemo(() => {
    const rand = mulberry32(1000 + index * 97);
    const out: BookSpec[][] = [];
    for (let r = 0; r < rows; r++) {
      const books: BookSpec[] = [];
      let x = -width / 2 + 0.12;
      while (x < width / 2 - 0.2) {
        const w = 0.06 + rand() * 0.08;
        const h = 0.3 + rand() * 0.22;
        const gap = rand() < 0.12 ? 0.12 + rand() * 0.2 : 0.008;
        if (x + w > width / 2 - 0.1) break;
        books.push({ x: x + w / 2, w, h, color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)], tilt: rand() < 0.08 ? 0.18 : 0 });
        x += w + gap;
      }
      out.push(books);
    }
    return out;
  }, [index, rows, width]);

  useFrame((state) => {
    if (!glow.current) return;
    const mat = glow.current.material as THREE.MeshBasicMaterial;
    const target = active ? 0.35 + Math.sin(state.clock.elapsedTime * 3) * 0.12 : 0;
    mat.opacity += (target - mat.opacity) * 0.1;
    glow.current.visible = mat.opacity > 0.01;
  });

  const rowHeight = (height - 0.3) / rows;

  return (
    <group position={spot.position} rotation={[0, spot.rotationY, 0]}>
      {/* frame sides, top, back */}
      <mesh castShadow receiveShadow position={[-width / 2 + 0.05, height / 2, 0]}>
        <boxGeometry args={[0.1, height, depth]} />
        <meshStandardMaterial color={FRAME} roughness={0.85} />
      </mesh>
      <mesh castShadow receiveShadow position={[width / 2 - 0.05, height / 2, 0]}>
        <boxGeometry args={[0.1, height, depth]} />
        <meshStandardMaterial color={FRAME} roughness={0.85} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, height - 0.05, 0]}>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color={FRAME} roughness={0.85} />
      </mesh>
      <mesh receiveShadow position={[0, height / 2, -depth / 2 + 0.03]}>
        <boxGeometry args={[width, height, 0.06]} />
        <meshStandardMaterial color="#c85e42" roughness={0.9} />
      </mesh>
      {/* boards + books */}
      {rowsOfBooks.map((books, r) => {
        const y = 0.12 + r * rowHeight;
        return (
          <group key={r} position={[0, y, 0]}>
            <mesh castShadow receiveShadow position={[0, 0.03, 0]}>
              <boxGeometry args={[width - 0.2, 0.06, depth - 0.08]} />
              <meshStandardMaterial color={BOARD} roughness={0.9} />
            </mesh>
            {books.map((b, i) => (
              <mesh key={i} castShadow position={[b.x, 0.06 + b.h / 2, 0.02]} rotation={[0, 0, b.tilt]}>
                <boxGeometry args={[b.w, b.h, depth - 0.3]} />
                <meshStandardMaterial color={b.color} roughness={0.8} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* category sign */}
      <CanvasLabel
        text={spot.label}
        position={[0, height + 0.42, 0.05]}
        width={1.7}
        height={0.44}
        background={active ? spot.color : "#fbf7ef"}
        color={active ? "#fbf7ef" : "#2b2f36"}
      />
      <mesh position={[0, height + 0.42, 0.02]}>
        <boxGeometry args={[1.76, 0.5, 0.04]} />
        <meshStandardMaterial color={spot.color} roughness={0.8} />
      </mesh>
      {/* active glow on the floor */}
      <mesh ref={glow} position={[0, 0.03, depth / 2 + 0.75]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[0.9, 32]} />
        <meshBasicMaterial color={spot.color} transparent opacity={0} />
      </mesh>
    </group>
  );
}
