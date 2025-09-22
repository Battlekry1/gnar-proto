// QP.js
import * as THREE from 'three';

/**
 * QP = Quarter Pipe builder (curve + frames + volume + coping + mesh + gizmos)
 * Usage:
 *   const qp = new QP({ width: 6, height: 3, origin: new THREE.Vector3(0,0,0) });
 *   scene.add(qp.group);
 *   // player helpers:
 *   qp.worldVolume(tmpBox).containsPoint(player.position)
 *   const t = qp.projectToCurve(player.position);
 *   const F = qp.frameAt(t); // { pos, T, B, S } in world-space
 */
export class QP {
  constructor({
    width = 6,                    // across the ramp (left/right)
    height = 3,                   // vertical rise
    radius = 3,                   // visual hint; arc is bezier here
    segs = 64,                    // sampling resolution
    facing = new THREE.Vector3(0, 0, 1), // ramp faces +Z by default
    origin = new THREE.Vector3(0, 0, 0),
    material = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0, roughness: 0.85 }),
    showGizmos = true
  } = {}) {
    this.params = { width, height, radius, segs };
    this.group = new THREE.Group();
    this.group.position.copy(origin);

    // rotate local +Z to desired facing
    const zLocal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(zLocal, facing.clone().normalize());
    this.group.quaternion.copy(q);

    // Build curve (local Z forward, Y up)
    // Choose radius: default to height for a true quarter
    const R = (radius ?? height);

    // Quarter-circle Bezier (local axes: Y up, Z forward)
    // Start P0=(0,0,0) tangent → +Z, end P3=(0,R,R) tangent → +Y
    const k = 0.5522847498307936;
    const P0 = new THREE.Vector3(0, 0, 0);
    const C1 = new THREE.Vector3(0, 0, k * R);        // push along +Z
    const C2 = new THREE.Vector3(0, R - k * R, R);    // pull along +Y
    const P3 = new THREE.Vector3(0, R, R);            // lip at z = R

    this._arc = new THREE.CubicBezierCurve3(P0, C1, C2, P3);

    // Sample frames in LOCAL space
    this._framesLocal = [];
    const segCount = Math.max(8, segs | 0);
    const Bwidth = new THREE.Vector3(1, 0, 0); // lateral axis across ramp (local +X)
    for (let i = 0; i <= segCount; i++) {
      const t = i / segCount;
      const pos = this._arc.getPoint(t);
      const T = this._arc.getTangent(t).normalize();                       // along the curve
      const S = new THREE.Vector3().crossVectors(Bwidth, T).normalize();   // surface normal (out of face)
      const B = new THREE.Vector3().crossVectors(T, S).normalize();        // lateral (left/right)
      this._framesLocal.push({ t, pos, T, S, B });
    }

    // Lip / coping line (local)
    const lipF = this._framesLocal[this._framesLocal.length - 1];
    const w = width;
    this._copingLocalA = lipF.pos.clone().addScaledVector(lipF.B, -w * 0.5);
    this._copingLocalB = lipF.pos.clone().addScaledVector(lipF.B,  w * 0.5);
    this.lipT = 1.0;

    // Trigger volume (local Box3 enclosing the swept arc)
    const min = new THREE.Vector3( Infinity,  Infinity,  Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const f of this._framesLocal) {
      for (const s of [-0.5, 0.5]) {
        const p = f.pos.clone().addScaledVector(f.B, s * width);
        min.min(p); max.max(p);
      }
    }
    // a little thickness cushion
    min.addScalar(-0.2); max.addScalar(0.2);
    this._localVolume = new THREE.Box3(min, max);

    // 5) Visual mesh: build a parametric ribbon (t along arc, w across width)
    const wSegs = 24;                  // width resolution
    const tSegs = Math.max(8, segCount);
    const verts = new Float32Array((tSegs + 1) * (wSegs + 1) * 3);
    const uvs   = new Float32Array((tSegs + 1) * (wSegs + 1) * 2);
    const idx   = new Uint32Array(tSegs * wSegs * 6);

    for (let it = 0; it <= tSegs; it++) {
      const f = this._framesLocal[Math.round((it / tSegs) * (this._framesLocal.length - 1))];
      for (let iw = 0; iw <= wSegs; iw++) {
        const s = (iw / wSegs - 0.5) * width; // -w/2..+w/2
        const p = f.pos.clone().addScaledVector(f.B, s);
        const i = (it * (wSegs + 1) + iw);
        verts[i*3+0] = p.x;
        verts[i*3+1] = p.y;
        verts[i*3+2] = p.z;
        uvs[i*2+0] = iw / wSegs;
        uvs[i*2+1] = it / tSegs;
      }
    }

    let index = 0; // Renamed from 'k' to 'index' to avoid conflict
    for (let it = 0; it < tSegs; it++) {
      for (let iw = 0; iw < wSegs; iw++) {
        const a = it * (wSegs + 1) + iw;
        const b = a + 1;
        const c = a + (wSegs + 1);
        const d = c + 1;
        idx[index++] = a; idx[index++] = c; idx[index++] = b;
        idx[index++] = b; idx[index++] = c; idx[index++] = d;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.setAttribute('uv',       new THREE.BufferAttribute(uvs,   2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();

    this.mesh = new THREE.Mesh(
      geom,
      // DoubleSide so you can look “inside” the quarter while testing
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0, roughness: 0.85, side: THREE.DoubleSide })
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // Gizmos
    this._gizmos = new THREE.Group();
    if (showGizmos) this.enableGizmos(true);
  }

  // --- Public helpers ---

  /**
   * Returns a world-space Box3 of the trigger volume (optionally reusing 'out').
   */
  worldVolume(out = new THREE.Box3()) {
    const mat = this.group.matrixWorld;
    const lv = this._localVolume;
    const corners = [
      new THREE.Vector3(lv.min.x, lv.min.y, lv.min.z),
      new THREE.Vector3(lv.min.x, lv.min.y, lv.max.z),
      new THREE.Vector3(lv.min.x, lv.max.y, lv.min.z),
      new THREE.Vector3(lv.min.x, lv.max.y, lv.max.z),
      new THREE.Vector3(lv.max.x, lv.min.y, lv.min.z),
      new THREE.Vector3(lv.max.x, lv.min.y, lv.max.z),
      new THREE.Vector3(lv.max.x, lv.max.y, lv.min.z),
      new THREE.Vector3(lv.max.x, lv.max.y, lv.max.z),
    ];
    out.makeEmpty();
    for (const p of corners) out.expandByPoint(p.applyMatrix4(mat));
    return out;
  }

  /**
   * Project a world position to nearest param t on the centerline (0..1).
   * Coarse via samples; good enough for entry & reattachment.
   */
  projectToCurve(worldPos) {
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const lp = worldPos.clone().applyMatrix4(inv);
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < this._framesLocal.length; i++) {
      const d = lp.distanceToSquared(this._framesLocal[i].pos);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return this._framesLocal[bestI].t;
  }

  /**
   * Get frame (pos, T, B, S) at param t in WORLD space.
   */
  frameAt(t: number) {
    const i = Math.min(Math.round(t * (this._framesLocal.length - 1)), this._framesLocal.length - 1);
    const fL = this._framesLocal[i];

    const mat = this.group.matrixWorld;
    const nmat = new THREE.Matrix3().getNormalMatrix(mat);

    const posW = fL.pos.clone().applyMatrix4(mat);
    let TW = fL.T.clone().applyMatrix3(nmat).normalize();
    let BW = fL.B.clone().applyMatrix3(nmat).normalize();
    let SW = fL.S.clone().applyMatrix3(nmat).normalize();

    // 👇 ensure S points outward/up-ish (not into ground)
    const worldUp = new THREE.Vector3(0, 1, 0);
    if (SW.dot(worldUp) < 0) {
      SW.multiplyScalar(-1);           // flip S
      // rebuild B so the frame stays right-handed
      BW = new THREE.Vector3().crossVectors(TW, SW).normalize();
    } else {
      // ensure perfect orthonormal basis either way
      BW = new THREE.Vector3().crossVectors(TW, SW).normalize();
    }
    // final orthonormal TW from S×B to keep axes crisp
    TW = new THREE.Vector3().crossVectors(BW, SW).normalize();

    return { t: fL.t, pos: posW, T: TW, B: BW, S: SW };
  }

  /**
   * World-space coping line endpoints.
   */
  copingWorld() {
    const a = this._copingLocalA.clone().applyMatrix4(this.group.matrixWorld);
    const b = this._copingLocalB.clone().applyMatrix4(this.group.matrixWorld);
    return { a, b };
  }

  /**
   * Toggle/show gizmos (centerline, coping, a few T/S arrows).
   */
  enableGizmos(on = true) {
    // clear previous
    this._gizmos.clear();
    if (!on) {
      if (this._gizmos.parent) this._gizmos.parent.remove(this._gizmos);
      return;
    }

    // centerline
    const lineGeom = new THREE.BufferGeometry().setFromPoints(this._framesLocal.map(f => f.pos.clone()));
    const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x00c3ff }));
    this._gizmos.add(line);

    // coping
    const copGeom = new THREE.BufferGeometry().setFromPoints([this._copingLocalA, this._copingLocalB]);
    const copLine = new THREE.Line(copGeom, new THREE.LineBasicMaterial({ color: 0xffcc00 }));
    this._gizmos.add(copLine);

    // T/S arrows
    const step = Math.max(1, Math.floor(this._framesLocal.length / 8));
    for (let i = 0; i < this._framesLocal.length; i += step) {
      const f = this._framesLocal[i];
      const base = f.pos.clone();
      const arrT = new THREE.ArrowHelper(f.T.clone(), base, 0.6, 0x66ff66);
    const arrS = new THREE.ArrowHelper(f.S.clone(), base, 0.6, 0xff6666);
    this._gizmos.add(arrT, arrS);
  }

  if (!this._gizmos.parent) this.group.add(this._gizmos);
}
}
