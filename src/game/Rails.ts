// src/game/Rails.ts
import * as THREE from 'three';

export type RailLike = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  len: number;
  tangent: THREE.Vector3;
  mesh: THREE.Mesh;
};

/** Compute the best snap target ahead or at current position. Returns null if none. */
export function findBestSnap(
  rails: RailLike[],
  posNow: THREE.Vector3,
  velFlat: THREE.Vector3,
  yaw: number,
  railSnapDist: number,
  boardY: number,
  lookaheadTime: number
): null | {
  rail: RailLike;
  t: number;
  q: THREE.Vector3;
  chosenTan: THREE.Vector3;
  dir: 1 | -1;
} {
  const posSoon = posNow.clone().add(velFlat.clone().multiplyScalar(Math.max(0, lookaheadTime)));

  let best: { rail: RailLike; t: number; q: THREE.Vector3; dist: number } | null = null;
  const consider = [posSoon, posNow];

  for (const rail of rails) {
    for (const p of consider) {
      const ap = p.clone().sub(rail.start);
      const ab = rail.end.clone().sub(rail.start);
      const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
      const q = rail.start.clone().addScaledVector(ab, t);

      // vertical window: allow a bit above/below rail top
      const railTopY = rail.mesh.position.y + 0.03;
      const verticalOff = boardY - railTopY;
      if (verticalOff < -0.6 || verticalOff > 1.0) continue;

      // horizontal closeness
      const horizP = new THREE.Vector3(p.x, railTopY, p.z);
      const target = new THREE.Vector3(q.x, railTopY, q.z);
      const dist = horizP.distanceTo(target);
      if (dist > railSnapDist) continue;

      if (!best || dist < best.dist) best = { rail, t, q, dist };
    }
  }

  if (!best) return null;

  // Choose direction along tangent to align with approach
  const baseTan = best.rail.tangent.clone().normalize();
  const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const approach = velFlat.lengthSq() > 1e-6 ? velFlat.clone().normalize() : facing.clone();
  const chosenTan = baseTan.clone();
  if (chosenTan.dot(approach) < 0) chosenTan.multiplyScalar(-1);

  const dir: 1 | -1 = (chosenTan.dot(baseTan) >= 0) ? 1 : -1;
  return { rail: best.rail, t: best.t, q: best.q, chosenTan, dir };
}

/** Seed an initial rail speed from entry speed (with small boost + floor). */
export function seedRailSpeed(entrySpeed: number, minRail = 4.0, entryBoost = 1.08) {
  return Math.max(minRail, entrySpeed * entryBoost);
}

/** Advance along the rail for one frame and return new kinematics + pose. */
export function stepGrind(
  rail: RailLike,
  railDir: 1 | -1,
  railSpeed: number,
  railFriction: number,
  dt: number,
  railT: number
) {
  const signed = railSpeed * (railDir === 1 ? 1 : -1);
  const ds = signed * dt;

  // friction
  const f = Math.max(0, 1 - (1 - railFriction) * dt);
  const newSpeed = Math.max(0, railSpeed * f);

  const newT = railT + (ds / rail.len);
  const ab = rail.end.clone().sub(rail.start);
  const clampedT = THREE.MathUtils.clamp(newT, 0, 1);
  const posOnRail = rail.start.clone().addScaledVector(ab, clampedT);

  const baseTan = rail.tangent.clone().normalize();
  const newYaw = Math.atan2(baseTan.x, baseTan.z) + (railDir === -1 ? Math.PI : 0);

  const atEnd = (clampedT <= 0 && railDir === -1) || (clampedT >= 1 && railDir === 1);

  return { ds, newSpeed, newT, clampedT, posOnRail, newYaw, atEnd };
}
