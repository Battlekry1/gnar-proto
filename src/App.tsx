import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TrickQueue } from './game/TrickQueue';
import { TrickFeed } from './game/TrickFeed';
import { findBestSnap, seedRailSpeed, stepGrind } from './game/Rails';



let currentRail: Rail | null = null;


// GNAR prototype — stable build with press-to-grind (O), raised rails, kickflip/shove-it queue, labels, star, wedge
export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

       // --- rail / carry speed controls ---
    const railSpeedRef = React.useRef(0);   // scalar m/s while grinding
    const carrySpeedRef = React.useRef(0);  // scalar m/s carried into the air on grind exit
    const airCarryTimer = React.useRef(0);  // seconds to lock horizontal speed during airborne carry


  // ===== Build tag =====
  const BUILD_TAG = "stable-rails-split-v1 (09-17-2025 b29)";

  // TEMP: disable all point math / numeric HUD while rebuilding PointsV2
  // Flip to false only after PointsV2 is implemented
  const POINTS_DISABLED = true; // TODO[PointsV2]

  // ===== Tunables (with sliders) =====
  const [coastSpeed, setCoastSpeed] = useState(9.6);
  const [chargeSpeed, setChargeSpeed] = useState(15.8);
  const [turnRateIdle, setTurnRateIdle] = useState(2.9);
  const [turnRateCoast, setTurnRateCoast] = useState(1.7);
  const [turnRateCharge, setTurnRateCharge] = useState(1.2);
  const momentumHold = React.useRef(0); // seconds
  const [tileRepeat, setTileRepeat] = useState(100);
  const [spinRate, setSpinRate] = useState(6.0);   // rad/s for flatspin (A/D)
  const [flipSpeed, setFlipSpeed] = useState(16);     // was lower; default now 16
  const [shuvSpeed, setShuvSpeed] = useState(12.6);   // default 12.6
  const [rollToleranceDeg, setRollToleranceDeg] = useState(20);

  // Rails tuning
  const [railSnapDist, setRailSnapDist] = useState(1.5);  // meters; default 1.50
  const [railSnapAngleDeg, setRailSnapAngleDeg] = useState(170); // or 170 for almost any angle
  const [railFriction, setRailFriction] = useState(0.85);
  const [railMagnetTime, setRailMagnetTime] = useState(0.56); // seconds; default 0.56
  const [railCoyoteTime, setRailCoyoteTime] = useState(0.50); // seconds; default 0.50
  const [railCoyoteMs, setRailCoyoteMs] = useState(220);      // ms “coyote time” for snap forgiveness

  // >>> Grind boost (THUG feel)
  const [grindBoost, setGrindBoost] = useState(1.375);   // ~37.5% faster than charge
  const [minGrindSpeed, setMinGrindSpeed] = useState(5); // m/s floor so slow entries still move

  // UI-facing counters / flags
  const [starsCollected, setStarsCollected] = useState(0);
  const starsCountRef = useRef(0);
  const totalScoreRef = useRef(0);

  // --- Slider tabs ---
const [activeTab, setActiveTab] = useState<"Movement"|"Turning"|"Air"|"Board"|"Rails"|"World">("Movement");
const [panelVisible, setPanelVisible] = useState(true);

// --- Rails extras (new) ---
const [entryBoost, setEntryBoost] = useState(0.6);         // extra m/s added on snap
const [magnetTime, setMagnetTime] = useState(0.12);        // seconds to fully center on rail
const [coyoteMs, setCoyoteMs] = useState(140);             // ms allowed after leaving ground to still snap

  // --- End rails extras ---

  const queue = React.useRef(new TrickQueue()).current;
const feed  = React.useRef(new TrickFeed()).current;

  
  const [lastTrick, setLastTrick] = useState("");
  const [lastTrickPts, setLastTrickPts] = useState(0);
  const [trickTimer, setTrickTimer] = useState(0);
    // Live trick string while in-air or grinding
  const [comboPieces, setComboPieces] = React.useState<string[]>([]);

  // Keep placeholder numeric state so renders never crash (noops while POINTS_DISABLED)
  const [grindLivePts, setGrindLivePts] = React.useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [airPoints, setAirPoints] = useState(0);
  const [isAir, setIsAir] = useState(false);
  const [bailTimer, setBailTimer] = useState(0);
  const [isGrinding, setIsGrinding] = useState(false);
  const grindLiveRef = useRef(0);

    // Live subtotal across the whole combo (air + grind + anything in between)
  const comboLiveRef = React.useRef(0);

    // Baseline captured at the start of the current segment (air or grind)
const comboAnchorRef = React.useRef(0);


  const [comboLive, setComboLive] = React.useState(0);

  // live, in-flight trick list for Legacy HUD
const comboPiecesRef = React.useRef<string[]>([]);
const [comboTick, setComboTick] = React.useState(0); // bump to force re-render when list changes


  useEffect(() => { totalScoreRef.current = totalScore; }, [totalScore]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ---------- Helpers ----------
    function makeCheckerTexture(size = 512, squares = 8) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      const a = '#1a2030', b = '#0f1422';
      const step = size / squares;
      for (let y = 0; y < squares; y++) {
        for (let x = 0; x < squares; x++) {
          ctx.fillStyle = ((x + y) % 2 === 0) ? a : b;
          ctx.fillRect(x * step, y * step, step, step);
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestMipMapNearestFilter;
      tex.anisotropy = 8;
      return tex;
    }

    function makeStarMesh(size = 0.7, depth = 0.15, color = 0xfff07a) {
      const spikes = 5;
      const outerR = size;
      const innerR = size * 0.45;
      const shape = new THREE.Shape();
      for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0) ? outerR : innerR;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2; // top spike up
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      const extrude = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 2,
        curveSegments: 32,
      });
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: 0xffeb8a,
        emissiveIntensity: 0.4,
        metalness: 0.1,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(extrude, mat);
      mesh.castShadow = true;
      return mesh;
    }

    class Sparkle {
      points: THREE.Points;
      material: THREE.PointsMaterial;
      velocities: Float32Array;
      life = 0.8;
      scene: THREE.Scene;
      constructor(scene: THREE.Scene, origin: THREE.Vector3) {
        const count = 40;
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i*3+0] = origin.x;
          positions[i*3+1] = origin.y + 0.5;
          positions[i*3+2] = origin.z;
          const theta = Math.random() * Math.PI * 2;
          const y = Math.random() * 0.8 + 0.2;
          const r = Math.random() * 1.2;
          velocities[i*3+0] = Math.cos(theta) * r;
          velocities[i*3+1] = y * 2.0;
          velocities[i*3+2] = Math.sin(theta) * r;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.velocities = velocities;
        this.material = new THREE.PointsMaterial({ size: 0.08, transparent: true, opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff3a5 });
        this.points = new THREE.Points(geom, this.material);
        scene.add(this.points);
        this.scene = scene;
      }
      update(dt: number) {
        this.life -= dt;
        const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < this.velocities.length/3; i++) {
          const vx = this.velocities[i*3+0];
          let vy = this.velocities[i*3+1];
          const vz = this.velocities[i*3+2];
          vy -= 9.8 * dt;
          this.velocities[i*3+1] = vy;
          pos.array[i*3+0] += vx * dt;
          pos.array[i*3+1] += vy * dt;
          pos.array[i*3+2] += vz * dt;
        }
        pos.needsUpdate = true;
        this.material.opacity = Math.max(0, this.life / 0.8);
        if (this.life <= 0) {
          this.scene.remove(this.points);
          this.points.geometry.dispose();
          this.material.dispose();
          return false;
        }
        return true;
      }
    }

    class ScorePopup {
      sprite: THREE.Sprite;
      life = 1.0;
      scene: THREE.Scene;
      constructor(scene: THREE.Scene, pos: THREE.Vector3, text = "+100") {
        const canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 96;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.font = "bold 42px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, canvas.width/2, 60);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        this.sprite = new THREE.Sprite(mat);
        this.sprite.position.copy(pos.clone().add(new THREE.Vector3(0,1.2,0)));
        this.sprite.scale.set(3,1.2,1);
        scene.add(this.sprite);
        this.scene = scene;
      }
      update(dt: number) {
        this.life -= dt;
        this.sprite.position.y += dt * 1.0;
        (this.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, this.life);
        if (this.life <= 0) {
          this.scene.remove(this.sprite);
          (this.sprite.material as THREE.SpriteMaterial).map?.dispose();
          (this.sprite.material as THREE.SpriteMaterial).dispose();
          return false;
        }
        return true;
      }
    }

    // ---------- Three setup ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    const width  = mount.clientWidth  || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c10);
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);

    const camSmoothPos = new THREE.Vector3();

    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-8, 12, 6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const checker = makeCheckerTexture(512, 8);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ map: checker, color: 0xb7bdc8, roughness: 0.95, metalness: 0.0 })
    );
    (plane.material as THREE.MeshStandardMaterial).map!.repeat.set(tileRepeat, tileRepeat);
    (plane.material as THREE.MeshStandardMaterial).map!.needsUpdate = true;
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

    // ---------- Kicker ramp (simple wedge) ----------
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(4, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.9 })
    );
    ramp.position.set(5, 0.75, -6);
    ramp.rotation.x = -Math.atan(1.5/6);
    scene.add(ramp);
    (ramp.geometry as THREE.BoxGeometry).computeBoundingBox();

    // ---------- Board (physics owner) ----------
    const boardRoot = new THREE.Group();
    scene.add(boardRoot);

    const boardVisual = new THREE.Group();
    boardRoot.add(boardVisual);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.06, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    boardVisual.add(deck);
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.01, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    grip.position.y = 0.035;
    boardVisual.add(grip);

    // Rider
    const riderGroup = new THREE.Group();
    const capMat = new THREE.MeshStandardMaterial({ color: 0xff914d, roughness: 0.6 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 8, 16), capMat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 16), new THREE.MeshStandardMaterial({ color: 0xffff55 }));
    nose.position.set(0, 0.15, 0.55); nose.rotation.x = Math.PI;
    riderGroup.add(capsule); riderGroup.add(nose);
    riderGroup.position.y = 1.0;
    boardRoot.add(riderGroup);

    // Blob shadow
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.01; scene.add(blob);

    // ---------- Collectible star ----------
    const star = makeStarMesh();
    scene.add(star);
    const STAR_HOVER_BASE_Y = 1.4;
    star.position.set(3, STAR_HOVER_BASE_Y, -4);
    let starAlive = true;

    function respawnStar() {
      const R = 20; const x = (Math.random()*2 - 1) * R; const z = (Math.random()*2 - 1) * R;
      star.position.set(x, STAR_HOVER_BASE_Y, z);
      star.visible = true; starAlive = true;
    }

    const sparkles: Sparkle[] = [];
    const popups: ScorePopup[] = [];

    // ---------- Rails ----------
    class Rail {
      start: THREE.Vector3; end: THREE.Vector3; len: number; tangent: THREE.Vector3; mesh: THREE.Mesh; legs: THREE.Mesh[] = [];
      constructor(a: THREE.Vector3, b: THREE.Vector3, scene: THREE.Scene) {
        this.start = a.clone(); this.end = b.clone();
        this.tangent = b.clone().sub(a).normalize();
        this.len = a.distanceTo(b);
        const geom = new THREE.BoxGeometry(0.06, 0.06, this.len);
        const mat = new THREE.MeshStandardMaterial({ color: 0xd0d6e2, roughness: 0.4, metalness: 0.2 });
        this.mesh = new THREE.Mesh(geom, mat);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        this.mesh.position.copy(mid);
        const quat = new THREE.Quaternion();
        const zAxis = new THREE.Vector3(0,0,1);
        quat.setFromUnitVectors(zAxis, this.tangent);
        this.mesh.setRotationFromQuaternion(quat);
        const railHeight = 0.6; // raised so you need to ollie
        this.mesh.position.y = railHeight;
        scene.add(this.mesh);
        // legs at endpoints
        const legGeom = new THREE.BoxGeometry(0.08, railHeight, 0.08);
        const legMat = new THREE.MeshStandardMaterial({ color: 0xbfc6d4, roughness: 0.6 });
        const leg1 = new THREE.Mesh(legGeom, legMat);
        const leg2 = new THREE.Mesh(legGeom, legMat);
        leg1.position.set(a.x, railHeight/2, a.z);
        leg2.position.set(b.x, railHeight/2, b.z);
        scene.add(leg1); scene.add(leg2);
        this.legs.push(leg1, leg2);
      }
      closest(p: THREE.Vector3) {
        const ap = p.clone().sub(this.start);
        const ab = this.end.clone().sub(this.start);
        const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
        const q = this.start.clone().addScaledVector(ab, t);
        return { q, t };
      }
    }

    const rails: Rail[] = [];
    rails.push(new Rail(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(-4, 0, 6), scene));
    rails.push(new Rail(new THREE.Vector3(8, 0, 2), new THREE.Vector3(2, 0, 10), scene));

    // ---------- Movement state ----------
    type MoveState = "idle" | "coasting" | "charging" | "stopping" | "airborne" | "grind" | "bail";
    const state = { current: "idle" as MoveState };

    let yaw = 0;                  // board heading (ground-only control)
    const v = new THREE.Vector3();// horizontal velocity (board)
    let y = 0.03; let yVel = 0.0; // board height & vertical vel
    let started = false; let wasSpace = false; // true only on the frame Space goes down

    // Flatspin (A/D) and trick visuals
    let spinAngle = 0;            // yaw flatspin
    let airSpinAbs = 0;           // for live points
    let boardRollZ = 0;           // kickflip barrel roll (around board length)
    let boardSpinY = 0;           // shove-it spin (adds to board yaw visual only)
    let spinLockTimer = 0;        // brief lock after trick enqueue

    // Trick queue
    const trickQueue: { type: 'flip' | 'shuv'; remaining: number; dir: 1 | -1 }[] = [];
    const completedTricks: { name: string; points: number }[] = [];

const pushPiece = (name: string) => {
  comboPiecesRef.current.push(name);
  setComboTick(t => t + 1);
};

    // Grind state
    let railT = 0;            // 0..1 along rail
    let railDir: 1 | -1 = 1;  // travel direction along t
    let grindDist = 0;        // meters traveled on rail (for scoring)
    let grindMagnetTimer = 0;   // counts up to magnetTime
    let coyoteTimer = 0;        // seconds: counts down from coyoteMs/1000 after takeoff
    let grindType: "5050" | "boardslide" = "5050";

    const params = {
      accel: 10.0,
      brake: 14.0,
      g: 18.0,
      ollieVel: 6.0,
      bailAngle: THREE.MathUtils.degToRad(60),
      rampKickScale: 0.18,
    } as const;

    function forwardFromYaw(a: number) { return new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); }
    const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const nearlyMultiple = (angle: number, period: number, eps: number) => {
      const m = ((angle % period) + period) % period;
      return Math.min(m, period - m) <= eps;
    };

        function normAngle(a: number) { return Math.atan2(Math.sin(a), Math.cos(a)); }
    function headingToCompass(angle: number) {
      // Define world +Z as North (0°), +X as East (90°)
      const deg = ((Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI) + 360) % 360;
      const labels = ['N','NE','E','SE','S','SW','W','NW'];
      const idx = Math.round(deg / 45) % 8;
      return { label: labels[idx], deg: Math.round(deg) };
    }

    // ---------- Input ----------
    const keys = new Set<string>();
    let kDownLatch = false;
    let spacePressed = false; // <-- Only declare once, here!

    const onKeyDown = (e: KeyboardEvent) => {
      // NEW: capture Space transitions (just-pressed)
      if (e.code === 'Space' && !keys.has('Space')) {
        spacePressed = true;
      }
      keys.add(e.code);

      // UI: tabs & panel
      if (e.code === "BracketLeft") {
        const order = ["Movement","Turning","Air","Board","Rails","World"] as const;
        setActiveTab(prev => order[(order.indexOf(prev as any)+order.length-1)%order.length]);
      }
      if (e.code === "BracketRight") {
        const order = ["Movement","Turning","Air","Board","Rails","World"] as const;
        setActiveTab(prev => order[(order.indexOf(prev as any)+1)%order.length]);
      }
      if (e.code === "KeyH") setPanelVisible(v => !v);

      // Queue tricks only when airborne and on initial K down
      if (e.code === 'KeyK' && !kDownLatch && state.current === 'airborne') {
  kDownLatch = true;
  const aHeld = keys.has('KeyA');  // spin key you often hold
  const sHeld = keys.has('KeyS');  // shuv selector

   if (sHeld && !aHeld) queue.enqueueShuv(1);
  else if (aHeld && !sHeld) queue.enqueueFlip(1);

  if (sHeld && !aHeld) {
    // Shove-it 180
    trickQueue.push({ type: 'shuv', remaining: Math.PI, dir: 1 });
    spinLockTimer = 0.15;
  } else if (aHeld && !sHeld) {
    // Kickflip
    trickQueue.push({ type: 'flip', remaining: Math.PI * 2, dir: 1 });
    spinLockTimer = 0.15;
  } else {
    // both or neither held -> ignore to prevent accidental tricks
    // (Optional) console.log('[TRICK] ignored: ambiguous or none');
  }
}

      // Press-to-grind on O (airborne only; ascending or descending allowed)
      if (e.code === 'KeyO') {
        if (state.current === 'airborne' || coyoteTimer > 0) {
          if (trySnapToRail()) coyoteTimer = 0;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === 'KeyK') kDownLatch = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function updateState(dt: number) {
      const pushing = keys.has('Space');
      const W = keys.has('KeyW');
      const S = keys.has('KeyS');
      const A = keys.has('KeyA');
      const D = keys.has('KeyD');

      // Ground turning only (no steering in air or grind)
      if (state.current !== 'airborne' && state.current !== 'bail' && state.current !== 'grind') {
        const turnInput = (A ? 1 : 0) - (D ? 1 : 0);
        let turnRate = turnRateIdle; if (state.current === 'coasting') turnRate = turnRateCoast; if (state.current === 'charging') turnRate = turnRateCharge;
        yaw += turnInput * turnRate * dt;
      }

      // Takeoff → enter airborne and reset spin accumulators & queue
      if (!pushing && wasSpace && state.current !== 'airborne' && state.current !== 'bail' && state.current !== 'grind') {
        yVel = params.ollieVel; state.current = 'airborne';
        (window as any).lastAirborneAt = performance.now() * 0.001;
        coyoteTimer = coyoteMs / 1000; // <-- Add this line
        spinAngle = 0; airSpinAbs = 0; boardRollZ = 0; boardSpinY = 0; spinLockTimer = 0;
        trickQueue.length = 0;
        completedTricks.length = 0;
        setIsAir(true);
        // ==== Trick system reset for a fresh air segment (Phase 1 split) ====
        queue.clear();                  // no leftover queued tricks
        completedTricks.length = 0;     // clear any completed names from last run
        feed.resetWithOllie();          // start HUD with "Ollie"
        setComboPieces([...feed.list]);      // update the names on screen

        if (!POINTS_DISABLED) {
          setAirPoints(100);
          comboAnchorRef.current = comboLiveRef.current;
          setComboLive(comboAnchorRef.current + 100); // start at +100 like before
        } else {
          // names-only flow
          comboAnchorRef.current = 0;
          setComboLive(0);
        }
        setIsGrinding(false);
        comboLiveRef.current = 0;
        setComboLive(0);
        setComboPieces(["Ollie"]);
        setTrickTimer(0); setBailTimer(0);
        comboPiecesRef.current = ['Ollie'];
        setComboTick(t => t + 1);
      }
      wasSpace = pushing;

      if (state.current === 'airborne' || state.current === 'grind') return;

      if (state.current === 'bail') {
        if (v.length() <= 0.01 && Math.abs(y - 0.03) < 1e-3) state.current = 'idle';
        return;
      }

      if (S) state.current = 'stopping';
      else if (pushing && started) state.current = 'charging';
      else if (W) { started = true; state.current = 'coasting'; }
      else if (started) state.current = 'coasting';
      else state.current = 'idle';
    }

    function approach(cur: number, tgt: number, rate: number, dt: number) {
      if (cur < tgt) return Math.min(tgt, cur + rate * dt);
      if (cur > tgt) return Math.max(tgt, cur - rate * dt);
      return tgt;
    }

    // Utility plane helpers
    function planeFromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
      const n = new THREE.Vector3();
      n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const constant = -a.dot(n);
      return { normal: n, constant };
    }
    function rampHeightAt(x: number, z: number): number | null {
      const bb = (ramp.geometry as THREE.BoxGeometry).boundingBox!;
      const pts = [
        new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
      ].map(p => p.clone().applyMatrix4(ramp.matrixWorld));
      const { normal, constant } = planeFromPoints(pts[0], pts[1], pts[2]);
      if (Math.abs(normal.y) < 1e-3) return null;
      const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
      const yVal = -(normal.x * x + normal.z * z + constant) / normal.y;
      return yVal;
    }

    let onRampPrev = false;

// ---- Press-to-grind snap (robust, no new state required) ----
function trySnapToRail(): boolean {
  if (state.current !== 'airborne') return false;

  // lookahead time: use your existing railMagnetTime (fallback to 0.12s)
  const lookahead = typeof railMagnetTime === 'number' ? railMagnetTime : 0.12;

  const posNow = boardRoot.position.clone();
  const velFlat = v.clone(); velFlat.y = 0;

  const snap = findBestSnap(
    rails, posNow, velFlat, yaw,
    railSnapDist, y, lookahead
  );
  if (!snap) return false;

  // Apply snap
  currentRail = snap.rail;
  railT = snap.t;
  railDir = snap.dir;
  grindDist = 0;

  const yRail = currentRail.mesh.position.y + 0.03;
  boardRoot.position.set(snap.q.x, yRail, snap.q.z);

  // Heading and speed
  yaw = Math.atan2(snap.chosenTan.x, snap.chosenTan.z);
  const entrySpeed = Math.max(v.length(), coastSpeed * 0.7);
  v.copy(snap.chosenTan).setLength(entrySpeed);
  railSpeedRef.current = seedRailSpeed(entrySpeed, 4.0, 1.08);

  // reset trick visuals for grind phase
  yVel = 0;
  spinAngle = 0; airSpinAbs = 0; boardRollZ = 0; boardSpinY = 0; spinLockTimer = 0;
  trickQueue.length = 0;

  setIsAir(false);
  setIsGrinding(true);
  state.current = 'grind';

  // Show the name once
  feed.addUnique('50-50');
  setComboPieces([...feed.list]);

  // zero live grind readout
  setGrindLivePts(0);
  grindLiveRef.current = 0;

  return true;
}

    function updateMovement(dt: number) {
      const forward = forwardFromYaw(yaw);

      if (state.current !== 'airborne' && state.current !== 'grind') {
        const speed = v.length();
        const target =
          state.current === 'charging' ? chargeSpeed :
          state.current === 'coasting'  ? coastSpeed  :
          state.current === 'stopping' || state.current === 'bail' ? 0 : 0;

        let ns: number;

        if (state.current === 'stopping' || state.current === 'bail') {
          // always allow braking
          ns = approach(speed, target, params.accel, dt);
        } else if (momentumHold.current > 0 && speed > target) {
          // during momentum hold, do NOT pull speed down toward target
          ns = speed;
        } else {
          // normal approach behavior (accelerate or gently decelerate if above target after hold)
          ns = approach(speed, target, params.accel, dt);
        }

        if (ns === 0) {
          v.set(0, 0, 0);
          if ((state.current === 'stopping' || state.current === 'bail') && speed <= 0.05) started = false;
        } else {
          v.copy(forward).multiplyScalar(ns);
        }
      }

      if (state.current !== 'grind') {
        boardRoot.position.x += v.x * dt;
        boardRoot.position.z += v.z * dt;
        boardRoot.rotation.y = yaw;
      }

      let groundY = 0;
      const rh = rampHeightAt(boardRoot.position.x, boardRoot.position.z);
      const onRamp = rh !== null && rh >= 0 && rh <= 5;
      if (onRamp && rh !== null) groundY = Math.max(groundY, rh);

      if (state.current !== 'airborne' && state.current !== 'grind') {
        y = groundY + 0.03;
      }

      // lip kick
      if (!onRamp && onRampPrev && state.current !== 'airborne' && state.current !== 'grind') {
        const speed = v.length();
        yVel = Math.max(yVel, params.rampKickScale * speed);
        state.current = 'airborne';
        (window as any).lastAirborneAt = performance.now() * 0.001;
        spinAngle = 0; airSpinAbs = 0; boardRollZ = 0; boardSpinY = 0; spinLockTimer = 0;
        setIsAir(true);
        if (!POINTS_DISABLED) setAirPoints(100);
      }
      onRampPrev = onRamp;

      // ===== GRIND =====
      if (state.current === 'grind' && currentRail) {
  const { ds, newSpeed, newT, clampedT, posOnRail, newYaw, atEnd } =
    stepGrind(currentRail, railDir, railSpeedRef.current, railFriction, dt, railT);

  // Accumulate distance
  grindDist += Math.abs(ds);

  // Update state from step
  railSpeedRef.current = newSpeed;
  railT = newT;

  // Apply pose
  boardRoot.position.set(posOnRail.x, currentRail.mesh.position.y + 0.03, posOnRail.z);
  yaw = newYaw;
  boardRoot.rotation.y = yaw;
  y = boardRoot.position.y; yVel = 0;

  // Zero local rotations while grinding
  riderGroup.rotation.set(0, 0, 0);
  boardVisual.rotation.set(0, 0, 0);

  // Exit logic (spacePressed or atEnd)
  const pushing = keys.has('Space');
  if (spacePressed || atEnd) {
    const exitSpeed = railSpeedRef.current;
    const dir = (railDir === 1 ? 1 : -1);
    v.copy(currentRail.tangent).multiplyScalar(exitSpeed * dir);
    carrySpeedRef.current = exitSpeed;

    // Pop to air (unchanged)
    const popped = (spacePressed === true);
    yVel = popped ? (params.ollieVel * 0.6) : 0.0;
    state.current = 'airborne';
    setIsAir(true);
    currentRail = null;
    airCarryTimer.current = 0.35;

    if (!POINTS_DISABLED) setAirPoints(100);

    // Names-only on exit: (we already stopped adding 50-50 here)
    // completedTricks.push({ name: '50-50', points: 0 }); // keep if you want it in landing banner

    // Record grind for landing banner (names-only while points are off)
completedTricks.push({ name: '50-50', points: 0 });

    grindDist = 0;
    spacePressed = false;
    return;
  }
}

      if (state.current === 'airborne') {
                // Lock horizontal speed during carry window so we don't snap down/up mid-air
        if (airCarryTimer.current > 0) {
          const speed = v.length();
          const want = carrySpeedRef.current;
          if (speed > 1e-3) {
            v.setLength(want); // keep direction as already set (rail tangent on exit)
          }
        }
        
        // --- Trick queue execution (visual + completion) ---

  const { dRollZ, dSpinY, completed } = queue.tick(dt, flipSpeed, shuvSpeed);

  // Apply the per-frame visuals
  boardRollZ += dRollZ;
  boardSpinY += dSpinY;

  // If something just finished, snap angles cleanly and update names
  if (completed) {
    if (completed.name === 'Kickflip') {
      // snap roll to full turns of 2π so you land clean visually
      boardRollZ = Math.round(boardRollZ / (2 * Math.PI)) * (2 * Math.PI);
    } else if (completed.name === 'Shove-it') {
      // snap spin to half-turns of π
      boardSpinY = Math.round(boardSpinY / Math.PI) * Math.PI;
    }
    completedTricks.push(completed);
    feed.addUnique(completed.name);
    setComboPieces([...feed.list]);
  }

        // Flatspin (A/D)
        spinLockTimer = Math.max(0, spinLockTimer - dt);
        const spinInput = spinLockTimer > 0 ? 0 : ((keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0));
        const dSpin = spinRate * dt * spinInput;
        spinAngle += dSpin; airSpinAbs += Math.abs(dSpin);

        // Live “air” value = base 100 + spin + any completed flip/shuv already finished mid-air
        const spinDegAbs = airSpinAbs * 180 / Math.PI;
        if (!POINTS_DISABLED) {
          const airCompleted = completedTricks.reduce((s, t) => s + (t.points || 0), 0);
          const liveAir = 100 + Math.floor(spinDegAbs) + airCompleted;
          setAirPoints(liveAir);
          setComboLive(comboLiveRef.current + liveAir);
        } else {
          // keep numeric live air at zero to avoid NaN/UI noise
          setAirPoints(0);
          setComboLive(comboAnchorRef.current || 0);
        }

        // vertical
        yVel -= params.g * dt; y += yVel * dt;
        if (y <= 0.03) {
          y = 0.03; yVel = 0.0;
          const landingSpeed = v.length();
          if (landingSpeed > 0.1) {
            // Queue-based progress: if queue still has an item, trick is not finished
const tricksInProgress = !queue.isEmpty();

// Snap to clean angles once tricks are done so small residuals don't cause bail
if (!tricksInProgress) {
  boardRollZ = Math.round(boardRollZ / (2*Math.PI)) * (2*Math.PI);
  boardSpinY = Math.round(boardSpinY / Math.PI) * Math.PI;
}


            const facingYaw = yaw + spinAngle;
            const facing = new THREE.Vector3(Math.sin(facingYaw), 0, Math.cos(facingYaw)).normalize();
            const velDir = v.clone().normalize();
            const angle = Math.acos(THREE.MathUtils.clamp(facing.dot(velDir), -1, 1));
            const okForward = angle <= params.bailAngle;
            const okBackward = Math.abs(angle - Math.PI) <= params.bailAngle;

            const rollOk = Math.abs(THREE.MathUtils.radToDeg(wrapAngle(boardRollZ))) <= 15;

            if (!tricksInProgress && rollOk && (okForward || okBackward)) {
              // Quantize the spin to “0 / 180 / 360 …” names, but score the actual spin
            const spinDegAbs = airSpinAbs * 180 / Math.PI;
            const spinDegQuant = Math.round(spinDegAbs / 180) * 180;
            const baseName = spinDegQuant === 0 ? 'Ollie' : `${spinDegQuant} Ollie`;

            // Names: show in the order they happened (Ollie first, then flips/shuvs, etc.)
            const names = [baseName, ...completedTricks.map(t => t.name)];
            const finalName = names.join(' + ');

            // Commit the banner name
            setLastTrick(finalName);

            if (!POINTS_DISABLED) {
              // Points: 100 base + spin degrees (rounded down) + every completed trick’s points
              const finalPoints =
              100 +
              Math.floor(spinDegAbs) +
              completedTricks.reduce((sum, t) => sum + (t.points || 0), 0);

              // Bank the full combo: prior baseline + this segment
              const bank = comboLiveRef.current + finalPoints;
              const safeBank = Number.isFinite(bank) ? bank : 0;
              setLastTrickPts(safeBank);
              setTrickTimer(1.6);
              setTotalScore(prev => prev + safeBank);
            } else {
              // Points disabled: show names only, zero the numeric banner
              setLastTrickPts(0);
              setTrickTimer(1.6);
            }
            
            // Reset combo state for next run (names/visuals preserved, numeric cleared)
            comboLiveRef.current = 0;
            comboAnchorRef.current = 0;
            setComboLive(0);
            setIsGrinding(false);
            completedTricks.length = 0;
            comboPiecesRef.current = [];
            setComboTick(t => t + 1);
            comboLiveRef.current = 0;
            comboAnchorRef.current = 0;
            setComboLive(0);
            setIsGrinding(false);

            // Clean up + exit air
            state.current = 'coasting';

              spinAngle = 0; airSpinAbs = 0; boardRollZ = 0; boardSpinY = 0; spinLockTimer = 0;
              capMat.color.set(0xff914d);
              setBailTimer(0);
            } else {
              setTrickTimer(0); setBailTimer(1.0); state.current = 'bail';
              // Hard reset tricks on bail (prevents carry-over into next run)
trickQueue.length = 0;
completedTricks.length = 0;
comboPiecesRef.current = [];

setComboTick(t => t + 1);
kDownLatch = false;

              comboLiveRef.current = 0;
              comboAnchorRef.current = 0;
              setComboLive(0);
              setIsGrinding(false);
              comboPiecesRef.current = [];
              setComboTick(t => t + 1);
              capMat.color.set(0xff2222);
              riderGroup.rotation.set(Math.PI/2, 0, 0);
            }
          } else {
            state.current = 'idle';
            spinAngle = 0; airSpinAbs = 0; boardRollZ = 0; boardSpinY = 0; capMat.color.set(0xff914d);
            setTrickTimer(0); setBailTimer(0);
          }
          setIsAir(false);
          // Note: post-landing carry disabled in Points-disabled mode to avoid double-counting
          if (!POINTS_DISABLED) {
            const airCompleted = completedTricks.reduce((s, t) => s + (t.points || 0), 0);
            const liveAir = 100 + Math.floor(airSpinAbs * 180 / Math.PI) + airCompleted;
            comboLiveRef.current += liveAir;
            setComboLive(comboLiveRef.current);
          } else {
            setComboLive(0);
          }
        }
      }

      if (state.current === 'bail') {
        if (isAir) setIsAir(false);
        const speed = v.length();
        const ns = approach(speed, 0, params.accel, dt);
        if (ns === 0) v.set(0,0,0); else v.setLength(ns);
        if (ns === 0) {
  // Safety: ensure nothing lingers after bail fully stops
  queue.clear();
  completedTricks.length = 0;
  
  setComboPieces([...feed.list]);
  state.current = 'idle';
  capMat.color.set(0xff914d);
  riderGroup.rotation.set(0,0,0);
}


      }

      if (state.current !== 'grind') {
        boardRoot.position.y = y;
        blob.position.x = boardRoot.position.x; blob.position.z = boardRoot.position.z;

        if (state.current === 'airborne') {
          riderGroup.rotation.set(0, spinAngle, 0);
          boardVisual.rotation.set(0, spinAngle + boardSpinY, boardRollZ);
        } else if (state.current !== 'bail') {
          riderGroup.rotation.set(0, 0, 0);
          boardVisual.rotation.set(0, 0, 0);
        }
      }

      if (state.current !== 'bail' && v.length() > 0.05) { setBailTimer(0); }
    }

    function updateCamera(dt: number) {
      const forward = forwardFromYaw(yaw);
      const behind = forward.clone().multiplyScalar(-6.5);
      const desired = new THREE.Vector3().copy(boardRoot.position).add(behind).add(new THREE.Vector3(0, 3.2, 0));
      camSmoothPos.lerp(desired, Math.min(1, dt * 6.0));
      camera.position.copy(camSmoothPos);
      const lookAt = new THREE.Vector3().copy(boardRoot.position).add(new THREE.Vector3(0, 1.0, 0));
      camera.lookAt(lookAt);
    }

    // ---------- Collect + FX ----------
    function tryCollectStar(dt: number) {
      if (!starAlive) return;
      const t = performance.now() * 0.001;
      star.position.y = STAR_HOVER_BASE_Y + Math.sin(t * 2.0) * 0.25;
      star.rotation.y += dt * 2.0;

      const dx = boardRoot.position.x - star.position.x;
      const dz = boardRoot.position.z - star.position.z;
      const dy = boardRoot.position.y + 1.0 - star.position.y;
      const distSq = dx*dx + dy*dy + dz*dz;
      const pickRadius = 1.1;
      if (distSq < pickRadius * pickRadius) {
        starAlive = false; star.visible = false;
        sparkles.push(new Sparkle(scene, star.position.clone()));
        if (!POINTS_DISABLED) {
          popups.push(new ScorePopup(scene, star.position.clone()));
        }
        starsCountRef.current += 1; setStarsCollected(prev => prev + 1);
        if (typeof (window as any).onCollectSound === 'function') (window as any).onCollectSound();
        setTimeout(respawnStar, 700);
      }
    }

    function updateFX(dt: number) {
      for (let i = sparkles.length - 1; i >= 0; i--) { if (!sparkles[i].update(dt)) sparkles.splice(i, 1); }
      for (let i = popups.length - 1; i >= 0; i--) { if (!popups[i].update(dt)) popups.splice(i, 1); }
    }

    function setHUD() {
      if (!hudRef.current) return;
      const speed = v.length();
      const comp = headingToCompass(yaw);
      hudRef.current.innerHTML =
        `build: <b>${BUILD_TAG}</b> &nbsp;|&nbsp; ` +
        `STATE: <b>${state.current}</b> &nbsp;|&nbsp; ` +
        `SPEED: ${speed.toFixed(2)} m/s &nbsp;|&nbsp; ` +
        `HEADING: ${comp.label} ${comp.deg}° &nbsp;|&nbsp; ` +
        `⭐ Stars: ${starsCountRef.current}` + (POINTS_DISABLED ? '' : ` &nbsp;|&nbsp; Score: ${totalScore}`);
    }

    // ---------- Main loop ----------
    let last = performance.now();
    let rafId = 0 as number;
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      updateState(dt);
      updateMovement(dt);
      updateCamera(dt);
      tryCollectStar(dt);
      updateFX(dt);
      setHUD();
      setTrickTimer(t => (t > 0 ? Math.max(0, t - dt) : 0));
      setBailTimer(t => (t > 0 ? Math.max(0, t - dt) : 0));
      momentumHold.current = Math.max(0, momentumHold.current - dt);
      coyoteTimer = Math.max(0, coyoteTimer - dt); 
      airCarryTimer.current = Math.max(0, airCarryTimer.current - dt);
      renderer.render(scene, camera);
      spacePressed = false;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onResize = () => {
      const w = mount.clientWidth  || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
}, [
  coastSpeed, chargeSpeed, turnRateIdle, turnRateCoast, turnRateCharge, tileRepeat,
  spinRate, flipSpeed, shuvSpeed,
  railSnapDist, railSnapAngleDeg, railFriction,
    railMagnetTime, railCoyoteMs
]);

  // ---------- UI ----------
  const trickOpacity = Math.max(0, Math.min(1, trickTimer / 1.6));
  const showTrick = trickTimer > 0 && !isAir;

  const bailStyle: React.CSSProperties = {
    position: "fixed", bottom: 64, left: 32, fontWeight: 700, userSelect: "none",
    color: "#ff4444",
    transform: `rotate(-12deg) translateY(${(1 - Math.max(0, Math.min(1, bailTimer / 1))) * 160}px)`,
    opacity: Math.max(0, Math.min(1, bailTimer / 1)),
    zIndex: 10
  };

  // Simple Labeled component for slider labels
  function Labeled({ label, children }: { label: React.ReactNode, children: React.ReactNode }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ marginBottom: 2 }}>{label}</div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", fontFamily: "system-ui, sans-serif" }}>
      {/* WebGL mount fills the screen */}
      <div id="gnar-mount" ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* HUD top-left (build/state/speed/stars/score) */}
      <div
        ref={hudRef}
        style={{
          position: "fixed", top: 12, left: 12,
          fontSize: 12, color: "#fff",
          background: "rgba(0,0,0,0.6)", padding: "8px 12px",
          borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.3)", zIndex: 10
        }}
      />

            {/* Trick label bottom-center */}
      <div style={{
        position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)",
        textAlign: "center", color: "#fff", fontWeight: 700, userSelect: "none", zIndex: 10
      }}>
        {(isAir || currentRail) ? (
          <div>
            <div style={{ fontSize: 20 }}>
              {comboPieces.length ? comboPieces.join(" + ") : "Ollie"}
            </div>
            { !POINTS_DISABLED ? (
              <div style={{ fontSize: 18 }}>
                +{ currentRail ? grindLivePts : airPoints }
              </div>
            ) : null }
          </div>
        ) : (
          <div style={{ opacity: trickOpacity }}>
            {showTrick && (
              <div>
                <div style={{ fontSize: 20 }}>{lastTrick}</div>
                <div style={{ fontSize: 18 }}>+{ Number.isFinite(lastTrickPts) ? lastTrickPts : 0 }</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bail label bottom-left (tilted, drops) */}
      <div style={bailStyle}>
        {bailTimer > 0 && <div>Bail</div>}
      </div>

      {/* ---- Tabbed sliders panel (top-right) ---- */}
      {panelVisible && (
        <div style={{
          position: "fixed", top: 12, right: 12,
          background: "rgba(0,0,0,0.6)", color: "#fff",
          padding: 12, borderRadius: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
          fontSize: 12, zIndex: 10, width: 300
        }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {(["Movement","Turning","Air","Board","Rails","World"] as const).map(tab => (
              <button
                key={tab}
                onClick={()=>setActiveTab(tab)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: activeTab===tab ? "rgba(255,255,255,0.12)" : "transparent",
                  color: "#fff", cursor: "pointer"
                }}
              >
                {tab}
              </button>
            ))}
            <div style={{ marginLeft: "auto", opacity: 0.7 }}>H=hide · [ / ]=tabs</div>
          </div>

          {/* Body */}
          {activeTab === "Movement" && (
            <div>
              <Labeled label={`Coast Speed: ${coastSpeed.toFixed(1)} m/s`}> 
                <input type="range" min="0.5" max="15" step="0.1"
                  value={coastSpeed} onChange={e=>setCoastSpeed(parseFloat(e.target.value))} />
              </Labeled>
              <Labeled label={`Charge Speed: ${chargeSpeed.toFixed(1)} m/s`}>
                <input type="range" min={coastSpeed} max="20" step="0.1"
                  value={chargeSpeed} onChange={e=>setChargeSpeed(parseFloat(e.target.value))} />
              </Labeled>
            </div>
          )}

          {activeTab === "Turning" && (
            <div>
              <Labeled label={`Turn Rate (Idle): ${turnRateIdle.toFixed(2)} rad/s`}>
                <input type="range" min="0.5" max="5" step="0.1"
                  value={turnRateIdle} onChange={e=>setTurnRateIdle(parseFloat(e.target.value))} />
              </Labeled>
              <Labeled label={`Turn Rate (Coast): ${turnRateCoast.toFixed(2)} rad/s`}>
                <input type="range" min="0.5" max="5" step="0.1"
                  value={turnRateCoast} onChange={e=>setTurnRateCoast(parseFloat(e.target.value))} />
              </Labeled>
              <Labeled label={`Turn Rate (Charge): ${turnRateCharge.toFixed(2)} rad/s`}>
                <input type="range" min="0.5" max="5" step="0.1"
                  value={turnRateCharge} onChange={e=>setTurnRateCharge(parseFloat(e.target.value))} />
              </Labeled>
            </div>
          )}

          {activeTab === "Air" && (
            <div>
              <Labeled label={`Air Spin Speed: ${spinRate.toFixed(2)} rad/s`}>
                <input type="range" min="1" max="12" step="0.1"
                  value={spinRate} onChange={e=>setSpinRate(parseFloat(e.target.value))} />
              </Labeled>
              {/* Optional later:
              <Labeled label={`Ollie Velocity: ${params.ollieVel.toFixed(1)} m/s`}><input .../></Labeled>
              <Labeled label={`Bail Angle: ${THREE.MathUtils.radToDeg(params.bailAngle).toFixed(0)}°`}><input .../></Labeled>
              */}
            </div>
          )}

          {activeTab === "Board" && (
            <div>
              {/* --- Flip Speed --- */}
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4 }}>Flip Speed: {flipSpeed.toFixed(2)} rad/s</div>
  <input
    style={{ width: "100%" }}
    type="range"
    min="1"
    max="32"
    step="0.1"
    value={flipSpeed}
    onChange={e => setFlipSpeed(parseFloat(e.target.value))}
  />
</div>

{/* --- Shove-it Speed --- */}
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4 }}>Shove-it Speeda: {shuvSpeed.toFixed(2)} rad/s</div>
  <input
    style={{ width: "100%" }}
    type="range"
    min="1"
    max="24"
    step="0.1"
    value={shuvSpeed}
    onChange={e => setShuvSpeed(parseFloat(e.target.value))}
  />
</div>
            </div>
          )}

          {activeTab === "Rails" && (
            <div>
              {/* --- Rail Snap Distance --- */}
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4 }}>Rail Snap Distance: {railSnapDist.toFixed(2)} m</div>
  <input
    style={{ width: "100%" }}
    type="range"
    min="0"
    max="3.0"
    step="0.05"
    value={railSnapDist}
    onChange={e=>setRailSnapDist(parseFloat(e.target.value))}
  />
</div>

{/* --- Rail Magnet Time --- */}
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4 }}>Rail Magnet Time: {railMagnetTime.toFixed(2)} s</div>
  <input
    style={{ width: "100%" }}
    type="range"
    min="0"
    max="1.5"
    step="0.01"
    value={railMagnetTime}
    onChange={e=>setRailMagnetTime(parseFloat(e.target.value))}
  />
</div>

{/* --- Rail Coyote Time --- */}
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4 }}>Rail Coyote Time: {railCoyoteTime.toFixed(2)} s</div>
  <input
    style={{ width: "100%" }}
    type="range"
    min="0"
    max="1.0"
    step="0.01"
    value={railCoyoteTime}
    onChange={e=>setRailCoyoteTime(parseFloat(e.target.value))}
  />
</div>
            </div>
          )}

          {activeTab === "World" && (
            <div>
              {/* Future: time of day, weather, etc. */}
              <div style={{ opacity: 0.7, fontStyle: "italic", padding: "8px 0" }}>
                (Coming soon: time of day, weather, etc.)
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls hint bottom-left */}
      <div style={{ position: "fixed", bottom: 12, left: 12, fontSize: 12, color: "rgba(255,255,255,0.8)", zIndex: 10 }}>
        {`Controls: W=accelerate, S=brake, A/D=turn, Space=tricks / bail`}
      </div>
    </div>
  );
}
