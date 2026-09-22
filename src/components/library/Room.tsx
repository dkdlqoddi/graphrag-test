"use client";

import { ROOM } from "./layout";

const FLOOR = "#2f3d46";
const WALL = "#f5ede0";
const TRIM = "#e5d6c1";

export function Room() {
  const { width, depth, height, wallThickness: t } = ROOM;
  return (
    <group>
      {/* floor */}
      <mesh receiveShadow position={[0, -0.1, 0]}>
        <boxGeometry args={[width, 0.2, depth]} />
        <meshStandardMaterial color={FLOOR} roughness={0.9} />
      </mesh>
      {/* floor plank lines */}
      {Array.from({ length: 15 }, (_, i) => (
        <mesh key={i} position={[-width / 2 + (i + 1) * (width / 16), 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.02, depth]} />
          <meshStandardMaterial color="#283640" roughness={1} />
        </mesh>
      ))}
      {/* rug */}
      <mesh receiveShadow position={[0.4, 0.012, 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.6, 3.6]} />
        <meshStandardMaterial color="#d9c3a5" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[0.4, 0.02, 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.9, 2.9]} />
        <meshStandardMaterial color="#c9ad88" roughness={1} />
      </mesh>

      {/* back wall */}
      <mesh receiveShadow position={[0, height / 2, -depth / 2 - t / 2]}>
        <boxGeometry args={[width + t * 2, height, t]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      {/* left wall */}
      <mesh receiveShadow position={[-width / 2 - t / 2, height / 2, 0]}>
        <boxGeometry args={[t, height, depth]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      {/* baseboards */}
      <mesh position={[0, 0.12, -depth / 2 + 0.03]}>
        <boxGeometry args={[width, 0.24, 0.06]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      <mesh position={[-width / 2 + 0.03, 0.12, 0]}>
        <boxGeometry args={[0.06, 0.24, depth]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>

      {/* window on the back wall (right side) */}
      <group position={[5.6, 3.1, -depth / 2 + 0.02]}>
        <mesh>
          <boxGeometry args={[2.6, 1.9, 0.08]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[2.36, 1.66]} />
          <meshStandardMaterial color="#cfe3ee" emissive="#cfe3ee" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[0.06, 1.66, 0.02]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[2.36, 0.06, 0.02]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* poster on the left wall */}
      <group position={[-width / 2 + 0.02, 3.4, 5.2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <planeGeometry args={[1.1, 1.5]} />
          <meshStandardMaterial color="#e6553f" />
        </mesh>
        <mesh position={[0, 0.15, 0.01]}>
          <circleGeometry args={[0.3, 32]} />
          <meshStandardMaterial color="#f2c14e" />
        </mesh>
        <mesh position={[0, -0.45, 0.01]}>
          <planeGeometry args={[0.7, 0.08]} />
          <meshStandardMaterial color="#fbf7ef" />
        </mesh>
      </group>

      {/* plants */}
      <Plant position={[-6.9, 0, 5.3]} />
      <Plant position={[6.9, 0, -5.0]} scale={1.15} />

      {/* reading chair + side table near the front-left */}
      <group position={[-3.6, 0, 4.6]} rotation={[0, 0.5, 0]}>
        <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
          <boxGeometry args={[1.1, 0.5, 1.0]} />
          <meshStandardMaterial color="#5c8d89" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, 0.75, -0.42]}>
          <boxGeometry args={[1.1, 0.7, 0.16]} />
          <meshStandardMaterial color="#5c8d89" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[-0.48, 0.62, 0.05]}>
          <boxGeometry args={[0.14, 0.32, 0.8]} />
          <meshStandardMaterial color="#4f7c78" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0.48, 0.62, 0.05]}>
          <boxGeometry args={[0.14, 0.32, 0.8]} />
          <meshStandardMaterial color="#4f7c78" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.3, 0.24, 0.6, 16]} />
        <meshStandardMaterial color="#d46a4c" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshStandardMaterial color="#6fa06a" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.25, 1.2, 0.1]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#81b29a" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-0.22, 1.25, -0.1]}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color="#5f9364" roughness={0.9} />
      </mesh>
    </group>
  );
}
