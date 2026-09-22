"use client";

import { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { Bookshelf } from "./Bookshelf";
import { Desk } from "./Desk";
import { CAMERA, SHELVES } from "./layout";
import { Librarian } from "./Librarian";
import { Room } from "./Room";
import { useLibraryStore } from "./store";

/** Isometric orthographic camera whose zoom follows the viewport so the room always fits. */
function IsoCamera() {
  const ref = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const cam = ref.current;
    if (!cam) return;
    cam.zoom = Math.max(22, Math.min(size.width / 24, size.height / 14.5));
    cam.updateProjectionMatrix();
  }, [size.width, size.height]);
  return <OrthographicCamera ref={ref} makeDefault position={CAMERA.position} zoom={44} near={0.1} far={120} />;
}

function Shelves() {
  const category = useLibraryStore((s) => s.category);
  const phase = useLibraryStore((s) => s.phase);
  const active = phase === "toShelf" || phase === "browsing" ? category : null;
  return (
    <>
      {SHELVES.map((spot, i) => (
        <Bookshelf key={spot.id} spot={spot} index={i} active={active === spot.id} />
      ))}
    </>
  );
}

export default function LibraryScene() {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.75]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#e9dfd0"]} />
      <IsoCamera />
      <OrbitControls
        target={CAMERA.target}
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.55}
        maxPolarAngle={1.2}
        minAzimuthAngle={0.25}
        maxAzimuthAngle={1.3}
        rotateSpeed={0.5}
      />

      <ambientLight intensity={0.55} color="#fff4e6" />
      <hemisphereLight args={["#f6efe4", "#5c6b75", 0.5]} />
      <directionalLight
        castShadow
        position={[6, 14, 8]}
        intensity={1.7}
        color="#fff1dc"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-8, 6, -4]} intensity={0.35} color="#cfe3ee" />

      <Room />
      <Shelves />
      <Desk />
      <Librarian />
    </Canvas>
  );
}
