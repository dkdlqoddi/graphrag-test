"use client";

import { CanvasLabel } from "./CanvasLabel";
import { DESK } from "./layout";

export function Desk() {
  const { position, width, depth, height } = DESK;
  return (
    <group position={position}>
      {/* counter top */}
      <mesh castShadow receiveShadow position={[0, height - 0.04, 0]}>
        <boxGeometry args={[width, 0.08, depth]} />
        <meshStandardMaterial color="#e4c39a" roughness={0.7} />
      </mesh>
      {/* front panel (visitor side) */}
      <mesh castShadow receiveShadow position={[0, (height - 0.08) / 2, depth / 2 - 0.08]}>
        <boxGeometry args={[width, height - 0.08, 0.16]} />
        <meshStandardMaterial color="#d46a4c" roughness={0.85} />
      </mesh>
      {/* side panels */}
      <mesh castShadow receiveShadow position={[-width / 2 + 0.08, (height - 0.08) / 2, 0]}>
        <boxGeometry args={[0.16, height - 0.08, depth]} />
        <meshStandardMaterial color="#c85e42" roughness={0.85} />
      </mesh>
      <mesh castShadow receiveShadow position={[width / 2 - 0.08, (height - 0.08) / 2, 0]}>
        <boxGeometry args={[0.16, height - 0.08, depth]} />
        <meshStandardMaterial color="#c85e42" roughness={0.85} />
      </mesh>
      {/* stripe */}
      <mesh position={[0, height * 0.55, depth / 2 + 0.005]}>
        <planeGeometry args={[width - 0.5, 0.08]} />
        <meshStandardMaterial color="#fbf7ef" />
      </mesh>
      {/* desk sign */}
      <CanvasLabel text="FRONT DESK" position={[0, height * 0.32, depth / 2 + 0.01]} width={1.3} height={0.3} fontSize={48} background="#fbf7ef" />

      {/* lamp */}
      <group position={[-width / 2 + 0.45, height, -0.2]}>
        <mesh castShadow position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.14, 0.16, 0.08, 20]} />
          <meshStandardMaterial color="#2b2f36" />
        </mesh>
        <mesh castShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.6, 8]} />
          <meshStandardMaterial color="#2b2f36" />
        </mesh>
        <mesh castShadow position={[0, 0.7, 0]}>
          <coneGeometry args={[0.22, 0.24, 20, 1, true]} />
          <meshStandardMaterial color="#2b2f36" side={2} />
        </mesh>
        <pointLight position={[0, 0.62, 0]} intensity={1.2} distance={3} color="#ffe2b8" />
      </group>

      {/* stack of books */}
      <group position={[width / 2 - 0.55, height, 0.05]}>
        <mesh castShadow position={[0, 0.04, 0]} rotation={[0, 0.2, 0]}>
          <boxGeometry args={[0.5, 0.08, 0.36]} />
          <meshStandardMaterial color="#5c8d89" />
        </mesh>
        <mesh castShadow position={[0.02, 0.12, 0]} rotation={[0, -0.1, 0]}>
          <boxGeometry args={[0.46, 0.08, 0.34]} />
          <meshStandardMaterial color="#f2c14e" />
        </mesh>
        <mesh castShadow position={[-0.02, 0.2, 0.01]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.42, 0.08, 0.32]} />
          <meshStandardMaterial color="#e6553f" />
        </mesh>
      </group>

      {/* small plant on the desk */}
      <group position={[0.1, height, -0.3]}>
        <mesh castShadow position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.09, 0.07, 0.16, 12]} />
          <meshStandardMaterial color="#fbf7ef" />
        </mesh>
        <mesh castShadow position={[0, 0.25, 0]}>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshStandardMaterial color="#81b29a" />
        </mesh>
      </group>
    </group>
  );
}
