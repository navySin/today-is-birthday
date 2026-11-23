import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { Mood, RoomProp, RoomState, Walker, WorldPick } from "./types";

type RoomView = {
  group: THREE.Group;
  person: THREE.Group | null;
  upper: THREE.Group | null;
  flames: THREE.Object3D[];
  light: THREE.PointLight;
  beacon: THREE.PointLight;
  glow: THREE.Mesh;
  label: CSS2DObject;
  who: CSS2DObject | null;
  candleCount: number;
  bow: number;
  bowingUntil: number;
};

const candleGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.14, 8);
const candleMat = new THREE.MeshStandardMaterial({ color: "#f7f1e4", roughness: 0.4 });
const flameGeo = new THREE.SphereGeometry(0.045, 10, 10);
const flameMat = new THREE.MeshBasicMaterial({ color: "#ffb15a" });
const coreGeo = new THREE.SphereGeometry(0.02, 8, 8);
const coreMat = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
const eyeGeo = new THREE.SphereGeometry(0.016, 8, 8);
const eyeMat = new THREE.MeshBasicMaterial({ color: "#3a2a24" });

const MOOD_LIGHT: Record<Mood, number> = {
  cool: 0x9eb6d4,
  lantern: 0xffb15a,
  flower: 0xe7b2c4,
  dim: 0xc4a574,
  warm: 0xff7a3c,
  moon: 0xd5def0,
};

const ROOM_LOOK: Record<Mood, { floor: string; wall: string; back: string; sofa: string; frame: string; cake: string; fill: number }> = {
  cool: { floor: "#8a7564", wall: "#6e7f8e", back: "#465664", sofa: "#7d93a8", frame: "#d5dde4", cake: "#f4efe6", fill: 0xc5d4e4 },
  lantern: { floor: "#8b6242", wall: "#7a5138", back: "#4a2e22", sofa: "#c47a32", frame: "#e4c078", cake: "#f3e0c4", fill: 0xffc27a },
  flower: { floor: "#a07868", wall: "#8d6560", back: "#5c3c44", sofa: "#c47b8c", frame: "#f0ddd2", cake: "#f7efe4", fill: 0xf0c2c8 },
  dim: { floor: "#5c5148", wall: "#463e38", back: "#2c2622", sofa: "#6a6058", frame: "#b5a898", cake: "#e4dcc8", fill: 0xa09078 },
  warm: { floor: "#8a543c", wall: "#7a4432", back: "#4a241c", sofa: "#c45434", frame: "#e6c4a0", cake: "#f6e2cc", fill: 0xff8a55 },
  moon: { floor: "#8c8a88", wall: "#6c7482", back: "#3c4452", sofa: "#c8c6d4", frame: "#e6e4ee", cake: "#f7f4ef", fill: 0xd5def0 },
};

function roomMat(color: string, roughness = 0.84) {
  return new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide });
}

function makeWhoPlate(mine: boolean, y: number) {
  const el = document.createElement("div");
  el.className = mine ? "who mine" : "who";
  const mark = document.createElement("b");
  if (mine) mark.textContent = "나";
  const name = document.createElement("span");
  el.append(mark, name);
  const plate = new CSS2DObject(el);
  plate.name = "who-plate";
  plate.position.set(0, y, 0);
  return plate;
}

function makePerson(color: string, skin: string, standing: boolean, hair = "#4a3b34") {
  const person = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.84 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.68 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.8 });
  const upper = new THREE.Group();

  if (standing) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 6, 12), cloth);
    body.position.y = 0.72;
    body.userData.part = "cloth";
    person.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), skinMat);
    head.position.y = 1.28;
    head.userData.part = "skin";
    person.add(head);
    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.188, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat,
    );
    hairMesh.position.y = 0.03;
    hairMesh.userData.part = "hair";
    head.add(hairMesh);
    const left = new THREE.Mesh(eyeGeo, eyeMat);
    left.position.set(-0.055, 0.02, 0.15);
    const right = new THREE.Mesh(eyeGeo, eyeMat);
    right.position.set(0.055, 0.02, 0.15);
    head.add(left, right);
    return { person, upper: person };
  }

  const cushion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.38, 0.07, 20),
    new THREE.MeshStandardMaterial({ color: "#2a211b", roughness: 1 }),
  );
  cushion.position.y = 0.035;
  person.add(cushion);
  upper.position.y = 0.34;
  person.add(upper);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), cloth);
  body.scale.set(1.05, 0.72, 0.9);
  body.position.y = 0.02;
  body.userData.part = "cloth";
  upper.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), skinMat);
  head.position.y = 0.4;
  head.userData.part = "skin";
  upper.add(head);
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.178, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    hairMat,
  );
  hairMesh.position.y = 0.03;
  hairMesh.userData.part = "hair";
  head.add(hairMesh);
  const left = new THREE.Mesh(eyeGeo, eyeMat);
  left.position.set(-0.055, 0.02, 0.15);
  const right = new THREE.Mesh(eyeGeo, eyeMat);
  right.position.set(0.055, 0.02, 0.15);
  head.add(left, right);
  return { person, upper };
}

function paintPerson(root: THREE.Object3D, color: string, skin: string, hair: string) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !(obj.material instanceof THREE.MeshStandardMaterial)) return;
    if (obj.userData.part === "cloth") obj.material.color.set(color);
    if (obj.userData.part === "skin") obj.material.color.set(skin);
    if (obj.userData.part === "hair") obj.material.color.set(hair);
  });
}

const ROOM_MIN_X = -1.7;
const ROOM_MAX_X = 1.75;
const SOFA_X = -1.68;
const SOFA_Z = 1.2;
const MIRROR_X = 1.45;
const MIRROR_Z = -0.55;
const ROOM_MIN_Z = -0.85;
const ROOM_MAX_Z = 2.85;
const ROOM_EXIT_Z = 3.25;

function makeRoomShell(mood: Mood) {
  const look = ROOM_LOOK[mood];
  const group = new THREE.Group();
  const wallMat = roomMat(look.wall, 0.78);
  const backMat = roomMat(look.back, 0.86);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(6.6, 0.12, 6.2),
    new THREE.MeshStandardMaterial({ color: look.floor, roughness: 0.72 }),
  );
  floor.position.y = 0.06;
  floor.userData.floor = true;
  group.add(floor);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.95, 6.2), wallMat);
  left.position.set(-3.22, 1.52, 0);
  const right = left.clone();
  right.position.x = 3.22;
  const back = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.95, 0.16), backMat);
  back.position.set(0, 1.52, -3.02);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(7.05, 0.16, 6.6), backMat);
  roof.position.y = 3.08;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 0.16), backMat);
  lintel.position.set(0, 2.88, 3.02);
  for (const wall of [left, right, back, roof, lintel]) wall.userData.occlude = true;
  group.add(left, right, back, roof, lintel);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.48, 18),
    new THREE.MeshStandardMaterial({ color: look.back, roughness: 0.8 }),
  );
  table.position.set(0, 0.36, -2.15);
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: "#f3e6d4", roughness: 0.5 }),
  );
  plate.position.set(0, 0.62, -2.15);
  const cake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.22, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: look.cake, roughness: 0.52 }),
  );
  cake.position.set(0, 0.7, -2.15);
  table.userData.use = "cake";
  plate.userData.use = "cake";
  cake.userData.use = "cake";
  group.add(table, plate, cake);
  const sofa = makeSofa(look.sofa);
  const mirror = makeMirror(look.frame);
  group.userData.glass = mirror.userData.glass;
  group.add(sofa, mirror);
  addRoomProps(group, mood);

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(7.1, 3.3, 6.8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.position.y = 1.5;
  hit.userData.bounds = true;
  group.add(hit);
  return group;
}

function addRoomProps(group: THREE.Group, mood: Mood) {
  if (mood === "cool") {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.15, 1.45, 0.08),
      roomMat("#d7dee4", 0.4),
    );
    frame.position.set(0, 1.75, -2.9);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.12),
      new THREE.MeshBasicMaterial({ color: 0xb7c9dc, transparent: true, opacity: 0.92 }),
    );
    glass.position.set(0, 1.75, -2.84);
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.12, 0.03), roomMat("#eef3f6", 0.35));
    mullion.position.set(0, 1.75, -2.83);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.2), roomMat("#c5ced6", 0.5));
    sill.position.set(0, 1.02, -2.8);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10),
      roomMat("#6d7c72", 0.7),
    );
    pot.position.set(-0.72, 1.14, -2.76);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), roomMat("#6f8f62", 0.7));
    leaf.position.set(-0.72, 1.3, -2.76);
    group.add(frame, glass, mullion, sill, pot, leaf);
  }
  if (mood === "lantern") {
    for (const [x, y, z] of [
      [-1.35, 2.28, -0.15],
      [0.2, 2.48, -1.15],
      [1.3, 2.15, 0.45],
    ] as const) {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6),
        roomMat("#3a2a22", 0.8),
      );
      cord.position.set(x, y + 0.28, z);
      const shade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.2, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc56b }),
      );
      shade.position.set(x, y, z);
      group.add(cord, shade);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.72, 8), roomMat("#4a3428", 0.8));
    post.position.set(-2.55, 0.46, -1.55);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb15a }),
    );
    globe.position.set(-2.55, 0.92, -1.55);
    group.add(post, globe);
  }
  if (mood === "flower") {
    const vase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.24, 12),
      roomMat("#f4f0ea", 0.4),
    );
    vase.position.set(-1.25, 0.28, -2.45);
    group.add(vase);
    [0xd36b84, 0xf0d36b, 0xe7e2dc, 0xc46b7a].forEach((color, index) => {
      const angle = (index / 4) * Math.PI * 2;
      const x = -1.25 + Math.cos(angle) * 0.05;
      const z = -2.45 + Math.sin(angle) * 0.05;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 5), roomMat("#5d7a52", 0.7));
      stem.position.set(x, 0.52, z);
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), roomMat(`#${color.toString(16).padStart(6, "0")}`, 0.5));
      bloom.position.set(x, 0.72, z);
      group.add(stem, bloom);
    });
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 22),
      new THREE.MeshStandardMaterial({ color: "#e7c2c8", roughness: 0.92 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.95, 0.13, -1.2);
    group.add(rug);
  }
  if (mood === "dim") {
    const screen = roomMat("#3c3834", 0.92);
    const panelA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.78), screen);
    panelA.position.set(-2.72, 0.78, -1.45);
    panelA.rotation.y = 0.45;
    const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.78), screen);
    panelB.position.set(-2.42, 0.78, -0.78);
    panelB.rotation.y = -0.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10), roomMat("#2a2420", 0.8));
    base.position.set(2.45, 0.16, -1.7);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xc4a574 }),
    );
    lamp.position.set(2.45, 0.32, -1.7);
    group.add(panelA, panelB, base, lamp);
  }
  if (mood === "warm") {
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.78, 0.14),
      roomMat("#2a140e", 0.9),
    );
    mouth.position.set(-1.6, 0.58, -2.9);
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a3c }),
    );
    fire.scale.set(1.15, 0.7, 0.45);
    fire.position.set(-1.6, 0.4, -2.82);
    const mantle = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 0.2), roomMat("#6a4034", 0.82));
    mantle.position.set(-1.6, 1.04, -2.86);
    group.add(mouth, fire, mantle);
  }
  if (mood === "moon") {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0xf4f1e8 }),
    );
    disc.position.set(-1.65, 2.15, -2.9);
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshStandardMaterial({ color: "#d5d8e2", roughness: 0.95 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.85, 0.13, -1.25);
    group.add(disc, rug);
  }
}

function makeSofa(clothColor: string) {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.78 });
  const wood = new THREE.MeshStandardMaterial({ color: "#4a3428", roughness: 0.8 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 1.5), cloth);
  seat.position.set(0.14, 0.38, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 1.5), cloth);
  back.position.set(-0.22, 0.64, 0);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.28, 0.14), cloth);
  armL.position.set(0.06, 0.54, -0.68);
  const armR = armL.clone();
  armR.position.z = 0.68;
  for (const [x, z] of [
    [-0.12, -0.58],
    [-0.12, 0.58],
    [0.3, -0.58],
    [0.3, 0.58],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), wood);
    leg.position.set(x, 0.11, z);
    group.add(leg);
  }
  group.add(seat, back, armL, armR);
  group.position.set(-1.95, 0, SOFA_Z);
  group.userData.use = "sofa";
  return group;
}

function makeMirror(frameColor: string) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 1.2, 0.08),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.42 }),
  );
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 1.02),
    new THREE.MeshStandardMaterial({
      color: "#d7e6ec",
      metalness: 0.82,
      roughness: 0.08,
      emissive: "#b7d0da",
      emissiveIntensity: 0.12,
    }),
  );
  glass.position.z = 0.05;
  const made = makePerson("#d8c3a5", "#f0d0b4", true);
  const figure = made.person;
  figure.name = "reflection";
  figure.scale.setScalar(0.62);
  figure.position.set(0, -0.5, 0.12);
  figure.userData.baseY = -0.5;
  figure.visible = false;
  figure.traverse((obj) => {
    obj.raycast = () => undefined;
    if (obj instanceof THREE.Mesh && obj.material === eyeMat) obj.scale.setScalar(2.4);
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.transparent = true;
      obj.material.opacity = 0.9;
      obj.material.emissive.set("#c5d5de");
      obj.material.emissiveIntensity = 0.15;
    }
  });
  const body = figure.children[0];
  const head = figure.children[1];
  if (body instanceof THREE.Mesh && body.material instanceof THREE.MeshStandardMaterial) {
    glass.userData.reflectCloth = body.material;
  }
  if (head instanceof THREE.Mesh && head.material instanceof THREE.MeshStandardMaterial) {
    glass.userData.reflectSkin = head.material;
  }
  figure.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.part === "hair" && obj.material instanceof THREE.MeshStandardMaterial) {
      glass.userData.reflectHair = obj.material;
    }
  });
  glass.userData.reflection = figure;
  group.add(frame, glass, figure);
  group.position.set(1.55, 1.48, -2.9);
  group.userData.use = "mirror";
  group.userData.glass = glass;
  return group;
}

export function createWorld(
  host: HTMLElement,
  hooks: {
    onMove: (x: number, z: number, roomId?: string | null, pose?: "stand" | "sit" | "mirror") => void;
    onExit: () => void;
    onCake: () => void;
    onMirror: () => void;
    onNote: (message: string) => void;
  },
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.setClearColor(0x5c4b3c);
  host.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(host.clientWidth, host.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x5c4b3c, 0.02);
  scene.background = new THREE.Color(0x5c4b3c);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);

  scene.add(new THREE.AmbientLight(0xfff1df, 1.15));
  scene.add(new THREE.HemisphereLight(0xffe7c8, 0x8d6b4a, 0.95));
  const sun = new THREE.DirectionalLight(0xffe2c2, 0.72);
  sun.position.set(-8, 16, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(62, 80),
    new THREE.MeshStandardMaterial({ color: "#6d5646", roughness: 0.94 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const pathMat = new THREE.MeshStandardMaterial({ color: "#b08968", roughness: 0.9 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: "#4e6d52", roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6a4b38", roughness: 0.88 });
  const leafMat = new THREE.MeshStandardMaterial({ color: "#5d8158", roughness: 0.86 });
  const poleMat = new THREE.MeshStandardMaterial({ color: "#6d5342", roughness: 0.86 });
  const occluders: THREE.Object3D[] = [];

  function addPath(x: number, z: number, width: number, depth: number) {
    const path = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), pathMat);
    path.position.set(x, 0.025, z);
    scene.add(path);
  }
  function addHedge(x: number, z: number, width: number, depth: number, height = 2.15) {
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), hedgeMat);
    hedge.position.set(x, height / 2, z);
    hedge.userData.occlude = true;
    occluders.push(hedge);
    scene.add(hedge);
  }
  function addTree(x: number, z: number, scale = 1) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 1.15 * scale, 6), trunkMat);
    trunk.position.set(x, 0.55 * scale, z);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.95 * scale, 2.15 * scale, 7), leafMat);
    leaf.position.set(x, 1.85 * scale, z);
    trunk.userData.occlude = true;
    occluders.push(trunk);
    scene.add(trunk, leaf);
  }
  function addLamp(x: number, z: number) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.7, 8), poleMat);
    pole.position.set(x, 0.85, z);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc56b }),
    );
    lamp.position.y = 0.9;
    pole.add(lamp);
    scene.add(pole);
    const glow = new THREE.PointLight(0xffc56b, 1.35, 9, 2);
    glow.position.set(x, 1.65, z);
    scene.add(glow);
  }

  addPath(0, 27, 2.8, 18);
  addPath(-8, 22, 14, 2.3);
  addPath(0, 14, 2.8, 14);
  addPath(10, 6, 18, 2.3);
  addPath(-2, 4, 8, 2.3);
  addPath(-6, -2, 2.6, 14);
  addPath(-14, -8, 16, 2.3);
  addPath(2, -14, 2.6, 16);
  addPath(10, -20, 14, 2.3);
  addPath(-4, -28, 2.6, 14);
  addPath(-10, -30, 12, 2.3);
  addPath(-16, -32, 2.4, 6);
  addPath(6, -36, 24, 2.3);

  addHedge(-8, 29, 12, 1.15, 2.4);
  addHedge(-12, 8, 10, 1.15, 2.1);
  addHedge(8, -24, 8, 1.15, 2.1);

  for (const [x, z, scale] of [
    [-6, 32, 1.55],
    [6, 20, 1.45],
    [-14, 4, 1.5],
    [8, 12, 1.3],
    [-4, -12, 1.5],
    [12, -16, 1.3],
    [-18, -28, 1.35],
    [14, -32, 1.35],
  ] as const) addTree(x, z, scale);

  for (const [x, z] of [
    [-1.7, 33],
    [1.7, 33],
    [-1.7, 26],
    [1.7, 26],
    [-1.7, 18],
    [1.7, 16],
    [-8, 22],
    [8, 6],
    [-6, 2],
    [-6, -6],
    [-14, -8],
    [2, -12],
    [2, -18],
    [10, -20],
    [-4, -26],
    [-12, -30],
    [-16, -30],
    [4, -36],
    [14, -36],
  ] as const) addLamp(x, z);

  const gateLeft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.6, 0.28), poleMat);
  gateLeft.position.set(-1.8, 1.3, 31.2);
  const gateRight = gateLeft.clone();
  gateRight.position.x = 1.8;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.22), poleMat);
  beam.position.set(0, 2.55, 31.2);
  for (const post of [gateLeft, gateRight, beam]) {
    post.userData.occlude = true;
    occluders.push(post);
  }
  scene.add(gateLeft, gateRight, beam);

  const rooms = new Map<string, RoomView>();
  const walkers = new Map<string, THREE.Group>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const camFrom = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const camRay = new THREE.Raycaster();

  const self = makePerson("#d8c3a5", "#f0d0b4", true);
  const selfSeat = makePerson("#d8c3a5", "#f0d0b4", false);
  selfSeat.person.name = "seat-pose";
  selfSeat.person.visible = false;
  self.person.add(selfSeat.person);
  const selfPlate = makeWhoPlate(true, 1.68);
  self.person.add(selfPlate);
  self.person.position.set(0, 0, 34);
  self.person.rotation.y = Math.PI;
  scene.add(self.person);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.15, 2.28, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffb15a,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  ring.scale.setScalar(1.6);
  scene.add(ring);

  const marker = new THREE.Group();
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.46, 28),
    new THREE.MeshBasicMaterial({
      color: 0xfff1cf,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  markerRing.rotation.x = -Math.PI / 2;
  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 18),
    new THREE.MeshBasicMaterial({
      color: 0xffe1a8,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  markerDot.rotation.x = -Math.PI / 2;
  markerDot.position.y = 0.01;
  marker.add(markerRing, markerDot);
  marker.position.y = 0.05;
  marker.visible = false;
  scene.add(marker);

  let yaw = 0;
  let pitch = 0.42;
  let distance = 8.4;
  let selectedId: string | null = null;
  let frame = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const dest = new THREE.Vector3(0, 0, 34);
  let hasDest = false;
  let moveSent = 0;
  let lastTime = performance.now();
  let insideId: string | null = null;
  let savedOutdoor: number | null = null;
  let snapCamera = false;
  let sitting = false;
  let selfLook = { color: "#d8c3a5", skin: "#f0d0b4", hair: "#4a3b34" };
  let mirroring = false;
  let mirrorUntil = 0;
  let pending: "sit" | "mirror" | null = null;
  const keys = new Set<string>();
  const look = new THREE.Vector3(0, 1.35, 30.8);
  camera.position.set(0, 4.35, 42.4);

  function resize() {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
  }

  function placeCandles(view: RoomView, count: number) {
    for (const flame of view.flames) flame.parent?.remove(flame);
    view.flames = [];
    const shown = Math.min(count, 7);
    for (let i = 0; i < shown; i += 1) {
      const holder = new THREE.Group();
      const angle = shown === 1 ? 0 : (i / shown) * Math.PI * 2;
      const radius = shown === 1 ? 0 : 0.1;
      holder.position.set(Math.cos(angle) * radius, 0.78, -2.15 + Math.sin(angle) * radius);
      const wax = new THREE.Mesh(candleGeo, candleMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.scale.set(1, 1.6, 1);
      flame.position.y = 0.12;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 0.11;
      holder.add(wax, flame, core);
      holder.userData.phase = Math.random() * Math.PI * 2;
      holder.userData.use = "cake";
      view.group.add(holder);
      view.flames.push(holder);
    }
    view.candleCount = count;
  }

  function ensureRoom(room: RoomState) {
    let view = rooms.get(room.id);
    if (view) return view;
    const group = makeRoomShell(room.mood);
    group.position.set(room.x, 0, room.z);
    group.rotation.y = room.angle;
    group.userData.face = room.angle;
    group.userData.roomId = room.id;
    const labelEl = document.createElement("div");
    labelEl.className = "nametag";
    const nameEl = document.createElement("b");
    const countEl = document.createElement("span");
    labelEl.append(nameEl, countEl);
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 3.55, 0);
    group.add(label);
    const light = new THREE.PointLight(MOOD_LIGHT[room.mood], 1.1, 12, 2);
    light.position.set(0, 2.2, -0.2);
    const fill = new THREE.PointLight(ROOM_LOOK[room.mood].fill, 0.9, 11, 2);
    fill.position.set(0, 2.15, 1.1);
    const beacon = new THREE.PointLight(0xffc56b, 0, 18, 1.5);
    beacon.position.set(0, 3.35, 0.4);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe1a8 }),
    );
    glow.position.set(0, 3.55, 0.4);
    glow.visible = false;
    group.add(light, fill, beacon, glow);
    scene.add(group);
    group.traverse((obj) => {
      if (obj.userData.occlude) occluders.push(obj);
    });
    view = {
      group,
      person: null,
      upper: null,
      flames: [],
      light,
      beacon,
      glow,
      label,
      who: null,
      candleCount: -1,
      bow: 0,
      bowingUntil: 0,
    };
    rooms.set(room.id, view);
    return view;
  }

  function sync(nextRooms: RoomState[], roomId: string | null, nextWalkers: Walker[]) {
    const ids = new Set(nextRooms.map((room) => room.id));
    for (const [id, view] of rooms) {
      if (ids.has(id)) continue;
      view.label.element.remove();
      view.group.traverse((obj) => {
        const index = occluders.indexOf(obj);
        if (index >= 0) occluders.splice(index, 1);
      });
      scene.remove(view.group);
      rooms.delete(id);
    }

    for (const room of nextRooms) {
      const view = ensureRoom(room);
      const nameEl = view.label.element.querySelector("b");
      const countEl = view.label.element.querySelector("span");
      if (nameEl) nameEl.textContent = room.title;
      const yours = room.id === roomId;
      const candleCount = room.candleCount ?? room.candles.length;
      if (countEl) countEl.textContent = room.occupant ? `촛불 ${candleCount}` : "비어 있음";
      view.label.element.classList.toggle("yours", yours);
      view.label.element.classList.toggle("lit", !!room.occupant);
      if (view.candleCount !== candleCount) placeCandles(view, candleCount);
      view.bowingUntil = room.occupant?.bowingUntil ?? 0;
      view.light.distance = room.occupant ? 18 : 12;
      view.light.userData.base = room.occupant ? 5 : 1.6;
      view.beacon.intensity = room.occupant ? 3.4 : 0;
      view.glow.visible = !!room.occupant;
      view.light.color.set(MOOD_LIGHT[room.mood]);

      const ownerAway = nextWalkers.some((walker) => walker.roomId === room.id && !!walker.visitRoomId);
      const seated = room.occupant && room.id !== roomId && !ownerAway ? room.occupant : null;
      if (!seated) {
        if (view.person) {
          view.who?.element.remove();
          view.who = null;
          view.group.remove(view.person);
          view.person = null;
          view.upper = null;
        }
      } else if (!view.person) {
        const made = makePerson(seated.color, seated.skin, false, seated.hair || "#4a3b34");
        made.person.position.set(0, 0.12, -1.32);
        const plate = makeWhoPlate(false, 1.12);
        const name = plate.element.querySelector("span");
        if (name) name.textContent = seated.name;
        made.person.add(plate);
        view.who = plate;
        view.group.add(made.person);
        view.person = made.person;
        view.upper = made.upper;
      } else {
        paintPerson(view.person, seated.color, seated.skin, seated.hair || "#4a3b34");
        const name = view.who?.element.querySelector("span");
        if (name) name.textContent = seated.name;
      }
    }

    const shownWalkers = nextWalkers.filter((walker) => {
      if (walker.visitRoomId) return rooms.has(walker.visitRoomId);
      return !walker.roomId;
    });
    const walkerIds = new Set(shownWalkers.map((walker) => walker.id));
    for (const [id, mesh] of walkers) {
      if (walkerIds.has(id)) continue;
      const plate = mesh.getObjectByName("who-plate");
      if (plate instanceof CSS2DObject) plate.element.remove();
      mesh.removeFromParent();
      walkers.delete(id);
    }
    for (const walker of shownWalkers) {
      const visit = walker.visitRoomId ? rooms.get(walker.visitRoomId) : null;
      const parent = visit ? visit.group : scene;
      const tx = visit ? walker.visitX : walker.x;
      const tz = visit ? walker.visitZ : walker.z;
      const ty = visit ? 0.12 : 0;
      let mesh = walkers.get(walker.id);
      if (!mesh) {
        const hair = walker.hair || "#4a3b34";
        mesh = makePerson(walker.color || "#8aa0b4", walker.skin || "#e2b48f", true, hair).person;
        const seatedPose = makePerson(walker.color || "#8aa0b4", walker.skin || "#e2b48f", false, hair).person;
        seatedPose.name = "seat-pose";
        seatedPose.visible = false;
        mesh.add(seatedPose);
        mesh.add(makeWhoPlate(false, 1.68));
        mesh.position.set(tx, ty, tz);
        mesh.rotation.y = visit ? Math.PI : 0;
        parent.add(mesh);
        walkers.set(walker.id, mesh);
      } else if (mesh.parent !== parent) {
        parent.add(mesh);
        mesh.position.set(tx, ty, tz);
      }
      const name = mesh.getObjectByName("who-plate");
      if (name instanceof CSS2DObject) {
        const label = name.element.querySelector("span");
        if (label) label.textContent = walker.name;
        name.element.style.visibility = "visible";
      }
      mesh.userData.tx = tx;
      mesh.userData.tz = tz;
      mesh.userData.ty = walker.pose === "sit" ? 0.28 : ty;
      mesh.userData.visit = walker.visitRoomId ?? "";
      mesh.userData.pose = walker.pose ?? "stand";
      const hair = walker.hair || "#4a3b34";
      paintPerson(mesh, walker.color || "#8aa0b4", walker.skin || "#e2b48f", hair);
      mesh.userData.color = walker.color;
      mesh.userData.skin = walker.skin;
      mesh.userData.hair = hair;
    }
    setSelected(selectedId);
  }

  function setSelected(id: string | null) {
    selectedId = id;
    for (const [roomId, view] of rooms) view.label.element.classList.toggle("selected", roomId === id);
    ring.visible = !!id && rooms.has(id);
  }

  function doorPoint(id: string) {
    const view = rooms.get(id);
    if (!view) return null;
    const face = Number(view.group.userData.face) || 0;
    return {
      x: view.group.position.x + Math.sin(face) * 4.4,
      z: view.group.position.z + Math.cos(face) * 4.4,
    };
  }

  function exitStand(view: RoomView) {
    const face = view.group.rotation.y;
    const flat = Math.abs(Math.cos(pitch)) * distance;
    const out = Math.min(18, 6.1 + flat);
    return clampWalk(view.group.position.x + Math.sin(face) * out, view.group.position.z + Math.cos(face) * out);
  }

  function pullCamera(from: THREE.Vector3, to: THREE.Vector3, target: THREE.Vector3) {
    camDir.subVectors(to, from);
    const len = camDir.length();
    if (len < 0.75) return target.copy(to);
    camDir.multiplyScalar(1 / len);
    camRay.set(from, camDir);
    camRay.far = len;
    const hits = camRay.intersectObjects(occluders, false);
    const hit = hits.find((item) => item.distance > 0.2 && item.distance < len - 0.04);
    if (!hit) return target.copy(to);
    let keep = hit.distance - 0.42;
    if (keep < 0.8) keep = Math.max(0.4, hit.distance * 0.62);
    if (keep >= len - 0.02) return target.copy(to);
    return target.copy(from).addScaledVector(camDir, keep);
  }

  function worldToLocal(view: RoomView, wx: number, wz: number) {
    const face = view.group.rotation.y;
    const dx = wx - view.group.position.x;
    const dz = wz - view.group.position.z;
    const cos = Math.cos(face);
    const sin = Math.sin(face);
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  }

  function localToWorld(view: RoomView, lx: number, lz: number, target: THREE.Vector3) {
    const face = view.group.rotation.y;
    const cos = Math.cos(face);
    const sin = Math.sin(face);
    return target.set(
      view.group.position.x + lx * cos + lz * sin,
      0,
      view.group.position.z - lx * sin + lz * cos,
    );
  }

  function clampRoom(x: number, z: number) {
    return {
      x: Math.max(ROOM_MIN_X, Math.min(ROOM_MAX_X, x)),
      z: Math.max(ROOM_MIN_Z, Math.min(ROOM_MAX_Z, z)),
    };
  }

  function publishMove() {
    if (performance.now() - moveSent < 160) return;
    moveSent = performance.now();
    const pose = sitting ? "sit" : mirroring ? "mirror" : "stand";
    if (insideId) hooks.onMove(self.person.position.x, self.person.position.z, insideId, pose);
    else hooks.onMove(self.person.position.x, self.person.position.z, null, "stand");
  }

  function setSitting(on: boolean) {
    sitting = on;
    for (const child of self.person.children) {
      if (child.name === "seat-pose" || child.name === "who-plate") continue;
      child.visible = !on;
    }
    selfSeat.person.visible = on;
    selfPlate.position.y = on ? 1.2 : 1.68;
  }

  function mirroredLook(roomId: string) {
    if (mirroring && insideId === roomId) return selfLook;
    for (const mesh of walkers.values()) {
      if (mesh.userData.visit === roomId && mesh.userData.pose === "mirror") {
        return {
          color: String(mesh.userData.color || "#d8c3a5"),
          skin: String(mesh.userData.skin || "#f0d0b4"),
          hair: String(mesh.userData.hair || "#4a3b34"),
        };
      }
    }
    return null;
  }

  function sofaTaken() {
    for (const mesh of walkers.values()) {
      if (mesh.userData.visit === insideId && mesh.userData.pose === "sit") return true;
    }
    return false;
  }

  function finishPending() {
    const action = pending;
    pending = null;
    if (!insideId || !action) return;
    if (action === "sit") {
      self.person.position.set(SOFA_X, 0.28, SOFA_Z);
      self.person.rotation.y = -Math.PI / 2;
      setSitting(true);
    } else {
      self.person.position.set(MIRROR_X, 0.12, MIRROR_Z);
      self.person.rotation.y = Math.PI;
      const glass = rooms.get(insideId)?.group.userData.glass as THREE.Mesh | undefined;
      if (glass) glass.userData.until = performance.now() + 2200;
      mirrorUntil = performance.now() + 9000;
      mirroring = true;
      hooks.onMirror();
    }
    moveSent = 0;
    publishMove();
  }

  function exitInterior(notify: boolean) {
    if (!insideId) return;
    const view = rooms.get(insideId);
    const face = Number(view?.group.userData.face) || 0;
    insideId = null;
    hasDest = false;
    pending = null;
    keys.clear();
    setSitting(false);
    scene.attach(self.person);
    if (savedOutdoor !== null) {
      distance = savedOutdoor;
      savedOutdoor = null;
    }
    const stand = view ? exitStand(view) : null;
    if (stand) self.person.position.set(stand.x, 0, stand.z);
    self.person.rotation.y = face;
    yaw = face + Math.PI;
    snapCamera = true;
    moveSent = 0;
    publishMove();
    if (notify) hooks.onExit();
  }

  function stop() {
    hasDest = false;
    keys.clear();
  }

  function clampWalk(x: number, z: number) {
    return {
      x: Math.max(-40, Math.min(40, x)),
      z: Math.max(-40, Math.min(42, z)),
    };
  }

  function useProp(prop: RoomProp) {
    if (!insideId) return;
    if (prop === "cake") {
      hooks.onCake();
      return;
    }
    if (sitting) {
      setSitting(false);
      self.person.position.y = 0.12;
    }
    if (prop === "sofa" && sofaTaken()) {
      hooks.onNote("소파에는 이미 누군가 앉아 있어요.");
      return;
    }
    pending = prop === "sofa" ? "sit" : "mirror";
    const spot = prop === "sofa" ? { x: SOFA_X, z: SOFA_Z } : { x: MIRROR_X, z: MIRROR_Z };
    if (Math.hypot(self.person.position.x - spot.x, self.person.position.z - spot.z) < 0.35) {
      hasDest = false;
      finishPending();
      return;
    }
    dest.set(spot.x, 0, spot.z);
    hasDest = true;
  }

  function walkTo(x: number, z: number) {
    pending = null;
    if (sitting) {
      setSitting(false);
      if (insideId) self.person.position.y = 0.12;
    }
    if (insideId) {
      const next = clampRoom(x, z);
      const near = Math.hypot(next.x - self.person.position.x, next.z - self.person.position.z);
      if (hasDest && near < 0.7) {
        hasDest = false;
        return;
      }
      dest.set(next.x, 0, next.z);
      hasDest = true;
      return;
    }
    const next = clampWalk(x, z);
    const near = Math.hypot(next.x - self.person.position.x, next.z - self.person.position.z);
    if (hasDest && near < 1.6) {
      hasDest = false;
      return;
    }
    dest.set(next.x, 0, next.z);
    hasDest = true;
  }

  function pick(event: PointerEvent): WorldPick | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (insideId) {
      const view = rooms.get(insideId);
      if (!view) return null;
      const hits = raycaster.intersectObject(view.group, true);
      for (const hit of hits) {
        if (hit.object.userData.bounds) continue;
        let node: THREE.Object3D | null = hit.object;
        while (node && node !== view.group) {
          const prop = node.userData.use;
          if (prop === "cake" || prop === "sofa" || prop === "mirror") return { kind: "prop", prop };
          node = node.parent;
        }
      }
      const solid = hits.find((hit) => !hit.object.userData.bounds);
      if (!solid) return null;
      const local = view.group.worldToLocal(solid.point.clone());
      const next = clampRoom(local.x, local.z);
      return { kind: "ground", x: next.x, z: next.z };
    }
    const hits = raycaster.intersectObjects([...rooms.values()].map((view) => view.group), true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (typeof node.userData.roomId === "string") return { kind: "room", id: node.userData.roomId };
        node = node.parent;
      }
    }
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    if (Math.abs(hitPoint.x) > 40 || hitPoint.z < -40 || hitPoint.z > 42) return null;
    return { kind: "ground", x: hitPoint.x, z: hitPoint.z };
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    if (moved > 4) {
      yaw -= dx * 0.0085;
      pitch = insideId
        ? Math.max(0.16, Math.min(0.72, pitch + dy * 0.0065))
        : Math.max(0.12, Math.min(1.15, pitch + dy * 0.0065));
    }
  });
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      distance = insideId
        ? Math.min(4.4, Math.max(1.7, distance + event.deltaY * 0.012))
        : Math.min(13, Math.max(4.2, distance + event.deltaY * 0.014));
    },
    { passive: false },
  );

  function typing(event: Event) {
    const el = event.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  window.addEventListener("keydown", (event) => {
    if (!document.body.classList.contains("in") || typing(event)) return;
    if (event.code === "Space") {
      hasDest = false;
      pending = null;
      event.preventDefault();
      return;
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      keys.add(event.code);
      hasDest = false;
      pending = null;
      if (sitting) {
        setSitting(false);
        if (insideId) self.person.position.y = 0.12;
      }
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("visibilitychange", () => {
    lastTime = performance.now();
    if (document.visibilityState !== "visible") {
      keys.clear();
      return;
    }
    for (const mesh of walkers.values()) mesh.userData.snap = true;
  });

  function animate() {
    frame = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const time = now * 0.001;

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const roomNow = rooms.get(insideId ?? "");
    if (forward !== 0 || strafe !== 0) {
      const span = Math.hypot(forward, strafe) || 1;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const step = (roomNow ? 3.8 : 6.2) * dt;
      const movedX = ((fx * forward + rx * strafe) / span) * step;
      const movedZ = ((fz * forward + rz * strafe) / span) * step;
      if (roomNow) {
        self.person.getWorldPosition(focus);
        const local = worldToLocal(roomNow, focus.x + movedX, focus.z + movedZ);
        if (local.z > ROOM_EXIT_Z) exitInterior(true);
        else {
          const next = clampRoom(local.x, local.z);
          self.person.position.set(next.x, 0.12, next.z);
          self.person.rotation.y = Math.atan2(movedX, movedZ) - roomNow.group.rotation.y;
          publishMove();
        }
      } else {
        const next = clampWalk(self.person.position.x + movedX, self.person.position.z + movedZ);
        self.person.position.x = next.x;
        self.person.position.z = next.z;
        self.person.rotation.y = Math.atan2(movedX, movedZ);
        publishMove();
      }
    } else if (hasDest) {
      const roomDest = rooms.get(insideId ?? "");
      const dx = dest.x - self.person.position.x;
      const dz = dest.z - self.person.position.z;
      const left = Math.hypot(dx, dz);
      if (left < 0.08) {
        hasDest = false;
        finishPending();
      } else {
        const step = Math.min((roomDest ? 3.8 : 6.2) * dt, left);
        self.person.position.x += (dx / left) * step;
        self.person.position.z += (dz / left) * step;
        if (roomDest) self.person.position.y = 0.12;
        self.person.rotation.y = Math.atan2(dx, dz);
        publishMove();
      }
    }
    self.person.visible = true;
    selfPlate.element.style.visibility = "visible";
    const markerRoom = rooms.get(insideId ?? "");
    marker.visible = hasDest;
    if (marker.visible) {
      if (markerRoom) localToWorld(markerRoom, dest.x, dest.z, marker.position);
      else marker.position.set(dest.x, 0, dest.z);
      marker.position.y = markerRoom ? 0.16 : 0.05;
      const pulse = 1 + Math.sin(time * 7) * 0.12;
      marker.scale.set(pulse, 1, pulse);
    }

    self.person.getWorldPosition(focus);
    const px = focus.x;
    const pz = focus.z;
    const indoors = rooms.get(insideId ?? "");
    let camDist = distance;
    if (indoors) {
      for (let step = 0; step < 22; step += 1) {
        const flatTry = Math.cos(pitch) * camDist;
        const local = worldToLocal(indoors, px + Math.sin(yaw) * flatTry, pz + Math.cos(yaw) * flatTry);
        const camY = focus.y + 1.12 + Math.sin(pitch) * camDist;
        const fits =
          Math.abs(local.x) <= 2.35 &&
          local.z <= 2.35 &&
          local.z >= -2.05 &&
          camY >= focus.y + 0.85 &&
          camY <= 2.18;
        if (fits || camDist <= 1.3) break;
        camDist -= 0.18;
      }
    }
    const flat = Math.cos(pitch) * camDist;
    const outdoor = new THREE.Vector3(
      px + Math.sin(yaw) * flat,
      focus.y + 1.12 + Math.sin(pitch) * camDist,
      pz + Math.cos(yaw) * flat,
    );
    const lookFlat = Math.cos(pitch) * 2.2;
    const outdoorLook = new THREE.Vector3(
      px - Math.sin(yaw) * lookFlat,
      focus.y + 1.2,
      pz - Math.cos(yaw) * lookFlat,
    );
    if (indoors && sitting) {
      localToWorld(indoors, 0.55, 1.7, outdoor);
      outdoor.y = 1.5;
      localToWorld(indoors, SOFA_X + 0.35, SOFA_Z, outdoorLook);
      outdoorLook.y = 0.85;
    }
    camFrom.set(px, focus.y + 1.05, pz);
    scene.updateMatrixWorld(true);
    pullCamera(camFrom, outdoor, outdoor);
    const glide = snapCamera ? 1 : 1 - Math.exp(-dt * (dragging ? 26 : indoors ? 16 : 20));
    snapCamera = false;
    camera.position.lerp(outdoor, glide);
    pullCamera(camFrom, camera.position, scratch);
    if (scratch.distanceToSquared(camera.position) > 0.0008) camera.position.copy(scratch);
    look.lerp(outdoorLook, glide);
    camera.lookAt(look);

    const atMirror =
      !!insideId &&
      performance.now() < mirrorUntil &&
      Math.hypot(self.person.position.x - MIRROR_X, self.person.position.z - MIRROR_Z) < 1.2;
    if (atMirror !== mirroring) {
      mirroring = atMirror;
      moveSent = 0;
      publishMove();
    }

    for (const view of rooms.values()) {
      const target = Date.now() < view.bowingUntil ? 1 : 0;
      view.bow += (target - view.bow) * 0.12;
      if (view.upper && view.upper !== view.person) view.upper.rotation.x = view.bow * 0.8;
      const base = Number(view.light.userData.base) || 0.4;
      const flick = 0.92 + Math.sin(time * 9 + view.group.position.x) * 0.08;
      view.light.intensity = base * flick;
      const glass = view.group.userData.glass as THREE.Mesh | undefined;
      if (glass?.material instanceof THREE.MeshStandardMaterial) {
        const until = Number(glass.userData.until) || 0;
        glass.material.emissiveIntensity = performance.now() < until ? 0.75 : 0.12;
        const figure = glass.userData.reflection as THREE.Object3D | undefined;
        const look = mirroredLook(String(view.group.userData.roomId || ""));
        if (figure) {
          figure.visible = !!look;
          const cloth = glass.userData.reflectCloth as THREE.MeshStandardMaterial | undefined;
          const skinMat = glass.userData.reflectSkin as THREE.MeshStandardMaterial | undefined;
          const hairMat = glass.userData.reflectHair as THREE.MeshStandardMaterial | undefined;
          if (look && cloth && skinMat) {
            cloth.color.set(look.color);
            skinMat.color.set(look.skin);
            if (hairMat && look.hair) hairMat.color.set(look.hair);
          }
          if (figure.visible) {
            const base = Number(figure.userData.baseY) || -0.5;
            figure.position.y = base + Math.sin(time * 2.2) * 0.012;
          }
        }
      }
      const near =
        (view.group.position.x - px) ** 2 + (view.group.position.z - pz) ** 2 < 18 * 18;
      view.label.element.style.opacity = insideId ? "0" : near ? "1" : "0";
      if (view.who) {
        const showWho = insideId === view.group.userData.roomId || (!insideId && near);
        view.who.element.style.opacity = showWho ? "1" : "0";
      }
      view.glow.visible = view.beacon.intensity > 0 && insideId !== view.group.userData.roomId;
      for (const flame of view.flames) {
        const phase = Number(flame.userData.phase) || 0;
        const scale = 0.86 + Math.sin(time * 11 + phase) * 0.1;
        const mesh = flame.children[1];
        if (mesh) mesh.scale.set(scale, 1.6 * scale, scale);
      }
    }

    for (const mesh of walkers.values()) {
      const tx = Number(mesh.userData.tx) || 0;
      const tz = Number(mesh.userData.tz) || 0;
      const dx = tx - mesh.position.x;
      const dz = tz - mesh.position.z;
      const gap = Math.hypot(dx, dz);
      const indoorsWalker = Boolean(mesh.userData.visit);
      if (mesh.userData.snap || gap > (indoorsWalker ? 1.2 : 2.8)) {
        mesh.position.x = tx;
        mesh.position.z = tz;
        mesh.userData.snap = false;
      } else if (gap > 0.01) {
        const step = Math.min(gap, (indoorsWalker ? 1.2 : 2.05) * dt);
        mesh.position.x += (dx / gap) * step;
        mesh.position.z += (dz / gap) * step;
      }
      mesh.position.y = Number(mesh.userData.ty) || 0;
      const pose = String(mesh.userData.pose || "stand");
      for (const child of mesh.children) {
        if (child.name === "seat-pose" || child.name === "who-plate") continue;
        child.visible = pose !== "sit";
      }
      const seatPose = mesh.getObjectByName("seat-pose");
      if (seatPose) seatPose.visible = pose === "sit";
      if (pose === "sit") mesh.rotation.y = -Math.PI / 2;
      else if (pose === "mirror") mesh.rotation.y = Math.PI;
      else if (dx * dx + dz * dz > 0.002) mesh.rotation.y = Math.atan2(dx, dz);
      mesh.getWorldPosition(scratch);
      const plate = mesh.getObjectByName("who-plate");
      if (plate instanceof CSS2DObject) {
        plate.position.y = String(mesh.userData.pose || "stand") === "sit" ? 1.2 : 1.68;
        const nearWalker = (scratch.x - px) ** 2 + (scratch.z - pz) ** 2 < 16 * 16;
        const visiting = String(mesh.userData.visit || "");
        const showPlate = visiting ? visiting === insideId || (!insideId && nearWalker) : !insideId && nearWalker;
        plate.element.style.visibility = showPlate ? "visible" : "hidden";
      }
    }

    if (selectedId && !insideId && rooms.get(selectedId)) {
      const group = rooms.get(selectedId)!.group;
      ring.position.set(group.position.x, 0.04, group.position.z);
      ring.visible = true;
    } else ring.visible = false;

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  resize();
  animate();
  window.addEventListener("resize", resize);

  return {
    sync,
    setIdentity(name: string) {
      const label = selfPlate.element.querySelector("span");
      if (label) label.textContent = name;
    },
    setLook(color: string, skin: string, hair: string) {
      selfLook = { color, skin, hair };
      paintPerson(self.person, color, skin, hair);
    },
    pick,
    walkTo,
    useProp,
    stop,
    enterRoom(id: string) {
      const view = rooms.get(id);
      if (!view || insideId === id) return;
      if (insideId) exitInterior(false);
      insideId = id;
      hasDest = false;
      keys.clear();
      if (savedOutdoor === null) savedOutdoor = distance;
      distance = 2.7;
      pitch = 0.4;
      yaw = view.group.rotation.y + 0.28;
      snapCamera = true;
      view.group.attach(self.person);
      self.person.position.set(0, 0.12, -0.05);
      self.person.rotation.y = Math.PI;
      self.person.visible = true;
      selfPlate.element.style.visibility = "visible";
      moveSent = 0;
      publishMove();
    },
    leaveRoom() {
      exitInterior(false);
    },
    isInside() {
      return insideId;
    },
    walkToRoom(id: string) {
      if (insideId) return;
      const door = doorPoint(id);
      if (door) walkTo(door.x, door.z);
    },
    setSelected,
    setAutoRotate(_on: boolean) {},
    destroy() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
