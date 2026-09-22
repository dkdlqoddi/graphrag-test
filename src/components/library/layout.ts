import { CATEGORIES, type CategoryId } from "@/lib/categories";

/** World layout of the library. x: right, y: up, z: toward the camera. */
export const ROOM = { width: 16, depth: 12, height: 5.2, wallThickness: 0.25 } as const;

export const SHELF = { width: 2.4, depth: 0.7, height: 3.3, rows: 4 } as const;

export interface ShelfSpot {
  id: CategoryId;
  label: string;
  color: string;
  position: [number, number, number];
  rotationY: number;
  /** Where the librarian stands to browse, and the yaw to face the shelf. */
  front: [number, number];
  faceYaw: number;
  wall: "back" | "left";
}

const backZ = -ROOM.depth / 2 + SHELF.depth / 2 + 0.05;
const leftX = -ROOM.width / 2 + SHELF.depth / 2 + 0.05;
const backXs = [-5.4, -2.7, 0, 2.7];
const leftZs = [-3.2, -0.6, 2.0, 4.6];

export const SHELVES: ShelfSpot[] = CATEGORIES.map((cat, i) => {
  if (i < 4) {
    const x = backXs[i];
    return {
      id: cat.id,
      label: cat.label,
      color: cat.color,
      position: [x, 0, backZ],
      rotationY: 0,
      front: [x, backZ + SHELF.depth / 2 + 0.85],
      faceYaw: Math.PI, // face -z (toward the shelf)
      wall: "back",
    };
  }
  const z = leftZs[i - 4];
  return {
    id: cat.id,
    label: cat.label,
    color: cat.color,
    position: [leftX, 0, z],
    rotationY: Math.PI / 2,
    front: [leftX + SHELF.depth / 2 + 0.85, z],
    faceYaw: -Math.PI / 2, // face -x
    wall: "left",
  };
});

export const SHELF_BY_CATEGORY: Record<CategoryId, ShelfSpot> = Object.fromEntries(
  SHELVES.map((s) => [s.id, s]),
) as Record<CategoryId, ShelfSpot>;

export const DESK = { position: [3.2, 0, 3.4] as [number, number, number], width: 3.2, depth: 1.1, height: 1.0 };

/** Librarian's home spot behind the desk, facing +z. */
export const HOME = { x: 3.2, z: 2.25, yaw: 0 } as const;

/** Waypoints from home to a shelf front (L-shaped, along the aisle at z = HOME.z). */
export function pathToShelf(spot: ShelfSpot): [number, number][] {
  const [fx, fz] = spot.front;
  if (spot.wall === "back") return [[fx, HOME.z], [fx, fz]];
  return [[fx, HOME.z], [fx, fz]];
}

export function pathHome(from: [number, number], spot: ShelfSpot | null): [number, number][] {
  if (!spot) return [[HOME.x, HOME.z]];
  const [fx] = spot.front;
  const points: [number, number][] = [
    [fx, HOME.z],
    [HOME.x, HOME.z],
  ];
  return points.filter(([x, z]) => Math.hypot(x - from[0], z - from[1]) > 0.01);
}

export const CAMERA = { position: [14, 12.5, 14] as [number, number, number], target: [-0.6, 1.6, -0.2] as [number, number, number] };

/** Deterministic PRNG so shelves look the same on every render. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOK_COLORS = ["#f2c14e", "#5c8d89", "#c05746", "#7a9cc6", "#ede3d2", "#3d405b", "#81b29a", "#f4a261", "#e6553f", "#d9c3a5"];
