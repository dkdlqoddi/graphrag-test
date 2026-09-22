"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Book, createBookAnim, type BookAnim } from "./Book";
import { HOME, pathHome, pathToShelf, SHELF_BY_CATEGORY, type ShelfSpot } from "./layout";
import { useLibraryStore, type LibrarianPhase } from "./store";

const SPEED = 2.7;
const SKIN = "#f1c9a5";
const HAIR = "#4a3226";
const SHIRT = "#fbf7ef";
const APRON = "#d46a4c";
const PANTS = "#2b3a42";

interface Controller {
  x: number;
  z: number;
  yaw: number;
  targetYaw: number;
  path: [number, number][];
  moving: boolean;
  walkT: number;
  phaseStart: number;
  lastPhase: LibrarianPhase;
  spot: ShelfSpot | null;
  pickedBook: boolean;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function Librarian() {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const bookHolder = useRef<THREE.Group>(null);
  const bookAnim = useRef<BookAnim>(createBookAnim());

  const ctrl = useRef<Controller>({
    x: HOME.x,
    z: HOME.z,
    yaw: HOME.yaw,
    targetYaw: HOME.yaw,
    path: [],
    moving: false,
    walkT: 0,
    phaseStart: 0,
    lastPhase: "idle",
    spot: null,
    pickedBook: false,
  });

  useFrame((state, rawDt) => {
    // Clamp so a background tab does not teleport the librarian, but keep slow
    // (low-fps) devices close to real time.
    const dt = Math.min(rawDt, 0.12);
    const t = state.clock.elapsedTime;
    const c = ctrl.current;
    const s = useLibraryStore.getState();
    const b = bookAnim.current;

    /* ---- phase transitions ---- */
    if (s.phase !== c.lastPhase) {
      c.lastPhase = s.phase;
      c.phaseStart = t;
      switch (s.phase) {
        case "idle":
          c.path = [[HOME.x, HOME.z]];
          c.spot = null;
          c.pickedBook = false;
          b.visible = false;
          b.open = 0;
          b.present = 0;
          break;
        case "thinking":
          c.path = [[HOME.x, HOME.z]];
          c.spot = null;
          c.pickedBook = false;
          b.visible = false;
          b.open = 0;
          b.present = 0;
          break;
        case "toShelf":
          c.path = c.spot ? pathToShelf(c.spot) : [[HOME.x, HOME.z]];
          break;
        case "browsing":
          break;
        case "toDesk":
          c.path = pathHome([c.x, c.z], c.spot);
          break;
        case "present":
          break;
      }
    }

    /* ---- phase logic ---- */
    const arrived = c.path.length === 0;
    switch (s.phase) {
      case "idle":
        if (arrived) c.targetYaw = HOME.yaw;
        break;
      case "thinking":
        if (arrived) c.targetYaw = HOME.yaw;
        if (s.category) {
          c.spot = SHELF_BY_CATEGORY[s.category];
          b.color = c.spot.color;
          s.setPhase("toShelf");
        } else if (s.resultsReady && arrived) {
          s.setPhase("present");
        }
        break;
      case "toShelf":
        if (arrived) {
          c.targetYaw = c.spot?.faceYaw ?? c.yaw;
          s.setPhase("browsing");
        } else if (s.skipRequested && s.resultsReady) {
          c.pickedBook = true;
          b.visible = true;
          s.setPhase("toDesk");
        }
        break;
      case "browsing": {
        const elapsed = t - c.phaseStart;
        if (elapsed > 1.4 && !c.pickedBook) {
          c.pickedBook = true;
          b.visible = true;
        }
        if ((s.resultsReady && elapsed > 2.8) || (s.skipRequested && s.resultsReady)) {
          c.pickedBook = true;
          b.visible = true;
          s.setPhase("toDesk");
        }
        break;
      }
      case "toDesk":
        if (arrived) {
          c.targetYaw = Math.PI / 4; // face the camera diagonal
          s.setPhase("present");
        }
        break;
      case "present": {
        const elapsed = t - c.phaseStart;
        c.targetYaw = Math.PI / 4;
        b.visible = true;
        b.open = smooth((elapsed - 0.35) / 0.7);
        b.present = smooth((elapsed - 0.9) / 0.8);
        if (elapsed > 1.5 && s.status === "searching") s.setStatus("presenting");
        break;
      }
    }

    /* ---- movement along the path ---- */
    c.moving = false;
    if (c.path.length) {
      const [tx, tz] = c.path[0];
      const dx = tx - c.x;
      const dz = tz - c.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.03) {
        c.x = tx;
        c.z = tz;
        c.path.shift();
      } else {
        const step = Math.min(dist, SPEED * dt);
        c.x += (dx / dist) * step;
        c.z += (dz / dist) * step;
        c.targetYaw = Math.atan2(dx, dz);
        c.moving = true;
        c.walkT += dt;
      }
    }
    c.yaw = lerpAngle(c.yaw, c.targetYaw, Math.min(1, dt * 9));

    /* ---- pose ---- */
    const g = root.current;
    if (!g) return;
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.yaw;

    const phase = s.phase;
    const swing = Math.sin(c.walkT * 11);
    const bob = c.moving ? Math.abs(Math.sin(c.walkT * 11)) * 0.05 : 0;
    let legAmp = c.moving ? 0.6 : 0;
    let armLx = c.moving ? -swing * 0.55 : 0;
    let armRx = c.moving ? swing * 0.55 : 0;
    let armLz = 0.08;
    let armRz = -0.08;
    let headX = 0;
    let headZ = 0;
    let bodyY = bob;
    let offX = 0;

    if (phase === "idle") {
      headZ = Math.sin(t * 0.8) * 0.04;
      bodyY = Math.sin(t * 2) * 0.01;
      armLx = Math.sin(t * 1.5) * 0.05;
      armRx = -Math.sin(t * 1.5) * 0.05;
    } else if (phase === "thinking" && !c.moving) {
      headZ = 0.14;
      headX = -0.1 + Math.sin(t * 2.2) * 0.05;
      armRx = -2.35;
      armRz = -0.55;
      armLx = 0.1;
    } else if (phase === "browsing") {
      const e = t - c.phaseStart;
      headX = -0.25 + Math.sin(e * 2.4) * 0.28;
      headZ = Math.sin(e * 1.3) * 0.08;
      armRx = -1.9 + Math.sin(e * 3) * 0.25;
      armRz = -0.25;
      armLx = c.pickedBook ? -1.25 : 0.05;
      offX = Math.sin(e * 1.4) * 0.18;
      legAmp = Math.abs(Math.cos(e * 1.4)) * 0.12;
    } else if (phase === "toDesk") {
      armLx = -1.25;
      armRx = -1.25;
      armLz = 0.25;
      armRz = -0.25;
    } else if (phase === "present") {
      const e = t - c.phaseStart;
      const k = smooth(e / 0.8);
      armLx = -1.25 + k * 0.55;
      armRx = -1.25 + k * 0.55;
      armLz = 0.35;
      armRz = -0.35;
      headX = 0.12 * k;
    }

    if (body.current) {
      body.current.position.y = bodyY;
      body.current.position.x = offX;
    }
    if (legL.current) legL.current.rotation.x = swing * legAmp;
    if (legR.current) legR.current.rotation.x = -swing * legAmp;
    if (armL.current) {
      armL.current.rotation.x += (armLx - armL.current.rotation.x) * 0.2;
      armL.current.rotation.z += (armLz - armL.current.rotation.z) * 0.2;
    }
    if (armR.current) {
      armR.current.rotation.x += (armRx - armR.current.rotation.x) * 0.2;
      armR.current.rotation.z += (armRz - armR.current.rotation.z) * 0.2;
    }
    if (head.current) {
      head.current.rotation.x += (headX - head.current.rotation.x) * 0.15;
      head.current.rotation.z += (headZ - head.current.rotation.z) * 0.15;
    }

    /* ---- book placement ---- */
    if (bookHolder.current) {
      const p = b.present;
      // in hands -> on the desk (lying flat) -> lifted and tilted toward the camera, enlarged
      const hx = 0;
      const hy = 0.98 + p * 0.85;
      const hz = 0.45 + p * 0.55;
      const rx = -0.35 + p * (-1.05 + 0.35);
      const sc = 1 + p * 3.2;
      bookHolder.current.position.set(hx, hy, hz);
      bookHolder.current.rotation.set(rx, 0, 0);
      bookHolder.current.scale.setScalar(sc);
    }
  });

  return (
    <group ref={root} position={[HOME.x, 0, HOME.z]}>
      <group ref={body}>
        {/* legs */}
        <group ref={legL} position={[-0.13, 0.55, 0]}>
          <mesh castShadow position={[0, -0.26, 0]}>
            <capsuleGeometry args={[0.1, 0.36, 4, 10]} />
            <meshStandardMaterial color={PANTS} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.5, 0.04]}>
            <boxGeometry args={[0.2, 0.1, 0.3]} />
            <meshStandardMaterial color="#1f262c" roughness={0.9} />
          </mesh>
        </group>
        <group ref={legR} position={[0.13, 0.55, 0]}>
          <mesh castShadow position={[0, -0.26, 0]}>
            <capsuleGeometry args={[0.1, 0.36, 4, 10]} />
            <meshStandardMaterial color={PANTS} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.5, 0.04]}>
            <boxGeometry args={[0.2, 0.1, 0.3]} />
            <meshStandardMaterial color="#1f262c" roughness={0.9} />
          </mesh>
        </group>

        {/* torso */}
        <mesh castShadow position={[0, 0.9, 0]}>
          <capsuleGeometry args={[0.26, 0.42, 6, 14]} />
          <meshStandardMaterial color={SHIRT} roughness={0.9} />
        </mesh>
        {/* apron */}
        <mesh castShadow position={[0, 0.8, 0.13]}>
          <boxGeometry args={[0.4, 0.62, 0.3]} />
          <meshStandardMaterial color={APRON} roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.14, 0.26]}>
          <boxGeometry args={[0.16, 0.16, 0.02]} />
          <meshStandardMaterial color={APRON} roughness={0.9} />
        </mesh>
        {/* name tag */}
        <mesh position={[0.15, 1.05, 0.29]}>
          <boxGeometry args={[0.12, 0.06, 0.01]} />
          <meshStandardMaterial color="#fbf7ef" />
        </mesh>

        {/* arms */}
        <group ref={armL} position={[-0.32, 1.12, 0]}>
          <mesh castShadow position={[0, -0.24, 0]}>
            <capsuleGeometry args={[0.075, 0.34, 4, 10]} />
            <meshStandardMaterial color={SHIRT} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.48, 0]}>
            <sphereGeometry args={[0.085, 12, 12]} />
            <meshStandardMaterial color={SKIN} roughness={0.9} />
          </mesh>
        </group>
        <group ref={armR} position={[0.32, 1.12, 0]}>
          <mesh castShadow position={[0, -0.24, 0]}>
            <capsuleGeometry args={[0.075, 0.34, 4, 10]} />
            <meshStandardMaterial color={SHIRT} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, -0.48, 0]}>
            <sphereGeometry args={[0.085, 12, 12]} />
            <meshStandardMaterial color={SKIN} roughness={0.9} />
          </mesh>
        </group>

        {/* head */}
        <group ref={head} position={[0, 1.34, 0]}>
          <mesh castShadow position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.27, 24, 24]} />
            <meshStandardMaterial color={SKIN} roughness={0.9} />
          </mesh>
          {/* hair cap + bun */}
          <mesh castShadow position={[0, 0.29, -0.04]}>
            <sphereGeometry args={[0.275, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color={HAIR} roughness={0.95} />
          </mesh>
          <mesh castShadow position={[0, 0.5, -0.12]}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial color={HAIR} roughness={0.95} />
          </mesh>
          {/* eyes */}
          <mesh position={[-0.09, 0.2, 0.245]}>
            <sphereGeometry args={[0.03, 10, 10]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          <mesh position={[0.09, 0.2, 0.245]}>
            <sphereGeometry args={[0.03, 10, 10]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          {/* glasses */}
          <mesh position={[-0.09, 0.2, 0.26]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.06, 0.008, 8, 20]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          <mesh position={[0.09, 0.2, 0.26]}>
            <torusGeometry args={[0.06, 0.008, 8, 20]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          <mesh position={[0, 0.2, 0.265]}>
            <boxGeometry args={[0.06, 0.008, 0.008]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          {/* cheeks + mouth */}
          <mesh position={[-0.14, 0.13, 0.22]}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshStandardMaterial color="#f0a48c" />
          </mesh>
          <mesh position={[0.14, 0.13, 0.22]}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshStandardMaterial color="#f0a48c" />
          </mesh>
          <mesh position={[0, 0.1, 0.262]}>
            <boxGeometry args={[0.06, 0.014, 0.01]} />
            <meshStandardMaterial color="#b8553a" />
          </mesh>
        </group>

        {/* the book (hands / desk / presentation) */}
        <group ref={bookHolder} position={[0, 0.98, 0.45]} rotation={[-0.35, 0, 0]}>
          <group position={[-0.17, 0, 0]}>
            <Book anim={bookAnim} />
          </group>
        </group>
      </group>
    </group>
  );
}
