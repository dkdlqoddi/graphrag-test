"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Mutable animation targets written by the Librarian every frame. */
export interface BookAnim {
  visible: boolean;
  /** 0 = closed, 1 = fully open */
  open: number;
  /** 0 = in hands, 1 = presented large toward the camera */
  present: number;
  color: string;
}

export function createBookAnim(): BookAnim {
  return { visible: false, open: 0, present: 0, color: "#5c8d89" };
}

const W = 0.34; // cover width
const H = 0.46; // cover height (along z when lying flat)
const T = 0.06; // page block thickness

interface Props {
  anim: RefObject<BookAnim>;
}

/**
 * A small book that lives in the librarian's hands. Local frame: lying flat,
 * spine along z at x = 0, front cover on +y, opening toward -x.
 */
export function Book({ anim }: Props) {
  const group = useRef<THREE.Group>(null);
  const cover = useRef<THREE.Group>(null);
  const coverMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5c8d89", roughness: 0.7 }), []);
  const pageMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fbf7ef", roughness: 1 }), []);

  useFrame(() => {
    const a = anim.current;
    if (!group.current || !cover.current || !a) return;
    group.current.visible = a.visible;
    if (!a.visible) return;
    cover.current.rotation.z = a.open * Math.PI * 0.98;
    coverMat.color.set(a.color);
  });

  return (
    <group ref={group} visible={false}>
      {/* back cover + pages (static) */}
      <mesh castShadow position={[W / 2, 0.01, 0]} material={coverMat}>
        <boxGeometry args={[W, 0.02, H]} />
      </mesh>
      <mesh castShadow position={[W / 2 - 0.01, 0.02 + T / 2, 0]} material={pageMat}>
        <boxGeometry args={[W - 0.03, T, H - 0.03]} />
      </mesh>
      {/* left page (revealed when opened) */}
      <mesh position={[-W / 2 + 0.01, 0.005, 0]} material={pageMat}>
        <boxGeometry args={[W - 0.03, 0.01, H - 0.03]} />
      </mesh>
      {/* text lines on the left page */}
      {[0.14, 0.06, -0.02, -0.1].map((z, i) => (
        <mesh key={i} position={[-W / 2 + 0.01, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W - 0.12, 0.018]} />
          <meshStandardMaterial color="#c9b9a2" />
        </mesh>
      ))}
      {/* spine */}
      <mesh castShadow position={[0, 0.02 + T / 2, 0]} material={coverMat}>
        <boxGeometry args={[0.03, T + 0.04, H]} />
      </mesh>
      {/* front cover, hinged at the spine */}
      <group ref={cover} position={[0, 0.02 + T + 0.005, 0]}>
        <mesh castShadow position={[W / 2, 0, 0]} material={coverMat}>
          <boxGeometry args={[W, 0.02, H]} />
        </mesh>
        <mesh position={[W / 2, 0.012, 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W * 0.6, 0.05]} />
          <meshStandardMaterial color="#fbf7ef" />
        </mesh>
        <mesh position={[W / 2, 0.012, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W * 0.4, 0.03]} />
          <meshStandardMaterial color="#fbf7ef" />
        </mesh>
        {/* inside of the cover (visible when open) */}
        <mesh position={[W / 2, -0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W - 0.02, H - 0.02]} />
          <meshStandardMaterial color="#f4ecdf" />
        </mesh>
      </group>
    </group>
  );
}
