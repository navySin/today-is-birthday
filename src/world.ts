import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { characterFile } from "./characters";
import { loadFigure, type FigureAvatar } from "./figure";
import type { Mood, RoomFacade, RoomLayoutItem, RoomProp, RoomState, Walker, WalkerFigure, WorldPick } from "./types";

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
  plate.center.set(0.5, 1);
  plate.position.set(0, y, 0);
  return plate;
}

const crownPoint = new THREE.Vector3();
const crownBox = new THREE.Box3();

function headBone(figure: THREE.Object3D): THREE.Object3D | null {
  if (figure.userData.headReady) return (figure.userData.headBone as THREE.Object3D | null) ?? null;
  let best: THREE.Object3D | null = null;
  let score = 0;
  figure.traverse((obj) => {
    if (!(obj instanceof THREE.Bone)) return;
    const name = obj.name.toLowerCase();
    if (!name.includes("head")) return;
    if (name.includes("end") || name.includes("top") || name.includes("twist") || name.includes("nub")) return;
    const next = /(^|[:_])head$/.test(name) ? 3 : name.endsWith("head") ? 2 : 1;
    if (next <= score) return;
    best = obj;
    score = next;
  });
  figure.userData.headReady = true;
  figure.userData.headBone = best;
  return best;
}

function crownLocalY(host: THREE.Object3D, figure: THREE.Object3D, fallback: number) {
  const head = headBone(figure);
  if (head) {
    head.getWorldPosition(crownPoint);
    crownPoint.y += 0.3;
    host.worldToLocal(crownPoint);
    return crownPoint.y;
  }
  crownBox.setFromObject(figure);
  if (crownBox.isEmpty()) return fallback;
  crownPoint.set(
    (crownBox.min.x + crownBox.max.x) * 0.5,
    crownBox.max.y + 0.06,
    (crownBox.min.z + crownBox.max.z) * 0.5,
  );
  host.worldToLocal(crownPoint);
  return crownPoint.y;
}

let standingSole = 0;

function dollCrown(sittingPose: boolean, sheet: boolean) {
  if (sheet) return sittingPose ? 1.72 : 2.05;
  return sittingPose ? 1.16 : 1.58 - standingSole;
}

function groundFeet(person: THREE.Group) {
  person.updateMatrixWorld(true);
  const sole = new THREE.Box3().setFromObject(person).min.y;
  if (sole <= 0.001) return;
  const local = sole / Math.max(0.001, person.scale.y);
  for (const child of person.children) child.position.y -= local;
  person.userData.foot = local;
  standingSole = local;
}

const HEAD_SHAPES = ["square", "round", "wide", "tall"] as const;
type HeadShape = (typeof HEAD_SHAPES)[number];
type FaceLook = { shape: HeadShape; eye: number; mouth: number; blush: boolean };

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function faceLook(seed: string): FaceLook {
  if (!seed) return { shape: "square", eye: 0, mouth: 0, blush: false };
  const hash = hashSeed(seed);
  return {
    shape: HEAD_SHAPES[hash % HEAD_SHAPES.length] ?? "square",
    eye: (hash >>> 4) % 3,
    mouth: (hash >>> 8) % 3,
    blush: (hash >>> 12) % 4 === 0,
  };
}

const faceMaps = new Map<string, THREE.CanvasTexture>();

function drawFace(ctx: CanvasRenderingContext2D, look: FaceLook) {
  ctx.clearRect(0, 0, 128, 128);
  const ink = "#241c18";
  const eyeY = look.eye === 1 ? 62 : 56;
  const gap = look.eye === 1 ? 16 : look.eye === 2 ? 28 : 22;
  if (look.blush) {
    ctx.fillStyle = "rgba(214, 112, 112, 0.9)";
    ctx.beginPath();
    ctx.ellipse(36, 78, 8, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(92, 78, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  if (look.eye === 2) {
    ctx.beginPath();
    ctx.arc(64 - gap, eyeY + 4, 10, Math.PI * 1.15, Math.PI * 1.85);
    ctx.arc(64 + gap, eyeY + 4, 10, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (look.eye === 1) {
    ctx.beginPath();
    ctx.arc(64 - gap, eyeY, 5, 0, Math.PI * 2);
    ctx.arc(64 + gap, eyeY, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(64 - gap, eyeY, 8, 11, 0, 0, Math.PI * 2);
    ctx.ellipse(64 + gap, eyeY, 8, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.mouth === 1) {
    ctx.beginPath();
    ctx.moveTo(50, 88);
    ctx.lineTo(78, 88);
    ctx.stroke();
  } else if (look.mouth === 2) {
    ctx.beginPath();
    ctx.ellipse(64, 90, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(64, 72, 20, 0.45, Math.PI - 0.45);
    ctx.stroke();
  }
}

function faceMapFor(look: FaceLook) {
  const key = `${look.shape}:${look.eye}:${look.mouth}:${look.blush ? 1 : 0}`;
  const cached = faceMaps.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("face");
  drawFace(ctx, look);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  faceMaps.set(key, texture);
  return texture;
}

function plainFace() {
  return faceMapFor(faceLook(""));
}

function makeBlockFigure(color: string, skin: string, hair: string, seated: boolean, faceSeed = "") {
  const group = new THREE.Group();
  group.name = "block-figure";
  const torsoMat = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.72), roughness: 0.78 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.58 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.7 });
  const part = (w: number, h: number, d: number, material: THREE.Material, role: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.userData.part = role;
    return mesh;
  };
  const legH = seated ? 0.46 : 0.64;
  const torsoH = seated ? 0.46 : 0.62;
  const torsoW = seated ? 0.56 : 0.62;
  const headS = seated ? 0.5 : 0.58;
  const hip = seated ? 0.38 : legH;
  const hang = (mesh: THREE.Mesh, length: number) => {
    mesh.geometry.translate(0, -length / 2, 0);
    const pivot = new THREE.Group();
    pivot.add(mesh);
    return pivot;
  };
  let limbs: { leftLeg: THREE.Group; rightLeg: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group } | null = null;
  if (!seated) {
    const leftLeg = hang(part(0.24, legH, 0.24, legMat, "block-leg"), legH);
    leftLeg.position.set(-0.15, legH, 0);
    const rightLeg = hang(part(0.24, legH, 0.24, legMat, "block-leg"), legH);
    rightLeg.position.set(0.15, legH, 0);
    group.add(leftLeg, rightLeg);
    limbs = { leftLeg, rightLeg, leftArm: leftLeg, rightArm: rightLeg };
  } else {
    for (const side of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, legH, 0.22), legMat);
      leg.geometry.translate(0, -legH / 2, 0);
      leg.position.set(side, hip, 0.06);
      leg.rotation.x = Math.PI / 2.2;
      leg.userData.part = "block-leg";
      group.add(leg);
    }
  }
  const torso = part(torsoW, torsoH, seated ? 0.3 : 0.34, torsoMat, "block-torso");
  torso.position.y = hip + torsoH / 2;
  group.add(torso);
  const look = faceLook(faceSeed);
  const round = look.shape === "round";
  const headW = look.shape === "wide" ? headS * 1.22 : look.shape === "tall" ? headS * 0.78 : headS;
  const headH = look.shape === "wide" ? headS * 0.86 : look.shape === "tall" ? headS * 1.16 : headS;
  const headD = round ? headS : headS * (look.shape === "square" ? 0.92 : 0.84);
  const headSkin = skinMat.clone();
  const head = round
    ? new THREE.Mesh(new THREE.SphereGeometry(headS / 2, 20, 16), headSkin)
    : part(headW, headH, headD, headSkin, "block-skin");
  head.userData.part = "block-skin";
  head.position.y = hip + torsoH + 0.04 + headH / 2;
  group.add(head);
  const photoHead = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(headW, headH) * 0.5, 36, 28),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 }),
  );
  photoHead.name = "photo-head";
  photoHead.visible = false;
  photoHead.position.y = -headS * 0.14;
  photoHead.raycast = () => undefined;
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(headS * 0.16, headS * 0.22, headS * 0.36, 12),
    skinMat.clone(),
  );
  neck.name = "photo-neck";
  neck.userData.part = "block-skin";
  neck.visible = false;
  neck.position.set(0, -headH / 2 - headS * 0.02, 0);
  head.add(photoHead, neck);
  const faceW = faceSeed ? (round ? headS * 0.72 : headW) : headS;
  const faceH = faceSeed ? (round ? headS * 0.72 : headH) : headS;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(faceW, faceH),
    new THREE.MeshBasicMaterial({
      map: faceMapFor(look),
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.12,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  face.name = "face-decal";
  face.position.set(0, 0, headD / 2 + 0.004);
  face.raycast = () => undefined;
  face.renderOrder = 2;
  head.add(face);
  const hairTop = part(headW * 1.04, headS * 0.22, headS * 0.72, hairMat, "block-hair");
  hairTop.position.set(0, headH / 2 + headS * 0.08, -headS * 0.08);
  const hairBack = part(headW * 1.04, headH * 0.62, headS * 0.18, hairMat, "block-hair");
  hairBack.position.set(0, headH * 0.08, -headD / 2 - 0.02);
  head.add(hairTop, hairBack);
  const armH = seated ? 0.42 : 0.58;
  const armW = seated ? 0.16 : 0.18;
  const armX = torsoW / 2 + armW / 2 + 0.03;
  const shoulderY = hip + torsoH - 0.02;
  const leftArm = hang(part(armW, armH, armW, skinMat, "block-skin"), armH);
  leftArm.position.set(-armX, shoulderY, 0);
  const rightArm = hang(part(armW, armH, armW, skinMat, "block-skin"), armH);
  rightArm.position.set(armX, shoulderY, 0);
  group.add(leftArm, rightArm);
  if (limbs) {
    limbs.leftArm = leftArm;
    limbs.rightArm = rightArm;
    group.userData.limbs = limbs;
  }
  return group;
}

function revealBlock(person: THREE.Group) {
  for (const child of person.children) child.visible = child.name === "block-figure";
}

function makePerson(color: string, skin: string, standing: boolean, hair = "#4a3b34", blockBody = true, faceSeed = "") {
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
    left.userData.part = "eye";
    const right = new THREE.Mesh(eyeGeo, eyeMat);
    right.position.set(0.055, 0.02, 0.15);
    right.userData.part = "eye";
    head.add(left, right);
    person.scale.setScalar(0.82);
    groundFeet(person);
    if (blockBody) {
      person.add(makeBlockFigure(color, skin, hair, false, faceSeed));
      revealBlock(person);
    }
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
  left.userData.part = "eye";
  const right = new THREE.Mesh(eyeGeo, eyeMat);
  right.position.set(0.055, 0.02, 0.15);
  right.userData.part = "eye";
  head.add(left, right);
  person.scale.setScalar(0.82);
  if (blockBody) {
    person.add(makeBlockFigure(color, skin, hair, true, faceSeed));
    revealBlock(person);
  }
  return { person, upper };
  }

let faceTexture: THREE.Texture | null = null;
let faceSphere: THREE.Texture | null = null;
let facePalette: { head: string; hair: string; torso: string; leg: string } | null = null;
let faceToken = 0;
const faceHosts: THREE.Object3D[] = [];

function applyFaceMap(root: THREE.Object3D, sphere: THREE.Texture | null = faceSphere) {
  const photo = Boolean(sphere);
  root.traverse((obj) => {
    if (obj.userData.part === "block-hair") obj.visible = !photo;
    if (obj.name === "photo-neck") obj.visible = photo;
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.name === "photo-head" && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.visible = photo;
      obj.material.map = sphere;
      obj.material.needsUpdate = true;
    }
    if (obj.name === "face-decal" && obj.material instanceof THREE.MeshBasicMaterial) {
      obj.visible = !photo;
      if (!photo) obj.material.map = plainFace();
      obj.material.needsUpdate = true;
    }
    const hidesBox = photo && obj.userData.part === "block-skin" && obj.getObjectByName("photo-head");
    if (hidesBox && obj.material instanceof THREE.MeshStandardMaterial) {
      const saved = obj.material.userData.boxOpacity;
      if (saved == null) obj.material.userData.boxOpacity = obj.material.opacity;
      obj.material.transparent = true;
      obj.material.opacity = 0;
      obj.material.depthWrite = false;
      obj.material.needsUpdate = true;
    } else if (!photo && obj.userData.part === "block-skin" && obj.material instanceof THREE.MeshStandardMaterial && obj.material.userData.boxOpacity != null) {
      obj.material.opacity = Number(obj.material.userData.boxOpacity);
      obj.material.transparent = obj.material.opacity < 1;
      obj.material.depthWrite = obj.material.opacity >= 1;
      obj.material.needsUpdate = true;
    }
  });
}

function paintFaces() {
  for (let index = faceHosts.length - 1; index >= 0; index -= 1) {
    const host = faceHosts[index];
    if (!host.parent) {
      faceHosts.splice(index, 1);
      continue;
    }
    applyFaceMap(host);
  }
}

function roundHeadTexture(face: HTMLCanvasElement, headColor: string, hairColor: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("face");
  ctx.fillStyle = headColor;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = hairColor;
  ctx.fillRect(0, 0, 512, 52);
  const stamp = document.createElement("canvas");
  stamp.width = 512;
  stamp.height = 256;
  const stampCtx = stamp.getContext("2d");
  if (!stampCtx) throw new Error("face");
  stampCtx.drawImage(face, 4, 6, 248, 240);
  stampCtx.globalCompositeOperation = "destination-in";
  const fade = stampCtx.createRadialGradient(128, 142, 64, 128, 142, 142);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.55, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  stampCtx.fillStyle = fade;
  stampCtx.fillRect(0, 0, 256, 256);
  ctx.drawImage(stamp, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function cropFace(image: HTMLImageElement) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const portrait = height > width * 1.15;
  const side = Math.max(1, portrait ? Math.min(width, height * 0.72) : Math.min(width, height));
  const sx = Math.max(0, (width - side) / 2);
  const sy = portrait ? Math.max(0, height * 0.04) : Math.max(0, (height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("face");
  ctx.drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
  const tight = trimFace(knockOutWhite(canvas));
  const palette = readFacePalette(tight);
  const texture = new THREE.CanvasTexture(tight);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, palette, round: roundHeadTexture(tight, palette.head, palette.hair) };
}

function knockOutWhite(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const w = canvas.width;
  const h = canvas.height;
  const corner = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  const bg = {
    r: corners.reduce((sum, item) => sum + item.r, 0) / 4,
    g: corners.reduce((sum, item) => sum + item.g, 0) / 4,
    b: corners.reduce((sum, item) => sum + item.b, 0) / 4,
  };
  let spread = 0;
  for (let i = 0; i < corners.length; i += 1) {
    for (let j = i + 1; j < corners.length; j += 1) spread = Math.max(spread, rgbDist(corners[i], corners[j]));
  }
  if (spread > 34) {
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
  const sat = rgbSat(bg);
  const limit = sat < 24 ? 54 * 54 : 40 * 40;
  const near = (i: number) => {
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    return dr * dr + dg * dg + db * db < limit;
  };
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p] || !near(p * 4)) return;
    seen[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const p = queue[cursor];
    data[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const p = y * w + x;
        const i = p * 4;
        if (data[i + 3] === 0) continue;
        const edge =
          data[((p - 1) * 4) + 3] === 0 ||
          data[((p + 1) * 4) + 3] === 0 ||
          data[((p - w) * 4) + 3] === 0 ||
          data[((p + w) * 4) + 3] === 0;
        if (!edge) continue;
        const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] };
        const light = rgbLum(pixel);
        const close = rgbDist(pixel, bg) < Math.sqrt(limit) + 18;
        const flat = rgbSat(pixel) < 18 && Math.abs(light - rgbLum(bg)) < 36;
        if (close || flat || light > 208) data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function trimFace(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const w = canvas.width;
  const h = canvas.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] < 24) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas;
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = 256;
  out.height = 256;
  const outCtx = out.getContext("2d");
  if (!outCtx) return canvas;
  outCtx.drawImage(canvas, minX, minY, tw, th, 0, 0, 256, 256);
  return out;
}

type Rgb = { r: number; g: number; b: number };
type FacePalette = { head: string; hair: string; shirt: string | null };

function rgbLum(color: Rgb) {
  return (color.r + color.g + color.b) / 3;
}

function rgbSat(color: Rgb) {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}

function rgbDist(a: Rgb, b: Rgb) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function rgbHex(color: Rgb) {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function medianRgb(list: Rgb[]) {
  const fallback = { r: 240, g: 208, b: 180 };
  if (!list.length) return fallback;
  const mid = (key: keyof Rgb) => {
    const sorted = list.map((color) => color[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? fallback[key];
  };
  return { r: mid("r"), g: mid("g"), b: mid("b") };
}

function darkenHex(color: string, amount: number) {
  const value = Number.parseInt(color.slice(1), 16);
  return rgbHex({
    r: ((value >> 16) & 255) * amount,
    g: ((value >> 8) & 255) * amount,
    b: (value & 255) * amount,
  });
}

function readFacePalette(canvas: HTMLCanvasElement): FacePalette {
  const ctx = canvas.getContext("2d");
  const fallback = { head: "#f0d0b4", hair: "#4a3b34", shirt: null };
  if (!ctx) return fallback;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const width = canvas.width;
  const height = canvas.height;
  const top: Rgb[] = [];
  const side: Rgb[] = [];
  const bottom: Rgb[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 40) continue;
      const pixel = { r: data[index], g: data[index + 1], b: data[index + 2] };
      if (y < height * 0.34) top.push(pixel);
      if (y > height * 0.8) bottom.push(pixel);
      if (y > height * 0.3 && y < height * 0.78 && (x < width * 0.24 || x > width * 0.76)) side.push(pixel);
    }
  }
  const lightSide = side.filter((pixel) => rgbLum(pixel) > 145 && rgbSat(pixel) < 48);
  const head = medianRgb(lightSide.length > 8 ? lightSide : side.length ? side : top);
  const hairPool = top.filter((pixel) => rgbSat(pixel) > 26 || rgbLum(pixel) + 28 < rgbLum(head));
  const hair = medianRgb(hairPool.length > 8 ? hairPool : top.length ? top : [head]);
  const shirtPool = bottom.filter((pixel) => rgbDist(pixel, head) > 32);
  const shirt = shirtPool.length > 8 ? rgbHex(medianRgb(shirtPool)) : null;
  return { head: rgbHex(head), hair: rgbHex(hair), shirt };
}

function applyBlockColors(root: THREE.Object3D, colors: { head: string; hair: string; torso: string; leg: string }) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !(obj.material instanceof THREE.MeshStandardMaterial)) return;
    const role = obj.userData.part;
    if (role === "block-skin") obj.material.color.set(colors.head);
    else if (role === "block-hair") obj.material.color.set(colors.hair);
    else if (role === "block-torso") obj.material.color.set(colors.torso);
    else if (role === "block-leg") obj.material.color.set(colors.leg);
  });
}

function paintBlockHosts(colors: { head: string; hair: string; torso: string; leg: string }) {
  for (const host of faceHosts) {
    if (host.parent) applyBlockColors(host, colors);
  }
}

function decodeImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("face"));
    image.src = url;
  });
}

export async function packFaceUrl(url: string): Promise<string> {
  const image = await imageForFace(url);
  let maxEdge = 256;
  while (maxEdge >= 64) {
    const edge = Math.max(image.naturalWidth, image.naturalHeight, 1);
    const scale = Math.min(1, maxEdge / edge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 24000 && quality > 0.38) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (data.length <= 28000) return data;
    maxEdge = Math.round(maxEdge * 0.65);
  }
  if (url.startsWith("https://") && url.length <= 2000) return url;
  return "";
}

async function imageForFace(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return decodeImage(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("face");
  const blob = await res.blob();
  const local = URL.createObjectURL(blob);
  try {
    return await decodeImage(local);
  } finally {
    URL.revokeObjectURL(local);
  }
}

function releaseRemoteFace(mesh: THREE.Object3D) {
  const sphere = mesh.userData.faceSphere as THREE.Texture | undefined;
  const flat = mesh.userData.faceFlat as THREE.Texture | undefined;
  sphere?.dispose();
  flat?.dispose();
  mesh.userData.faceSphere = null;
  mesh.userData.faceFlat = null;
  mesh.userData.faceUrl = "";
  mesh.userData.faceReady = false;
  mesh.userData.facePalette = null;
  if (!mesh.userData.dropped) applyFaceMap(mesh, null);
}

function wearRemoteFace(mesh: THREE.Object3D, url: string | null | undefined) {
  const next = url || "";
  if (mesh.userData.faceUrl === next && (next === "" || mesh.userData.faceReady)) {
    const palette = mesh.userData.facePalette as { head: string; hair: string; torso: string; leg: string } | null;
    const sphere = (mesh.userData.faceSphere as THREE.Texture | null) ?? null;
    if (palette) applyBlockColors(mesh, palette);
    applyFaceMap(mesh, sphere);
    return;
  }
  if (mesh.userData.facePending === next) return;
  mesh.userData.facePending = next;
  if (!next) {
    releaseRemoteFace(mesh);
    mesh.userData.facePending = "";
    return;
  }
  const token = Number(mesh.userData.faceToken || 0) + 1;
  mesh.userData.faceToken = token;
  void (async () => {
    try {
      const image = await imageForFace(next);
      const face = cropFace(image);
      if (mesh.userData.dropped || mesh.userData.faceToken !== token) {
        face.texture.dispose();
        face.round.dispose();
        return;
      }
      releaseRemoteFace(mesh);
      const palette = {
        head: face.palette.head,
        hair: face.palette.hair,
        torso: face.palette.shirt ?? "#d8c3a5",
        leg: face.palette.shirt ? darkenHex(face.palette.shirt, 0.62) : "#b7a48c",
      };
      mesh.userData.faceSphere = face.round;
      mesh.userData.faceFlat = face.texture;
      mesh.userData.facePalette = palette;
      mesh.userData.faceUrl = next;
      mesh.userData.faceReady = true;
      mesh.userData.facePending = "";
      applyBlockColors(mesh, palette);
      applyFaceMap(mesh, face.round);
    } catch {
      if (mesh.userData.faceToken === token) mesh.userData.facePending = "";
    }
  })();
}

function releaseRemote(mesh: THREE.Object3D) {
  const remote = mesh.userData.remote as FigureAvatar | undefined;
  remote?.dispose();
  mesh.userData.remote = null;
}

function figureAddress(figure: WalkerFigure | null | undefined) {
  if (!figure?.body) return "";
  return [figure.body, figure.walk || "", figure.sit || "", figure.bow || ""].join("\n");
}

function wearRemote(mesh: THREE.Object3D, figure: WalkerFigure | null | undefined) {
  const key = figureAddress(figure);
  if (!key) {
    mesh.userData.figurePending = "";
    if (mesh.userData.remote || mesh.userData.figureKey) releaseRemote(mesh);
    mesh.userData.figureKey = "";
    return;
  }
  if (mesh.userData.figureKey === key && mesh.userData.remote) return;
  if (mesh.userData.figurePending === key) return;
  mesh.userData.figurePending = key;
  void loadRemote(mesh, figure as WalkerFigure, key);
}

async function loadRemote(mesh: THREE.Object3D, figure: WalkerFigure, key: string) {
  try {
    const [body, walk, sit, bow] = await Promise.all([
      characterFile(figure.body),
      characterFile(figure.walk),
      characterFile(figure.sit),
      characterFile(figure.bow),
    ]);
    if (!body) throw new Error("missing body");
    const next = await loadFigure({ body, walk, sit, bow });
    if (mesh.userData.dropped || mesh.userData.figurePending !== key) {
      next.dispose();
      return;
    }
    releaseRemote(mesh);
    mesh.add(next.object);
    mesh.userData.remote = next;
    mesh.userData.figureKey = key;
    mesh.userData.figurePending = "";
  } catch {
    if (mesh.userData.figurePending === key) mesh.userData.figurePending = "";
  }
}

function showRemote(mesh: THREE.Object3D, dt: number, mode: "idle" | "walk" | "sit") {
  const remote = mesh.userData.remote as FigureAvatar | undefined;
  if (!remote) return false;
  for (const child of mesh.children) {
    if (child === remote.object || child.name === "who-plate") continue;
    child.visible = false;
  }
  remote.object.visible = true;
  remote.update(dt, mode);
  return true;
}

function dropWalker(mesh: THREE.Object3D) {
  mesh.userData.dropped = true;
  mesh.userData.figurePending = "";
  mesh.userData.facePending = "";
  releaseRemoteFace(mesh);
  releaseRemote(mesh);
  const plate = mesh.getObjectByName("who-plate");
  if (plate instanceof CSS2DObject) plate.element.remove();
  mesh.removeFromParent();
}

function paintPerson(root: THREE.Object3D, color: string, skin: string, hair: string) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !(obj.material instanceof THREE.MeshStandardMaterial)) return;
    if (obj.userData.part === "cloth" || obj.userData.part === "block-torso") obj.material.color.set(color);
    if (obj.userData.part === "block-leg") obj.material.color.set(color).multiplyScalar(0.72);
    if (obj.userData.part === "skin" || obj.userData.part === "block-skin") obj.material.color.set(skin);
    if (obj.userData.part === "hair" || obj.userData.part === "block-hair") obj.material.color.set(hair);
  });
}

function makeCritter(kind: "dog" | "cat", color: string) {
  const pet = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
  const body = new THREE.Group();
  body.name = "critter-body";
  const dog = kind === "dog";
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(dog ? 0.14 : 0.09, dog ? 0.28 : 0.16, 3, 7), fur);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = dog ? 0.28 : 0.2;
  torso.userData.part = "cloth";
  const head = new THREE.Mesh(new THREE.SphereGeometry(dog ? 0.12 : 0.085, 10, 8), fur);
  head.position.set(0, dog ? 0.4 : 0.28, dog ? 0.2 : 0.14);
  head.userData.part = "cloth";
  const earGeo = dog ? new THREE.BoxGeometry(0.05, 0.09, 0.035) : new THREE.ConeGeometry(0.03, 0.08, 5);
  const earL = new THREE.Mesh(earGeo, fur);
  const earR = new THREE.Mesh(earGeo, fur);
  earL.position.set(dog ? -0.05 : -0.035, dog ? 0.08 : 0.06, 0);
  earR.position.set(dog ? 0.05 : 0.035, dog ? 0.08 : 0.06, 0);
  head.add(earL, earR);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.035, 0.01, dog ? 0.1 : 0.07);
  eyeR.position.set(0.035, 0.01, dog ? 0.1 : 0.07);
  head.add(eyeL, eyeR);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, dog ? 0.2 : 0.26, 5), fur);
  tail.name = "tail";
  tail.position.set(0, dog ? 0.34 : 0.24, dog ? -0.22 : -0.16);
  tail.rotation.x = Math.PI / 2.4;
  for (const side of [-1, 1]) {
    for (const front of [0.1, -0.1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, dog ? 0.16 : 0.1, 5), fur);
      leg.position.set(side * (dog ? 0.08 : 0.05), dog ? 0.08 : 0.05, front * (dog ? 1.3 : 1));
      leg.userData.part = "cloth";
      body.add(leg);
    }
  }
  body.add(torso, head, tail);
  pet.add(body);
  pet.userData.kind = kind;
  return pet;
}

function seoulClock() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const minutes = Number(pick("hour")) * 60 + Number(pick("minute"));
  return { key: `${pick("year")}-${pick("month")}-${pick("day")}`, minutes };
}

function rainAmount(key: string, minutes: number) {
  let hash = 0;
  for (const char of key) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const windows = [7 * 60 + (hash % 200), 15 * 60 + ((hash >>> 8) % 180), 21 * 60 + ((hash >>> 16) % 120)];
  let amount = 0;
  for (const start of windows) {
    const dist = Math.abs(minutes - start);
    if (dist > 36) continue;
    const edge = Math.min(dist, 36 - dist, 8) / 8;
    amount = Math.max(amount, edge);
  }
  return amount;
}

const ROOM_S = 1.72;
const ROOM_HALF_X = 3.22 * ROOM_S;
const ROOM_HALF_Z = 3.02 * ROOM_S;
const ROOM_HEIGHT = 2.95 * ROOM_S;
const ROOM_MIN_X = -ROOM_HALF_X + 0.72;
const ROOM_MAX_X = ROOM_HALF_X - 0.72;
const SOFA_X = -ROOM_HALF_X + 0.95;
const SOFA_Z = 0.85;
const MIRROR_X = 2.15;
const MIRROR_Z = -ROOM_HALF_Z + 1.2;
const CAKE_X = -1.45;
const CAKE_Z = -ROOM_HALF_Z + 1.75;
const ROOM_MIN_Z = -ROOM_HALF_Z + 0.78;
const ROOM_MAX_Z = ROOM_HALF_Z - 0.48;
const ROOM_EXIT_Z = ROOM_HALF_Z + 0.22;

type FloorSpot = { x: number; z: number };

function hangMirror(x: number, z: number) {
  const back = Math.abs(z + ROOM_HALF_Z);
  const front = Math.abs(z - ROOM_HALF_Z);
  const left = Math.abs(x + ROOM_HALF_X);
  const right = Math.abs(x - ROOM_HALF_X);
  const nearest = Math.min(back, front, left, right);
  const alongX = Math.max(-ROOM_HALF_X + 0.7, Math.min(ROOM_HALF_X - 0.7, x));
  const alongZ = Math.max(-ROOM_HALF_Z + 0.7, Math.min(ROOM_HALF_Z - 0.7, z));
  if (nearest === left) return { x: -ROOM_HALF_X + 0.18, z: alongZ, yaw: Math.PI / 2 };
  if (nearest === right) return { x: ROOM_HALF_X - 0.18, z: alongZ, yaw: -Math.PI / 2 };
  if (nearest === front) return { x: alongX, z: ROOM_HALF_Z - 0.32, yaw: Math.PI };
  return { x: alongX, z: -ROOM_HALF_Z + 0.18, yaw: 0 };
}

function makeMusicBox() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.34, 0.42),
    new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.48 }),
  );
  body.position.y = 0.5;
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, 0.32, 16),
    new THREE.MeshStandardMaterial({ color: "#4a3b34", roughness: 0.72 }),
  );
  stand.position.y = 0.16;
  const speakerMat = new THREE.MeshStandardMaterial({ color: "#241c18", roughness: 0.42 });
  const left = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 24), speakerMat);
  const right = left.clone();
  left.rotation.x = Math.PI / 2;
  right.rotation.x = Math.PI / 2;
  left.position.set(-0.18, 0.5, 0.22);
  right.position.set(0.18, 0.5, 0.22);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.02, 28),
    new THREE.MeshStandardMaterial({ color: "#16141c", roughness: 0.32, metalness: 0.25 }),
  );
  disc.position.y = 0.68;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.026, 16),
    new THREE.MeshStandardMaterial({ color: "#c45d6e", roughness: 0.4 }),
  );
  label.position.set(0, 0.69, 0);
  group.add(body, stand, left, right, disc, label);
  group.userData.use = "player";
  return group;
}

function youtubePlayBadge() {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.11, 0.012),
    new THREE.MeshStandardMaterial({ color: "#ff0033", roughness: 0.35, emissive: "#ff0033", emissiveIntensity: 0.35 }),
  );
  const play = new THREE.Mesh(
    new THREE.ConeGeometry(0.028, 0.052, 3),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }),
  );
  play.rotation.z = -Math.PI / 2;
  play.position.set(0.006, 0, 0.012);
  group.add(plate, play);
  return group;
}

function makeYtMusic() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.36, 0.36),
    new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.5 }),
  );
  body.position.y = 0.28;
  const badge = youtubePlayBadge();
  badge.position.set(0, 0.3, 0.19);
  group.add(body, badge);
  return group;
}

function makeYtPlaylist() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.38, 0.36),
    new THREE.MeshStandardMaterial({ color: "#f7f4ef", roughness: 0.52 }),
  );
  body.position.y = 0.3;
  const barMat = new THREE.MeshStandardMaterial({ color: "#3a322c", roughness: 0.5 });
  for (const y of [0.38, 0.3, 0.22]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.02), barMat);
    bar.position.set(0.02, y, 0.2);
    group.add(bar);
  }
  const badge = youtubePlayBadge();
  badge.position.set(0, 0.3, 0.22);
  group.add(body, badge);
  return group;
}

function makeYtVideo() {
  const group = new THREE.Group();
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: "#4a3b34", roughness: 0.7 }),
  );
  stand.position.y = 0.14;
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.38, 0.34),
    new THREE.MeshStandardMaterial({ color: "#1c1814", roughness: 0.4 }),
  );
  screen.position.y = 0.42;
  const badge = youtubePlayBadge();
  badge.position.set(0, 0.42, 0.18);
  group.add(stand, screen, badge);
  return group;
}

function makeYtShorts() {
  const group = new THREE.Group();
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 0.08, 10),
    new THREE.MeshStandardMaterial({ color: "#4a3b34", roughness: 0.7 }),
  );
  stand.position.y = 0.04;
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.42, 0.22),
    new THREE.MeshStandardMaterial({ color: "#1c1814", roughness: 0.4 }),
  );
  phone.position.y = 0.32;
  const badge = youtubePlayBadge();
  badge.position.set(0, 0.34, 0.12);
  group.add(stand, phone, badge);
  return group;
}

function makeYoutubeBox(kind: string) {
  if (kind === "yt-playlist") return makeYtPlaylist();
  if (kind === "yt-shorts") return makeYtShorts();
  if (kind === "yt-video") return makeYtVideo();
  return makeYtMusic();
}

function boardLines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      const trial = line + char;
      if (line && ctx.measureText(trial).width > width) {
        lines.push(line);
        line = char;
      } else line = trial;
    }
    lines.push(line);
  }
  return lines.slice(0, 8);
}

function boardTexture(note: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return texture;
  ctx.fillStyle = "#fbfefb";
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = "rgba(176, 196, 184, 0.55)";
  ctx.lineWidth = 2;
  for (let y = 56; y < 310; y += 36) {
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(484, y);
    ctx.stroke();
  }
  const text = note.trim();
  if (text) {
    ctx.fillStyle = "#243028";
    ctx.font = "600 22px \"Pretendard\", \"Malgun Gothic\", sans-serif";
    ctx.textBaseline = "top";
    boardLines(ctx, text, 456).forEach((line, index) => ctx.fillText(line, 28, 22 + index * 36));
  }
  texture.needsUpdate = true;
  return texture;
}

function makeBoard(note: string) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#d5e0d6", roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#8d8478", roughness: 0.72 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.74, 0.045), frameMat);
  board.position.y = 1.08;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 0.64),
    new THREE.MeshBasicMaterial({ map: boardTexture(note), toneMapped: false }),
  );
  face.name = "board-face";
  face.position.set(0, 1.08, 0.026);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.045, 0.09), frameMat);
  tray.position.set(0, 0.68, 0.01);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.68, 0.045), legMat);
  const right = leg.clone();
  leg.position.set(-0.44, 0.34, 0);
  right.position.set(0.44, 0.34, 0);
  group.add(board, face, tray, leg, right);
  group.userData.use = "board";
  return group;
}

const WALK_SPEED = 4.2;
const ROOM_SPEED = 3.5;

function addStage(group: THREE.Group, wide: number) {
  const curtain = roomMat("#6e2430", 0.86);
  const left = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.3, ROOM_HEIGHT * 0.86, 0.08), curtain);
  left.position.set(-wide * 0.3, ROOM_HEIGHT * 0.46, -ROOM_HALF_Z + 0.28);
  const right = left.clone();
  right.position.x = wide * 0.3;
  const valance = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.86, 0.46, 0.1), curtain);
  valance.position.set(0, ROOM_HEIGHT - 0.7, -ROOM_HALF_Z + 0.3);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(wide * 0.7, 0.035, 2.6),
    new THREE.MeshStandardMaterial({ color: "#1c1814", roughness: 0.42 }),
  );
  deck.position.set(0, 0.15, -1.15);
  const lampMat = new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#ffe2a8", emissiveIntensity: 0.85, roughness: 0.35 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.1, 12), lampMat);
  lamp.position.set(-1.35, ROOM_HEIGHT - 0.62, 0.15);
  const lampB = lamp.clone();
  lampB.position.x = 1.35;
  group.add(left, right, valance, deck, lamp, lampB);
}

function addRoof(group: THREE.Group, wide: number) {
  const wire = new THREE.Mesh(new THREE.BoxGeometry(wide - 0.8, 0.02, 0.02), roomMat("#c9b8a4", 0.5));
  wire.position.set(0, 2.2, 0.2);
  const bulbs = new THREE.Group();
  const bulbMat = new THREE.MeshStandardMaterial({ color: "#ffe7a8", emissive: "#ffb15a", emissiveIntensity: 0.95, roughness: 0.4 });
  for (let i = -3; i <= 3; i += 1) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), bulbMat);
    bulb.position.set(i * 0.85, 2.12, 0.2);
    bulbs.add(bulb);
  }
  group.add(wire, bulbs);
}

const DOOR_COLOR: Record<RoomFacade["door"], string> = {
  wood: "#6b4632",
  cream: "#e7d3b4",
  red: "#7a2c32",
  green: "#2f5a45",
  navy: "#2a3a55",
};

const MOOD_DOOR: Record<Mood, RoomFacade["door"]> = {
  cool: "navy",
  lantern: "wood",
  flower: "cream",
  dim: "navy",
  warm: "red",
  moon: "navy",
};

function clipChars(chars: string[], count: number) {
  if (chars.length <= count) return chars.join("");
  return `${chars.slice(0, Math.max(0, count - 1)).join("")}…`;
}

function plateTexture(title: string, note: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return texture;
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, 512, 160);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleChars = Array.from(title.trim() || "방");
  const noteChars = Array.from(note.trim());
  ctx.fillStyle = "#2c241c";
  ctx.font = "700 40px \"Pretendard\", \"Malgun Gothic\", sans-serif";
  if (noteChars.length) {
    ctx.fillText(clipChars(titleChars, 14), 256, 58);
    ctx.fillStyle = "#6d5848";
    ctx.font = "500 26px \"Pretendard\", \"Malgun Gothic\", sans-serif";
    ctx.fillText(clipChars(noteChars, 18), 256, 112);
  } else if (titleChars.length <= 14) {
    ctx.fillText(titleChars.join(""), 256, 84);
  } else {
    ctx.fillText(titleChars.slice(0, 14).join(""), 256, 58);
    ctx.fillText(clipChars(titleChars.slice(14), 14), 256, 112);
  }
  texture.needsUpdate = true;
  return texture;
}

function writeDoorplate(face: THREE.Mesh, title: string, note: string) {
  const material = face.material;
  if (!(material instanceof THREE.MeshBasicMaterial)) return;
  material.map?.dispose();
  material.map = plateTexture(title, note);
  material.needsUpdate = true;
}

function addFrontWindow(group: THREE.Group, x: number, y: number, z: number, wide = 0.92, tall = 0.72) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.1, tall + 0.1, 0.06), roomMat("#e7eef2", 0.4));
  frame.position.set(x, y, z);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(wide, tall, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xc5d6ea, transparent: true, opacity: 0.92 }),
  );
  glass.position.set(x, y, z + 0.03);
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.04, tall, 0.04), roomMat("#f4f7f8", 0.35));
  mullion.position.set(x, y, z + 0.04);
  group.add(frame, glass, mullion);
}

function addSideWindow(group: THREE.Group, side: -1 | 1, y: number) {
  const x = side * (ROOM_HALF_X + 0.12);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 1.15), roomMat("#e7eef2", 0.4));
  frame.position.set(x, y, 0.2);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.74, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xc5d6ea, transparent: true, opacity: 0.92 }),
  );
  glass.position.set(x + side * 0.03, y, 0.2);
  group.add(frame, glass);
}

function addEaveLamps(group: THREE.Group, y: number, z: number) {
  for (const x of [-1.7, 0, 1.7]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), roomMat("#3a2a22", 0.8));
    cord.position.set(x, y + 0.16, z);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, 0.18, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc56b }),
    );
    shade.position.set(x, y, z);
    group.add(cord, shade);
  }
}

function addFlowerBox(group: THREE.Group, x: number, z: number) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.28), roomMat("#6d4a3a", 0.75));
  box.position.set(x, 0.24, z);
  group.add(box);
  [0xd36b84, 0xf0d36b, 0xf4f0ea, 0xc46b7a].forEach((color, index) => {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color }));
    bloom.position.set(x - 0.22 + index * 0.15, 0.42, z);
    group.add(bloom);
  });
}

function addPlantPot(group: THREE.Group, x: number, z: number) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 10), roomMat("#6d4a3a", 0.75));
  pot.position.set(x, 0.2, z);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), roomMat("#3f6b45", 0.7));
  leaf.position.set(x, 0.46, z);
  group.add(pot, leaf);
}

function addPostLamp(group: THREE.Group, x: number, z: number) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.15, 8), roomMat("#3a2a22", 0.75));
  post.position.set(x, 0.62, z);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  globe.position.set(x, 1.28, z);
  group.add(post, globe);
}

function addWreath(group: THREE.Group, y: number, z: number) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.045, 8, 16),
    roomMat("#2f6a45", 0.7),
  );
  ring.position.set(0, y, z);
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc45d6e }));
  bow.position.set(0, y - 0.24, z);
  group.add(ring, bow);
}

function addDoorplate(group: THREE.Group, x: number, y: number, z: number, title: string, note: string) {
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.48, 0.05), roomMat("#d9c7ae", 0.55));
  board.position.set(x, y, z);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.42, 0.36),
    new THREE.MeshBasicMaterial({ map: plateTexture(title, note), toneMapped: false }),
  );
  face.name = "doorplate-face";
  face.position.set(x, y, z + 0.03);
  group.add(board, face);
}

/** Outside face of a room. Interior stays hidden until someone walks in. */
function addYardFace(
  group: THREE.Group,
  mood: Mood,
  shell: "parlor" | "stage" | "roof",
  facade: RoomFacade | undefined,
  title: string,
  note: string,
) {
  const front = ROOM_HALF_Z + 0.2;
  const doorTop = (shell === "roof" ? 0.95 : 2.25) + 0.06;
  if (shell === "stage") {
    const curtain = roomMat("#6e2430", 0.62);
    const leftCurtain = new THREE.Mesh(new THREE.BoxGeometry(1.7, ROOM_HEIGHT - 0.7, 0.08), curtain);
    leftCurtain.position.set(-2.35, (ROOM_HEIGHT - 0.7) / 2 + 0.2, front);
    const rightCurtain = leftCurtain.clone();
    rightCurtain.position.x = 2.35;
    const valance = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF_X * 2 + 0.2, 0.42, 0.1), curtain);
    valance.position.set(0, ROOM_HEIGHT - 0.35, front + 0.02);
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.9), roomMat("#1c1814", 0.7));
    step.position.set(0, 0.08, ROOM_HALF_Z + 0.62);
    group.add(leftCurtain, rightCurtain, valance, step);
    for (let index = 0; index < 7; index += 1) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe7a8 }));
      bulb.position.set(-0.96 + index * 0.32, ROOM_HEIGHT - 0.78, front + 0.08);
      group.add(bulb);
    }
    if (mood === "cool") addSideWindow(group, -1, 2.4);
    if (facade?.window) addSideWindow(group, 1, 2.4);
  } else if (shell === "roof") {
    for (let index = 0; index < 7; index += 1) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), new THREE.MeshBasicMaterial({ color: index % 2 ? 0xffe7a8 : 0xffb15a }));
      bulb.position.set(-2.1 + index * 0.7, 1.72, front);
      group.add(bulb);
    }
    const wire = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.02, 0.02), roomMat("#2a241c", 0.8));
    wire.position.set(0, 1.82, front);
    group.add(wire);
    if (mood === "cool") addFrontWindow(group, -1.7, 0.68, front, 0.7, 0.46);
    if (facade?.window) addFrontWindow(group, 1.7, 0.68, front, 0.7, 0.46);
  } else {
    const eave = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF_X * 2 + 0.3, 0.08, 0.42), roomMat("#3a322c", 0.7));
    eave.position.set(0, ROOM_HEIGHT - 0.02, ROOM_HALF_Z + 0.28);
    group.add(eave);
    if (mood === "cool") addFrontWindow(group, -1.7, 2.55, front);
    if (facade?.window) addFrontWindow(group, 1.7, 2.55, front);
  }

  if (mood === "lantern") addEaveLamps(group, shell === "roof" ? 1.22 : shell === "stage" ? ROOM_HEIGHT - 1.15 : ROOM_HEIGHT - 0.42, front + 0.12);
  if (mood === "flower") addFlowerBox(group, -1.65, front + 0.28);
  if (mood === "dim") {
    const glimmer = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xc4a574 }));
    glimmer.position.set(-1.05, shell === "roof" ? 0.55 : 0.7, front + 0.05);
    group.add(glimmer);
  }
  if (mood === "warm") {
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 18),
      new THREE.MeshBasicMaterial({ color: 0xff8a55, transparent: true, opacity: 0.55 }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.14, ROOM_HALF_Z + 0.7);
    group.add(glow);
  }
  if (mood === "moon") {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf7f4ef }));
    lamp.position.set(shell === "roof" ? 1.35 : 0, shell === "roof" ? 1.55 : ROOM_HEIGHT + 0.32, shell === "roof" ? front : 0.2);
    group.add(lamp);
  }
  if (facade?.accent === "lamp") addPostLamp(group, 1.7, front + 0.45);
  if (facade?.accent === "plant") addPlantPot(group, 1.65, front + 0.4);
  if (facade?.accent === "wreath") addWreath(group, shell === "roof" ? 0.72 : 1.7, front + 0.08);
  addDoorplate(group, 0, shell === "roof" ? 1.22 : doorTop + 0.32, front + 0.08, title, note);
}

function makeRoomShell(
  mood: Mood,
  shell: "parlor" | "stage" | "roof" = "parlor",
  facade?: RoomFacade,
  title = "",
  note = "",
) {
  const look = ROOM_LOOK[mood];
  const group = new THREE.Group();
  const wallMat = roomMat(look.wall, 0.78);
  const backMat = roomMat(look.back, 0.86);
  const wide = ROOM_HALF_X * 2 + 0.16;
  const deep = ROOM_HALF_Z * 2 + 0.16;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(wide, 0.12, deep),
    new THREE.MeshStandardMaterial({ color: shell === "roof" ? "#8d8a86" : shell === "stage" ? "#2a2428" : look.floor, roughness: shell === "stage" ? 0.46 : 0.72 }),
  );
  floor.position.y = 0.06;
  floor.userData.floor = true;
  const interior = new THREE.Group();
  interior.name = "interior";
  interior.visible = false;
  interior.add(floor);
  group.userData.interior = interior;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, ROOM_HEIGHT, deep), wallMat);
  left.position.set(-ROOM_HALF_X, ROOM_HEIGHT / 2 + 0.06, 0);
  const right = left.clone();
  right.position.x = ROOM_HALF_X;
  const back = new THREE.Mesh(new THREE.BoxGeometry(wide, ROOM_HEIGHT, 0.16), backMat);
  back.position.set(0, ROOM_HEIGHT / 2 + 0.06, -ROOM_HALF_Z);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.45, 0.16, deep + 0.4), backMat);
  roof.position.y = ROOM_HEIGHT + 0.14;
  const front = new THREE.Mesh(new THREE.BoxGeometry(wide, ROOM_HEIGHT, 0.16), wallMat);
  front.position.set(0, ROOM_HEIGHT / 2 + 0.06, ROOM_HALF_Z);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 2.25, 0.1),
    roomMat(look.back, 0.62),
  );
  door.position.set(0, 1.24, ROOM_HALF_Z + 0.1);
  if (door.material instanceof THREE.MeshStandardMaterial) {
    door.material.color.set(DOOR_COLOR[facade?.door ?? MOOD_DOOR[mood]]);
  }
  for (const wall of [left, right, back, roof, front]) wall.userData.occlude = true;
  group.add(left, right, back, roof, front, door);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(wide - 0.4, 0.1, 0.14), backMat);
  beam.position.set(0, ROOM_HEIGHT - 0.28, 0.4);
  const beamB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, deep - 0.8), backMat);
  beamB.position.set(0.2, ROOM_HEIGHT - 0.28, 0);
  group.add(beam, beamB);
  if (shell === "roof") {
    roof.visible = false;
    beam.visible = false;
    beamB.visible = false;
    const parapet = 1.15;
    for (const wall of [left, right, back, front]) {
      wall.scale.y = parapet / ROOM_HEIGHT;
      wall.position.y = parapet / 2 + 0.06;
    }
    door.scale.y = 0.95 / 2.25;
    door.position.y = 0.95 / 2 + 0.06;
  }

  if (shell === "parlor") {
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.48, 18),
    new THREE.MeshStandardMaterial({ color: look.back, roughness: 0.8 }),
  );
  table.position.set(CAKE_X, 0.36, CAKE_Z);
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: "#f3e6d4", roughness: 0.5 }),
  );
  plate.position.set(CAKE_X, 0.62, CAKE_Z);
  const cake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.22, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: look.cake, roughness: 0.52 }),
  );
  cake.position.set(CAKE_X, 0.7, CAKE_Z);
  table.userData.use = "cake";
  plate.userData.use = "cake";
  cake.userData.use = "cake";
  table.userData.furniture = "cake";
  plate.userData.furniture = "cake";
  cake.userData.furniture = "cake";
  interior.add(table, plate, cake);
  const sofa = makeSofa(look.sofa);
  const mirror = makeMirror(look.frame);
  group.userData.glass = mirror.userData.glass;
  interior.add(sofa, mirror);
  addRoomProps(interior, mood);
  addLivedIn(interior, mood, look);
  } else if (shell === "stage") {
    addStage(interior, wide);
  } else {
    addRoof(interior, wide);
  }
  group.add(interior);
  addYardFace(group, mood, shell, facade, title, note);

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(wide + 0.5, ROOM_HEIGHT + 0.4, deep + 0.5),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.position.y = ROOM_HEIGHT / 2;
  hit.userData.bounds = true;
  group.add(hit);
  return group;
}

function addLivedIn(
  group: THREE.Group,
  mood: Mood,
  look: { floor: string; wall: string; back: string; sofa: string; frame: string; cake: string },
) {
  const rugColor: Record<Mood, string> = {
    cool: "#c9b8a4",
    lantern: "#c4844e",
    flower: "#e4b7c0",
    dim: "#6d5e52",
    warm: "#b15a38",
    moon: "#d4d7e2",
  };
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 28),
    new THREE.MeshStandardMaterial({ color: rugColor[mood], roughness: 0.95 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.15, 0.125, 0.45);
  group.add(rug);

  const tea = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.4, 0.06, 16),
    roomMat(look.back, 0.72),
  );
  top.position.y = 0.28;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.26, 8), roomMat("#4a3428", 0.8));
  leg.position.y = 0.13;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.07, 10), roomMat(look.cake, 0.45));
  cup.position.set(0.12, 0.35, 0.04);
  const cupB = cup.clone();
  cupB.position.set(-0.1, 0.35, -0.06);
  tea.add(top, leg, cup, cupB);
  tea.position.set(0.55, 0, 1.85);
  group.add(tea);

  const stool = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 12), roomMat(look.sofa, 0.8));
  seat.position.y = 0.36;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 8), roomMat("#4a3428", 0.82));
  post.position.y = 0.16;
  stool.add(seat, post);
  stool.position.set(ROOM_HALF_X - 1.15, 0, 2.35);
  group.add(stool);

  const shelf = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.28), roomMat(look.back, 0.75));
  board.position.y = 1.15;
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), roomMat(look.frame, 0.6));
  book.position.set(-0.28, 1.29, 0);
  const bookB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.1), roomMat(look.sofa, 0.65));
  bookB.position.set(-0.08, 1.27, 0.02);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), roomMat(look.cake, 0.45));
  bowl.scale.y = 0.55;
  bowl.position.set(0.28, 1.22, 0);
  shelf.add(board, book, bookB, bowl);
  shelf.position.set(ROOM_HALF_X - 0.48, 0, -1.15);
  shelf.rotation.y = -Math.PI / 2;
  group.add(shelf);

  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 10), roomMat("#6a5344", 0.8));
  pot.position.set(ROOM_HALF_X - 0.85, 0.2, -ROOM_HALF_Z + 0.85);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), roomMat(mood === "flower" ? "#d36b84" : "#6f8f62", 0.72));
  leaf.position.set(ROOM_HALF_X - 0.85, 0.52, -ROOM_HALF_Z + 0.85);
  group.add(pot, leaf);

  const cushion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.36, 0.08, 16),
    roomMat(look.sofa, 0.9),
  );
  cushion.position.set(-0.85, 0.16, -0.15);
  group.add(cushion);
}

function addRoomProps(group: THREE.Group, mood: Mood) {
  if (mood === "cool") {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 1.72, 0.08),
      roomMat("#d7dee4", 0.4),
    );
    frame.position.set(-0.35, 2.15, -ROOM_HALF_Z + 0.12);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 1.45),
      new THREE.MeshBasicMaterial({ color: 0xb7c9dc, transparent: true, opacity: 0.92 }),
    );
    glass.position.set(-0.35, 2.15, -ROOM_HALF_Z + 0.18);
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.45, 0.03), roomMat("#eef3f6", 0.35));
    mullion.position.set(-0.35, 2.15, -ROOM_HALF_Z + 0.2);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.22), roomMat("#c5ced6", 0.5));
    sill.position.set(-0.35, 1.38, -ROOM_HALF_Z + 0.22);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10),
      roomMat("#6d7c72", 0.7),
    );
    pot.position.set(-1.35, 1.52, -ROOM_HALF_Z + 0.28);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), roomMat("#6f8f62", 0.7));
    leaf.position.set(-1.35, 1.72, -ROOM_HALF_Z + 0.28);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), roomMat("#7d93a8", 0.75));
    chair.position.set(-0.2, 0.36, -ROOM_HALF_Z + 1.15);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), roomMat("#7d93a8", 0.75));
    chairBack.position.set(-0.2, 0.58, -ROOM_HALF_Z + 0.96);
    group.add(frame, glass, mullion, sill, pot, leaf, chair, chairBack);
  }
  if (mood === "lantern") {
    for (const [x, y, z] of [
      [-2.4, 3.15, -0.4],
      [-0.2, 3.45, -1.8],
      [1.7, 3.05, 0.35],
      [2.5, 3.25, -2.2],
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
    post.position.set(-ROOM_HALF_X + 0.7, 0.46, -1.7);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb15a }),
    );
    globe.position.set(-ROOM_HALF_X + 0.7, 0.92, -1.7);
    group.add(post, globe);
  }
  if (mood === "flower") {
    const vase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.24, 12),
      roomMat("#f4f0ea", 0.4),
    );
    vase.position.set(-2.15, 0.28, -ROOM_HALF_Z + 1.15);
    group.add(vase);
    [0xd36b84, 0xf0d36b, 0xe7e2dc, 0xc46b7a].forEach((color, index) => {
      const angle = (index / 4) * Math.PI * 2;
      const x = -2.15 + Math.cos(angle) * 0.05;
      const z = -ROOM_HALF_Z + 1.15 + Math.sin(angle) * 0.05;
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
    rug.position.set(-2.2, 0.13, -0.4);
    group.add(rug);
  }
  if (mood === "dim") {
    const screen = roomMat("#3c3834", 0.92);
    const panelA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.78), screen);
    panelA.position.set(-ROOM_HALF_X + 0.45, 1.05, -1.7);
    panelA.rotation.y = 0.45;
    const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.78), screen);
    panelB.position.set(-ROOM_HALF_X + 0.85, 1.05, -0.95);
    panelB.rotation.y = -0.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10), roomMat("#2a2420", 0.8));
    base.position.set(ROOM_HALF_X - 0.7, 0.16, 1.4);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xc4a574 }),
    );
    lamp.position.set(ROOM_HALF_X - 0.7, 0.32, 1.4);
    group.add(panelA, panelB, base, lamp);
  }
  if (mood === "warm") {
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.78, 0.14),
      roomMat("#2a140e", 0.9),
    );
    mouth.position.set(-2.4, 0.72, -ROOM_HALF_Z + 0.16);
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a3c }),
    );
    fire.scale.set(1.15, 0.7, 0.45);
    fire.position.set(-2.4, 0.48, -ROOM_HALF_Z + 0.24);
    const mantle = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 0.2), roomMat("#6a4034", 0.82));
    mantle.position.set(-2.4, 1.22, -ROOM_HALF_Z + 0.2);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 6), roomMat("#5a3a28", 0.9));
    log.rotation.z = Math.PI / 2;
    log.position.set(-1.55, 0.16, -ROOM_HALF_Z + 0.7);
    const kettle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), roomMat("#3a3a3c", 0.4));
    kettle.position.set(-2.85, 1.36, -ROOM_HALF_Z + 0.32);
    group.add(log, kettle);
    group.add(mouth, fire, mantle);
  }
  if (mood === "moon") {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0xf4f1e8 }),
    );
    disc.position.set(-2.2, 2.7, -ROOM_HALF_Z + 0.12);
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshStandardMaterial({ color: "#d5d8e2", roughness: 0.95 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-1.6, 0.13, -1.4);
    const paper = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xf7f4ef }),
    );
    paper.position.set(1.8, 2.4, -0.6);
    group.add(paper);
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
  group.position.set(-ROOM_HALF_X + 0.42, 0, SOFA_Z);
  group.userData.use = "sofa";
  group.userData.furniture = "sofa";
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
  const made = makePerson("#d8c3a5", "#f0d0b4", true, "#4a3b34", true);
  const figure = made.person;
  figure.name = "reflection";
  figure.scale.setScalar(0.7);
  figure.rotation.y = Math.PI;
  // PickLike hangs an ungrounded doll at y=-0.42. Feet already sit on 0 here,
  // so the same numbers land lower by about the sole height.
  const foot = Number(figure.userData.foot) || 0;
  const y = -0.42 - foot * 0.35;
  figure.position.set(0, y, 0.14);
  figure.userData.baseY = y;
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
  faceHosts.push(figure);
  applyFaceMap(figure);
  group.add(frame, glass, figure);
  group.position.set(MIRROR_X, 1.58, -ROOM_HALF_Z + 0.18);
  group.userData.use = "mirror";
  group.userData.furniture = "mirror";
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
  const yard = new THREE.Group();
  yard.name = "yard";
  scene.add(yard);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);

  const ambient = new THREE.AmbientLight(0xfff1df, 1.15);
  const hemi = new THREE.HemisphereLight(0xffe7c8, 0x8d6b4a, 0.95);
  const sun = new THREE.DirectionalLight(0xffe2c2, 0.72);
  sun.position.set(-8, 16, 10);
  const moonLight = new THREE.DirectionalLight(0xc9d7ef, 0);
  moonLight.position.set(10, 18, -12);
  scene.add(ambient, hemi, sun, moonLight);

  const skyGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe1b0, fog: false }),
  );
  const moonGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.15, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf7f4ea, fog: false }),
  );
  yard.add(skyGlow, moonGlow);
  const starDot = document.createElement("canvas");
  starDot.width = 32;
  starDot.height = 32;
  const starDraw = starDot.getContext("2d");
  if (starDraw) {
    const glow = starDraw.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, "rgba(255,248,230,1)");
    glow.addColorStop(0.35, "rgba(255,244,220,0.75)");
    glow.addColorStop(1, "rgba(255,244,220,0)");
    starDraw.fillStyle = glow;
    starDraw.fillRect(0, 0, 32, 32);
  }
  const starPositions: number[] = [];
  for (let i = 0; i < 48; i += 1) {
    starPositions.push((Math.random() - 0.5) * 56, 8.2 + Math.random() * 2.4, -2 + Math.random() * 34);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3)),
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(starDot),
      color: 0xfff6e4,
      size: 1.15,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      sizeAttenuation: true,
    }),
  );
  yard.add(stars);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xf4f1ea,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    fog: false,
  });
  const cloudGeo = new THREE.SphereGeometry(1.35, 16, 12);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 4; i += 1) {
    const cloud = new THREE.Group();
    for (const [x, y, scale] of [[0, 0, 1], [1.15, 0.12, 0.72], [-1.05, 0.08, 0.68]] as const) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(x, y, 0);
      puff.scale.setScalar(scale);
      cloud.add(puff);
    }
    cloud.position.set(-16 + i * 11, 10.2 + (i % 2) * 0.4, 8 + i * 4);
    cloud.userData.baseX = cloud.position.x;
    cloud.userData.drift = i * 1.7;
    yard.add(cloud);
    clouds.push(cloud);
  }
  const rainCount = 140;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i += 1) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 28;
    rainPositions[i * 3 + 1] = Math.random() * 14;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 28;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.Points(
    rainGeo,
    new THREE.PointsMaterial({ color: 0xd5e4f2, size: 0.07, transparent: true, opacity: 0, depthWrite: false }),
  );
  yard.add(rain);
  const lamps: THREE.PointLight[] = [];
  let skyStamp = 0;
  let skyMinutes = 12 * 60;
  let skyKey = "";
  let skyRain = 0;
  const daySky = new THREE.Color("#5c4b3c");
  const duskSky = new THREE.Color("#8d4e3c");
  const nightSky = new THREE.Color("#141a24");
  const dayFog = new THREE.Color("#5c4b3c");
  const duskFog = new THREE.Color("#6a3d34");
  const nightFog = new THREE.Color("#1a2230");
  const skyMix = new THREE.Color();
  const fogMix = new THREE.Color();

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(62, 80),
    new THREE.MeshStandardMaterial({ color: "#6d5646", roughness: 0.94 }),
  );
  ground.rotation.x = -Math.PI / 2;
  yard.add(ground);

  const pathMat = new THREE.MeshStandardMaterial({ color: "#b08968", roughness: 0.9 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: "#4e6d52", roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6a4b38", roughness: 0.88 });
  const leafMat = new THREE.MeshStandardMaterial({ color: "#5d8158", roughness: 0.86 });
  const poleMat = new THREE.MeshStandardMaterial({ color: "#6d5342", roughness: 0.86 });
  const occluders: THREE.Object3D[] = [];

  function addPath(x: number, z: number, width: number, depth: number) {
    const path = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), pathMat);
    path.position.set(x, 0.025, z);
    yard.add(path);
  }
  function addHedge(x: number, z: number, width: number, depth: number, height = 2.15) {
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), hedgeMat);
    hedge.position.set(x, height / 2, z);
    hedge.userData.occlude = true;
    occluders.push(hedge);
    yard.add(hedge);
  }
  function addTree(x: number, z: number, scale = 1) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 1.15 * scale, 6), trunkMat);
    trunk.position.set(x, 0.55 * scale, z);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.95 * scale, 2.15 * scale, 7), leafMat);
    leaf.position.set(x, 1.85 * scale, z);
    trunk.userData.occlude = true;
    occluders.push(trunk);
    yard.add(trunk, leaf);
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
    yard.add(pole);
    const glow = new THREE.PointLight(0xffc56b, 1.35, 9, 2);
    glow.position.set(x, 1.65, z);
    lamps.push(glow);
    yard.add(glow);
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
  yard.add(gateLeft, gateRight, beam);

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

  const self = makePerson("#d8c3a5", "#f0d0b4", true, "#4a3b34", true);
  const selfSeat = makePerson("#d8c3a5", "#f0d0b4", false, "#4a3b34", true);
  selfSeat.person.name = "seat-pose";
  selfSeat.person.visible = false;
  selfSeat.person.scale.setScalar(1);
  self.person.add(selfSeat.person);
  const selfPlate = makeWhoPlate(true, dollCrown(false, false));
  self.person.add(selfPlate);
  const sheetMat = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  sheetMat.toneMapped = false;
  const sheetFigure = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sheetMat);
  sheetFigure.name = "sheet-figure";
  sheetFigure.visible = false;
  sheetFigure.raycast = () => {};
  self.person.add(sheetFigure);
  let sheetOn = false;
  let sheetSource: HTMLCanvasElement | null = null;
  let sheetMap: THREE.CanvasTexture | null = null;
  let avatar: FigureAvatar | null = null;
  let bowUntil = 0;
  // Reparenting a turned body stores the same yaw as a tilt. Set the whole rotation
  // so later steps do not keep that tilt and face backward.
  function faceYaw(yaw: number) {
    self.person.rotation.set(0, yaw, 0);
  }
  self.person.position.set(0, 0, 34);
  faceYaw(Math.PI);
  scene.add(self.person);
  faceHosts.push(self.person);

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
  let pitch = 0.4;
  let distance = 9.6;
  let selectedId: string | null = null;
  let frame = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const dest = new THREE.Vector3(0, 0, 34);
  const goalMark = new THREE.Vector3(0, 0, 34);
  let route: { x: number; z: number }[] = [];
  let hasDest = false;
  let moveSent = 0;
  let lastTime = performance.now();
  let insideId: string | null = null;
  let live = false;
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
      const cakeSpot = (view.group.userData.spots as { cake?: FloorSpot } | undefined)?.cake ?? { x: CAKE_X, z: CAKE_Z };
      holder.position.set(cakeSpot.x + Math.cos(angle) * radius, 0.78, cakeSpot.z + Math.sin(angle) * radius);
      const wax = new THREE.Mesh(candleGeo, candleMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.scale.set(1, 1.6, 1);
      flame.position.y = 0.12;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 0.11;
      holder.add(wax, flame, core);
      holder.userData.phase = Math.random() * Math.PI * 2;
      holder.userData.use = "cake";
      (view.group.userData.interior as THREE.Group).add(holder);
      view.flames.push(holder);
    }
    view.candleCount = count;
  }

  function roomSpots(roomId: string | null) {
    const spots = roomId
      ? rooms.get(roomId)?.group.userData.spots as { sofa?: FloorSpot; mirror?: FloorSpot; mirrorStand?: FloorSpot } | undefined
      : undefined;
    return {
      sofa: spots?.sofa ?? { x: SOFA_X, z: SOFA_Z },
      mirror: spots?.mirrorStand ?? { x: MIRROR_X, z: MIRROR_Z },
    };
  }

  function placeLayout(group: THREE.Group, layout: RoomLayoutItem[] | undefined) {
    const key = layout?.length ? JSON.stringify(layout) : "";
    if (group.userData.layoutKey === key) return false;
    group.userData.layoutKey = key;
    const interior = group.userData.interior as THREE.Group;
    const previous = interior.getObjectByName("space-extras");
    if (previous) interior.remove(previous);
    if (!layout?.length) {
      delete group.userData.spots;
      return true;
    }
    const find = (kind: string) => layout.find((item) => item.kind === kind);
    const cake = find("cake");
    const sofa = find("sofa");
    const mirror = find("mirror");
    const cakeSpot = cake ? { x: cake.x, z: cake.z } : { x: CAKE_X, z: CAKE_Z };
    const sofaSpot = sofa ? { x: sofa.x, z: sofa.z } : { x: -ROOM_HALF_X + 0.42, z: SOFA_Z };
    const mirrorSpot = mirror ? { x: mirror.x, z: mirror.z } : { x: MIRROR_X, z: -ROOM_HALF_Z + 0.12 };
    interior.traverse((obj) => {
      if (obj.userData.furniture === "cake") {
        obj.position.x = cakeSpot.x;
        obj.position.z = cakeSpot.z;
      }
    });
    const sofaMesh = interior.children.find((obj) => obj.userData.furniture === "sofa");
    if (sofaMesh) sofaMesh.position.set(sofaSpot.x, 0, sofaSpot.z);
    const mirrorMesh = interior.children.find((obj) => obj.userData.furniture === "mirror");
    let mirrorStand = { x: MIRROR_X, z: MIRROR_Z };
    if (mirrorMesh) {
      const hung = hangMirror(mirrorSpot.x, mirrorSpot.z);
      mirrorMesh.position.set(hung.x, 1.62, hung.z);
      mirrorMesh.rotation.y = hung.yaw;
      const dx = -hung.x;
      const dz = -hung.z;
      const len = Math.hypot(dx, dz) || 1;
      mirrorStand = { x: hung.x + (dx / len) * 0.95, z: hung.z + (dz / len) * 0.95 };
    }
    group.userData.spots = {
      cake: cakeSpot,
      sofa: { x: sofaSpot.x + 0.53, z: sofaSpot.z },
      mirrorStand,
    };
    const extras = new THREE.Group();
    extras.name = "space-extras";
    for (const item of layout) {
      if (item.kind === "cake" || item.kind === "sofa" || item.kind === "mirror") continue;
      const board = item.kind === "board";
      const mesh = item.kind === "player" ? makeMusicBox() : board ? makeBoard(item.note ?? "") : makeYoutubeBox(item.kind);
      mesh.userData.use = item.kind === "player" ? "player" : board ? "board" : "screen";
      mesh.userData.layoutId = item.id;
      mesh.position.set(item.x, 0, item.z);
      if (board) mesh.rotation.y = Math.atan2(-item.x, -item.z);
      extras.add(mesh);
    }
    if (extras.children.length) interior.add(extras);
    return true;
  }

  function ensureRoom(room: RoomState) {
    let view = rooms.get(room.id);
    const facadeKey = room.facade ? `${room.facade.door}|${room.facade.window ? 1 : 0}|${room.facade.accent}` : "";
    if (view && (view.group.userData.mood !== room.mood || view.group.userData.shell !== (room.shell || "parlor") || view.group.userData.facade !== facadeKey)) {
      view.label.element.remove();
      view.group.traverse((obj) => {
        const index = occluders.indexOf(obj);
        if (index >= 0) occluders.splice(index, 1);
      });
      scene.remove(view.group);
      rooms.delete(room.id);
      view = undefined;
    }
    if (view) return view;
    const shell = room.shell === "stage" || room.shell === "roof" ? room.shell : "parlor";
    const plateNote = room.occupant?.note ?? "";
    const group = makeRoomShell(room.mood, shell, room.facade, room.title, plateNote);
    group.position.set(room.x, 0, room.z);
    group.rotation.y = room.angle;
    group.userData.face = room.angle;
    group.userData.roomId = room.id;
    group.userData.mood = room.mood;
    group.userData.shell = shell;
    group.userData.facade = facadeKey;
    group.userData.plate = `${room.title}\n${plateNote}`;
    const labelEl = document.createElement("div");
    labelEl.className = "nametag";
    const nameEl = document.createElement("b");
    const countEl = document.createElement("span");
    labelEl.append(nameEl, countEl);
    const label = new CSS2DObject(labelEl);
    label.position.set(0, ROOM_HEIGHT + 0.55, 0);
    group.add(label);
    const light = new THREE.PointLight(MOOD_LIGHT[room.mood], 1.1, 22, 2);
    light.position.set(0, 2.8, -0.2);
    const fill = new THREE.PointLight(ROOM_LOOK[room.mood].fill, 0.9, 20, 2);
    fill.position.set(0, 2.6, 1.4);
    const beacon = new THREE.PointLight(0xffc56b, 0, 18, 1.5);
    beacon.position.set(0, 3.35, 0.4);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe1a8 }),
    );
    glow.position.set(0, 3.55, 0.4);
    glow.visible = false;
    (group.userData.interior as THREE.Group).add(light, fill);
    group.add(beacon, glow);
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
      if (placeLayout(view.group, room.layout)) view.candleCount = -1;
      const nameEl = view.label.element.querySelector("b");
      const countEl = view.label.element.querySelector("span");
      if (nameEl) nameEl.textContent = room.title;
      const plateNote = room.occupant?.note ?? "";
      const plateKey = `${room.title}\n${plateNote}`;
      if (view.group.userData.plate !== plateKey) {
        view.group.userData.plate = plateKey;
        const face = view.group.getObjectByName("doorplate-face");
        if (face instanceof THREE.Mesh) writeDoorplate(face, room.title, plateNote);
      }
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
          dropWalker(view.person);
          view.who = null;
          view.person = null;
          view.upper = null;
        }
      } else if (!view.person) {
        const made = makePerson(seated.color, seated.skin, false, seated.hair || "#4a3b34", true, seated.ownerId || seated.name);
        made.person.position.set(0.2, 0.12, -0.35);
        const plate = makeWhoPlate(false, 1.62);
        const name = plate.element.querySelector("span");
        if (name) name.textContent = seated.name;
        made.person.add(plate);
        view.who = plate;
        (view.group.userData.interior as THREE.Group).add(made.person);
        view.person = made.person;
        view.upper = made.upper;
      } else {
        paintPerson(view.person, seated.color, seated.skin, seated.hair || "#4a3b34");
        const name = view.who?.element.querySelector("span");
        if (name) name.textContent = seated.name;
      }
      if (view.person && seated) {
        const owner = nextWalkers.find((walker) => walker.id === seated.ownerId);
        wearRemote(view.person, owner?.figure);
        wearRemoteFace(view.person, owner?.face);
      }
    }

    const shownWalkers = nextWalkers.filter((walker) => !walker.visitRoomId || rooms.has(walker.visitRoomId));
    const walkerIds = new Set(shownWalkers.map((walker) => walker.id));
    for (const [id, mesh] of walkers) {
      if (walkerIds.has(id)) continue;
      dropWalker(mesh);
      walkers.delete(id);
    }
    for (const walker of shownWalkers) {
      const visit = walker.visitRoomId ? rooms.get(walker.visitRoomId) : null;
      const parent = visit ? (visit.group.userData.interior as THREE.Group) : yard;
      const tx = visit ? walker.visitX : walker.x;
      const tz = visit ? walker.visitZ : walker.z;
      const ty = visit ? 0.12 : 0;
      let mesh = walkers.get(walker.id);
      const kind = walker.kind === "dog" || walker.kind === "cat" ? walker.kind : "person";
      if (mesh && mesh.userData.kind !== kind) {
        dropWalker(mesh);
        walkers.delete(walker.id);
        mesh = undefined;
      }
      if (!mesh) {
        const hair = walker.hair || "#4a3b34";
        if (kind === "person") {
          mesh = makePerson(walker.color || "#8aa0b4", walker.skin || "#e2b48f", true, hair, true, walker.id).person;
          const seatedPose = makePerson(walker.color || "#8aa0b4", walker.skin || "#e2b48f", false, hair, true, walker.id).person;
          seatedPose.name = "seat-pose";
          seatedPose.visible = false;
          seatedPose.scale.setScalar(1);
          mesh.add(seatedPose);
          mesh.add(makeWhoPlate(false, 2.2));
          mesh.userData.kind = "person";
        } else {
          mesh = makeCritter(kind, walker.color || "#d7d2cb");
        }
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
        name.element.style.visibility = kind === "person" ? "visible" : "hidden";
      }
      const previousX = Number(mesh.userData.tx);
      const previousZ = Number(mesh.userData.tz);
      const seenAt = Number(mesh.userData.tAt) || 0;
      if (seenAt && (Math.abs(previousX - tx) > 0.001 || Math.abs(previousZ - tz) > 0.001)) {
        const elapsed = Math.max(0.04, (performance.now() - seenAt) / 1000);
        mesh.userData.vx = (tx - previousX) / elapsed;
        mesh.userData.vz = (tz - previousZ) / elapsed;
        mesh.userData.tAt = performance.now();
      } else if (!seenAt) {
        mesh.userData.vx = 0;
        mesh.userData.vz = 0;
        mesh.userData.tAt = performance.now();
      }
      mesh.userData.tx = tx;
      mesh.userData.tz = tz;
      mesh.userData.ty = walker.pose === "sit" ? 0.28 : ty;
      mesh.userData.visit = walker.visitRoomId ?? "";
      mesh.userData.pose = walker.pose ?? "stand";
      const hair = walker.hair || "#4a3b34";
      if (kind === "person") {
        paintPerson(mesh, walker.color || "#8aa0b4", walker.skin || "#e2b48f", hair);
        wearRemote(mesh, walker.figure);
        wearRemoteFace(mesh, walker.face);
      }
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

  function footprintHas(x: number, z: number, ignoreId: string, pad: number) {
    for (const [roomId, view] of rooms) {
      if (roomId === ignoreId) continue;
      const local = worldToLocal(view, x, z);
      if (Math.abs(local.x) <= ROOM_HALF_X + pad && Math.abs(local.z) <= ROOM_HALF_Z + pad) return true;
    }
    return false;
  }

  function doorPoint(id: string) {
    const view = rooms.get(id);
    if (!view) return null;
    const face = view.group.rotation.y;
    const center = view.group.position;
    const cos = Math.cos(face);
    const sin = Math.sin(face);
    for (let reach = ROOM_HALF_Z + 1.35; reach >= ROOM_HALF_Z + 0.6; reach -= 0.2) {
      for (const side of [0, 1.1, -1.1, 2.2, -2.2]) {
        const x = center.x + side * cos + reach * sin;
        const z = center.z - side * sin + reach * cos;
        const local = worldToLocal(view, x, z);
        if (Math.abs(local.z) <= ROOM_HALF_Z + 0.45) continue;
        if (footprintHas(x, z, id, 0.55)) continue;
        return clampWalk(x, z);
      }
    }
    return clampWalk(
      center.x + Math.sin(face) * (ROOM_HALF_Z + 1.35),
      center.z + Math.cos(face) * (ROOM_HALF_Z + 1.35),
    );
  }

  function exitStand(view: RoomView) {
    const face = view.group.rotation.y;
    const flat = Math.abs(Math.cos(pitch)) * distance;
    const out = Math.min(22, ROOM_HALF_Z + 2.4 + flat);
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

  let moveHold = 0;

  function publishMove(force = false) {
    const now = performance.now();
    if (!force && now - moveSent < 80) {
      if (!moveHold) {
        moveHold = window.setTimeout(() => {
          moveHold = 0;
          publishMove(true);
        }, Math.max(16, 80 - (now - moveSent)));
      }
      return;
    }
    if (moveHold) {
      window.clearTimeout(moveHold);
      moveHold = 0;
    }
    moveSent = now;
    const pose = sitting ? "sit" : mirroring ? "mirror" : "stand";
    if (insideId) hooks.onMove(self.person.position.x, self.person.position.z, insideId, pose);
    else hooks.onMove(self.person.position.x, self.person.position.z, null, "stand");
  }

  function swingLimbs(root: THREE.Object3D, dt: number, moving: boolean) {
    const block = root.getObjectByName("block-figure");
    const limbs = block?.userData.limbs as {
      leftLeg: THREE.Group;
      rightLeg: THREE.Group;
      leftArm: THREE.Group;
      rightArm: THREE.Group;
    } | undefined;
    if (!block?.visible || !limbs) return;
    const phase = Number(root.userData.blockPhase) || 0;
    const next = moving ? phase + dt * 9.5 : phase;
    root.userData.blockPhase = next;
    const swing = moving ? Math.sin(next) * 0.62 : 0;
    const follow = moving ? 1 : Math.min(1, dt * 10);
    const aim = (node: THREE.Group, target: number) => {
      node.rotation.x += (target - node.rotation.x) * follow;
    };
    aim(limbs.leftLeg, swing);
    aim(limbs.rightLeg, -swing);
    aim(limbs.leftArm, -swing);
    aim(limbs.rightArm, swing);
  }

  function showDoll(on: boolean) {
    const doll = on && !avatar;
    for (const child of self.person.children) {
      if (child.name === "seat-pose" || child.name === "who-plate" || child.name === "sheet-figure" || child.name === "figure") continue;
      child.visible = child.name === "block-figure" && doll && !sitting;
    }
    selfSeat.person.visible = doll && sitting;
    for (const child of selfSeat.person.children) child.visible = child.name === "block-figure";
    sheetFigure.visible = sheetOn && !avatar;
    if (avatar) avatar.object.visible = true;
    selfPlate.position.y = avatar
      ? crownLocalY(self.person, avatar.object, dollCrown(sitting, false))
      : doll
        ? (sitting ? 1.62 : 2.2)
        : dollCrown(sitting, sheetOn);
  }

  function setSitting(on: boolean) {
    sitting = on;
    showDoll(!sheetOn);
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
      const face = Number(rooms.get(insideId)?.group.userData.face) || 0;
      const sofa = roomSpots(insideId).sofa;
      self.person.position.set(sofa.x, avatar ? 0.12 : 0.28, sofa.z);
      faceYaw(Math.PI / 2);
      yaw = Math.atan2(-Math.cos(face), Math.sin(face));
      pitch = 0.24;
      snapCamera = true;
      setSitting(true);
    } else {
      const mirror = roomSpots(insideId).mirror;
      self.person.position.set(mirror.x, 0.12, mirror.z);
      faceYaw(Math.PI);
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
    route = [];
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
    faceYaw(face);
    yaw = face + Math.PI;
    snapCamera = true;
    moveSent = 0;
    publishMove();
    if (notify) hooks.onExit();
  }

  function stop() {
    hasDest = false;
    route = [];
    keys.clear();
  }

  function clampWalk(x: number, z: number) {
    return {
      x: Math.max(-40, Math.min(40, x)),
      z: Math.max(-40, Math.min(42, z)),
    };
  }

  function useProp(prop: RoomProp) {
    if (!insideId || prop === "player" || prop === "screen" || prop === "board") return;
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
    const spots = roomSpots(insideId);
    const spot = prop === "sofa" ? spots.sofa : spots.mirror;
    if (Math.hypot(self.person.position.x - spot.x, self.person.position.z - spot.z) < 0.35) {
      hasDest = false;
      finishPending();
      return;
    }
    dest.set(spot.x, 0, spot.z);
    hasDest = true;
  }

  function segmentHitsBox(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    let t0 = 0;
    let t1 = 1;
    const axes: [number, number][] = [
      [-dx, x0 - minX],
      [dx, maxX - x0],
      [-dz, z0 - minZ],
      [dz, maxZ - z0],
    ];
    for (const [p, q] of axes) {
      if (Math.abs(p) < 1e-8) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else if (t < t0) return false;
      else if (t < t1) t1 = t;
    }
    return t0 <= t1;
  }

  function crossesRoom(ax: number, az: number, bx: number, bz: number, pad: number) {
    for (const view of rooms.values()) {
      const a = worldToLocal(view, ax, az);
      const b = worldToLocal(view, bx, bz);
      const hx = ROOM_HALF_X + pad;
      const hz = ROOM_HALF_Z + pad;
      if (segmentHitsBox(a.x, a.z, b.x, b.z, -hx, hx, -hz, hz)) return view;
    }
    return null;
  }

  const cornerScratch = new THREE.Vector3();

  function worldCorner(view: RoomView, lx: number, lz: number) {
    localToWorld(view, lx, lz, cornerScratch);
    return { x: cornerScratch.x, z: cornerScratch.z };
  }

  function leaveFootprint(x: number, z: number) {
    for (const view of rooms.values()) {
      const local = worldToLocal(view, x, z);
      const hx = ROOM_HALF_X + 0.35;
      const hz = ROOM_HALF_Z + 0.35;
      if (Math.abs(local.x) > hx || Math.abs(local.z) > hz) continue;
      const onSide = Math.abs(local.x) / hx > Math.abs(local.z) / hz;
      const spot = onSide
        ? worldCorner(view, Math.sign(local.x || 1) * (ROOM_HALF_X + 1.2), 0)
        : worldCorner(view, 0, Math.sign(local.z || 1) * (ROOM_HALF_Z + 1.2));
      return clampWalk(spot.x, spot.z);
    }
    return null;
  }

  function skirt(view: RoomView, ax: number, az: number, bx: number, bz: number) {
    const start = worldToLocal(view, ax, az);
    const goal = worldToLocal(view, bx, bz);
    const hx = ROOM_HALF_X + 0.8;
    const hz = ROOM_HALF_Z + 0.8;
    const corners = [
      [hx, hz],
      [-hx, hz],
      [hx, -hz],
      [-hx, -hz],
    ] as const;
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;
    for (const [lx, lz] of corners) {
      const corner = worldCorner(view, lx, lz);
      if (crossesRoom(ax, az, corner.x, corner.z, 0.4)) continue;
      const sameSide = Math.sign(lx) === Math.sign(start.x || goal.x) ? 0 : 1.5;
      const score = Math.hypot(ax - corner.x, az - corner.z) + Math.hypot(corner.x - bx, corner.z - bz) + sameSide;
      if (score < bestScore) {
        bestScore = score;
        best = corner;
      }
    }
    if (best) return best;
    let nearest: { x: number; z: number } | null = null;
    let nearestDist = Infinity;
    for (const [lx, lz] of corners) {
      const corner = worldCorner(view, lx, lz);
      const dist = Math.hypot(ax - corner.x, az - corner.z);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = corner;
      }
    }
    return nearest;
  }

  function planRoute(x: number, z: number) {
    const goal = clampWalk(x, z);
    const points: { x: number; z: number }[] = [];
    let sx = self.person.position.x;
    let sz = self.person.position.z;
    const escape = leaveFootprint(sx, sz);
    if (escape) {
      points.push(escape);
      sx = escape.x;
      sz = escape.z;
    }
    for (let guard = 0; guard < 6; guard += 1) {
      const hit = crossesRoom(sx, sz, goal.x, goal.z, 0.35);
      if (!hit) break;
      const via = skirt(hit, sx, sz, goal.x, goal.z);
      if (!via || Math.hypot(via.x - sx, via.z - sz) < 0.2) break;
      points.push(clampWalk(via.x, via.z));
      sx = via.x;
      sz = via.z;
    }
    points.push(goal);
    route = points;
    goalMark.set(goal.x, 0, goal.z);
    const first = route.shift();
    if (!first) {
      hasDest = false;
      return;
    }
    dest.set(first.x, 0, first.z);
    hasDest = true;
  }

  function walkTo(x: number, z: number) {
    pending = null;
    if (sitting) {
      setSitting(false);
      if (insideId) self.person.position.y = 0.12;
    }
    if (insideId) {
      route = [];
      const next = clampRoom(x, z);
      const near = Math.hypot(next.x - self.person.position.x, next.z - self.person.position.z);
      if (hasDest && near < 0.7) {
        hasDest = false;
        return;
      }
      dest.set(next.x, 0, next.z);
      goalMark.copy(dest);
      hasDest = true;
      return;
    }
    const next = clampWalk(x, z);
    const near = Math.hypot(next.x - self.person.position.x, next.z - self.person.position.z);
    if (hasDest && route.length === 0 && near < 1.6) {
      hasDest = false;
      return;
    }
    planRoute(next.x, next.z);
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
          if (prop === "cake" || prop === "sofa" || prop === "mirror" || prop === "player" || prop === "screen" || prop === "board") {
            const id = typeof node.userData.layoutId === "string" ? node.userData.layoutId : undefined;
            return { kind: "prop", prop, ...(id ? { id } : {}) };
          }
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
    if (!live) return;
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
        ? Math.max(-0.42, Math.min(0.62, pitch + dy * 0.0065))
        : Math.max(-0.55, Math.min(1.05, pitch + dy * 0.0065));
    }
  });
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      if (!live) return;
      event.preventDefault();
      distance = insideId
        ? Math.min(7.2, Math.max(3.4, distance + event.deltaY * 0.012))
        : Math.min(14, Math.max(6.6, distance + event.deltaY * 0.014));
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

  function setLive(on: boolean) {
    if (on === live) return;
    live = on;
    dragging = false;
    keys.clear();
    if (!on) {
      cancelAnimationFrame(frame);
      return;
    }
    lastTime = performance.now();
    snapCamera = true;
    for (const mesh of walkers.values()) mesh.userData.snap = true;
    animate();
  }

  function animate() {
    frame = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const time = now * 0.001;
    if (now - skyStamp > 1000) {
      skyStamp = now;
      const clock = seoulClock();
      skyMinutes = clock.minutes;
      skyKey = clock.key;
      skyRain = rainAmount(skyKey, skyMinutes);
    }
    const rise = 7 * 60;
    const set = 17 * 60 + 20;
    const across = (skyMinutes - rise) / (set - rise);
    const elev = across > 0 && across < 1 ? Math.sin(across * Math.PI) : -0.35;
    const night = THREE.MathUtils.smoothstep(-elev, -0.05, 0.45);
    const day = 1 - night;
    const low = elev > 0 && elev < 0.34 ? 1 - elev / 0.34 : 0;
    const sky = skyMix.copy(daySky).lerp(duskSky, low * day).lerp(nightSky, night);
    const fogColor = fogMix.copy(dayFog).lerp(duskFog, low * day).lerp(nightFog, night);
    if (scene.background instanceof THREE.Color) scene.background.copy(sky);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(fogColor);
      scene.fog.density = 0.02 + night * 0.008 + skyRain * 0.008;
    }
    renderer.setClearColor(sky);
    ambient.intensity = 1.15 * day + 0.38 * night;
    ambient.color.set(night > 0.5 ? "#d5def0" : "#fff1df");
    hemi.intensity = 0.95 * day + 0.28 * night;
    hemi.color.set(night > 0.5 ? "#9eb0c8" : low > 0.4 ? "#ffc09a" : "#ffe7c8");
    sun.intensity = Math.max(0, elev) * 0.85 * (1 - skyRain * 0.45);
    sun.color.set(low > 0.45 ? "#ffb07a" : "#ffe2c2");
    const sunAngle = Math.max(0, Math.min(1, across)) * Math.PI;
    skyGlow.position.set(Math.cos(sunAngle) * 22, 7.6 + Math.max(0, elev) * 3.4, 6);
    sun.position.copy(skyGlow.position);
    skyGlow.visible = elev > 0.02;
    const nightMinutes = skyMinutes < rise ? skyMinutes + 1440 : skyMinutes;
    const nightT = (nightMinutes - set) / (rise + 1440 - set);
    const moonElev = Math.sin(Math.max(0, Math.min(1, nightT)) * Math.PI);
    moonGlow.position.set(Math.cos(nightT * Math.PI) * 16, 8.1 + moonElev * 2.2, 8);
    moonLight.position.copy(moonGlow.position);
    moonLight.intensity = night * 0.42;
    moonGlow.visible = night > 0.25;
    (stars.material as THREE.PointsMaterial).opacity = night * 0.9;
    cloudMat.opacity = 0.28 + skyRain * 0.35 + night * 0.08;
    cloudMat.color.set(skyRain > 0.2 ? "#c5ccd4" : night > 0.6 ? "#e4e8ee" : "#f7f3ec");
    yard.visible = !insideId;
    if (yard.visible) {
      for (const cloud of clouds) {
        const drift = Number(cloud.userData.drift) || 0;
        cloud.position.x = Number(cloud.userData.baseX) + Math.sin(time * 0.03 + drift) * 3;
      }
    }
    const showRain = skyRain > 0.04 && yard.visible;
    const rainMat = rain.material as THREE.PointsMaterial;
    rainMat.opacity = showRain ? 0.18 + skyRain * 0.4 : 0;
    if (showRain) {
      rain.position.set(self.person.position.x, 0, self.person.position.z);
      const drop = rainGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rainCount; i += 1) {
        let y = drop.getY(i) - dt * (7 + skyRain * 6);
        if (y < 0.2) {
          drop.setX(i, (Math.random() - 0.5) * 28);
          drop.setZ(i, (Math.random() - 0.5) * 28);
          y = 8 + Math.random() * 7;
        }
        drop.setY(i, y);
      }
      drop.needsUpdate = true;
    }
    for (const glow of lamps) glow.intensity = 1.05 + night * 0.85;

    let stepped = false;
    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const roomNow = rooms.get(insideId ?? "");
    if (forward !== 0 || strafe !== 0) {
      const span = Math.hypot(forward, strafe) || 1;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const step = (roomNow ? ROOM_SPEED : WALK_SPEED) * dt;
      const movedX = ((fx * forward + rx * strafe) / span) * step;
      const movedZ = ((fz * forward + rz * strafe) / span) * step;
      if (roomNow) {
        self.person.getWorldPosition(focus);
        const local = worldToLocal(roomNow, focus.x + movedX, focus.z + movedZ);
        if (local.z > ROOM_EXIT_Z) exitInterior(true);
        else {
          const next = clampRoom(local.x, local.z);
          self.person.position.set(next.x, 0.12, next.z);
          faceYaw(Math.atan2(movedX, movedZ) - roomNow.group.rotation.y);
          publishMove();
          stepped = true;
        }
      } else {
        const next = clampWalk(self.person.position.x + movedX, self.person.position.z + movedZ);
        self.person.position.x = next.x;
        self.person.position.z = next.z;
        faceYaw(Math.atan2(movedX, movedZ));
        publishMove();
        stepped = true;
      }
    } else if (hasDest) {
      const roomDest = rooms.get(insideId ?? "");
      const dx = dest.x - self.person.position.x;
      const dz = dest.z - self.person.position.z;
      const left = Math.hypot(dx, dz);
      if (left < 0.08) {
        const next = route.shift();
        if (next) dest.set(next.x, 0, next.z);
        else {
          hasDest = false;
          finishPending();
        }
      } else {
        const step = Math.min((roomDest ? ROOM_SPEED : WALK_SPEED) * dt, left);
        self.person.position.x += (dx / left) * step;
        self.person.position.z += (dz / left) * step;
        if (roomDest) self.person.position.y = 0.12;
        faceYaw(Math.atan2(dx, dz));
        publishMove();
        stepped = left >= 0.08;
      }
    }
    if (avatar) {
      const bowing = performance.now() < bowUntil;
      const mode = sitting ? "sit" : bowing ? "bow" : stepped ? "walk" : "idle";
      avatar.update(dt, mode);
      selfPlate.position.y = crownLocalY(self.person, avatar.object, dollCrown(sitting, false));
    } else if (!sheetOn) {
      swingLimbs(self.person, dt, stepped && !sitting);
      selfPlate.position.y = sitting ? 1.62 : 2.2;
    } else {
      selfPlate.position.y = dollCrown(sitting, sheetOn);
    }
    self.person.visible = true;
    selfPlate.element.style.visibility = "visible";
    const markerRoom = rooms.get(insideId ?? "");
    marker.visible = hasDest;
    if (marker.visible) {
      if (markerRoom) localToWorld(markerRoom, dest.x, dest.z, marker.position);
      else marker.position.set(goalMark.x, 0, goalMark.z);
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
      for (let step = 0; step < 36; step += 1) {
        const flatTry = Math.cos(pitch) * camDist;
        const local = worldToLocal(indoors, px + Math.sin(yaw) * flatTry, pz + Math.cos(yaw) * flatTry);
        const camY = focus.y + 0.42 + Math.sin(pitch) * camDist;
        const fits =
          Math.abs(local.x) <= ROOM_HALF_X - 0.45 &&
          local.z <= ROOM_HALF_Z - 0.55 &&
          local.z >= -ROOM_HALF_Z + 0.7 &&
          camY <= ROOM_HEIGHT - 0.35;
        if (fits || camDist <= 2.4) break;
        camDist -= 0.18;
      }
    }
    const flat = Math.cos(pitch) * camDist;
    const lift = indoors ? 0.42 : 0.85;
    const outdoor = new THREE.Vector3(
      px + Math.sin(yaw) * flat,
      focus.y + lift + Math.sin(pitch) * camDist,
      pz + Math.cos(yaw) * flat,
    );
    const below = Math.max(0, -pitch);
    const lookFlat = Math.cos(Math.max(pitch, 0)) * (indoors ? 1.7 : 2.2) * (1 - below * 0.75);
    const outdoorLook = new THREE.Vector3(
      px - Math.sin(yaw) * lookFlat,
      focus.y + (indoors ? 0.82 : 1.05) + below * 0.9,
      pz - Math.cos(yaw) * lookFlat,
    );
    if (indoors && sitting) {
      const lookX = -Math.sin(yaw);
      const lookZ = -Math.cos(yaw);
      const sideX = Math.cos(yaw);
      const sideZ = -Math.sin(yaw);
      const tilt = pitch - 0.24;
      outdoor.set(
        px + lookX * 0.62 + sideX * 0.22,
        focus.y + 1.22 + tilt * 0.7,
        pz + lookZ * 0.62 + sideZ * 0.22,
      );
      outdoorLook.set(px + lookX * 4.6, focus.y + 0.72 - tilt * 2.4, pz + lookZ * 4.6);
    }
    const minCamY = 0.42;
    if (outdoor.y < minCamY) {
      const pivotY = focus.y + (indoors ? 0.95 : 1.2);
      const drop = outdoor.y - pivotY;
      const t = drop < -0.001 ? THREE.MathUtils.clamp((minCamY - pivotY) / drop, 0.34, 1) : 1;
      outdoor.x = px + (outdoor.x - px) * t;
      outdoor.z = pz + (outdoor.z - pz) * t;
      outdoor.y = minCamY;
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

    const towardMirror = -Math.cos(self.person.rotation.y);
    const atMirror =
      !!insideId &&
      performance.now() < mirrorUntil &&
      towardMirror > 0.45 &&
      Math.hypot(self.person.position.x - roomSpots(insideId).mirror.x, self.person.position.z - roomSpots(insideId).mirror.z) < 1.2;
    if (atMirror !== mirroring) {
      mirroring = atMirror;
      moveSent = 0;
      publishMove();
    }

    yard.visible = !insideId;
    if (insideId) {
      ambient.intensity = 1.15;
      ambient.color.set("#fff1df");
      hemi.intensity = 0.95;
      hemi.color.set("#ffe7c8");
      sun.intensity = 0.72;
      sun.color.set("#ffe2c2");
      sun.position.set(-8, 16, 10);
      moonLight.intensity = 0;
      if (scene.fog instanceof THREE.FogExp2) scene.fog.color.set("#161014");
    }
    for (const [id, view] of rooms) {
      const here = id === insideId;
      view.group.visible = !insideId || here;
      const interior = view.group.userData.interior as THREE.Object3D | undefined;
      if (interior) interior.visible = here;
    }
    if (scene.fog instanceof THREE.FogExp2) scene.fog.density = insideId ? 0.012 : 0.02 + night * 0.008 + skyRain * 0.008;

    for (const view of rooms.values()) {
      if (!view.group.visible) continue;
      const interiorOn = (view.group.userData.interior as THREE.Object3D | undefined)?.visible === true;
      if (!interiorOn) {
        const near =
          (view.group.position.x - px) ** 2 + (view.group.position.z - pz) ** 2 < 18 * 18;
        view.label.element.style.opacity = near ? "1" : "0";
        view.glow.visible = view.beacon.intensity > 0;
        continue;
      }
      const target = Date.now() < view.bowingUntil ? 1 : 0;
      view.bow += (target - view.bow) * 0.12;
      if (view.person) {
        showRemote(view.person, dt, "sit");
        if (view.who) {
          const seatedFigure = view.person.userData.remote as FigureAvatar | undefined;
          view.who.position.y = seatedFigure
            ? crownLocalY(view.person, seatedFigure.object, dollCrown(true, false))
            : 1.62;
        }
      }
      if (view.upper && view.upper !== view.person && !view.person?.userData.remote) view.upper.rotation.x = view.bow * 0.8;
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
          const mine = Boolean(avatar) && mirroring && insideId === String(view.group.userData.roomId || "");
          const roomId = String(view.group.userData.roomId || "");
          let guestMirror: FigureAvatar | null = null;
          if (!mine) {
            for (const mesh of walkers.values()) {
              const remote = mesh.userData.remote as FigureAvatar | undefined;
              if (remote && mesh.userData.visit === roomId && mesh.userData.pose === "mirror") {
                guestMirror = remote;
                break;
              }
            }
          }
          const host = glass.parent;
          if (guestMirror && host) {
            if (guestMirror.mirror.parent !== host) host.add(guestMirror.mirror);
            guestMirror.mirror.visible = true;
          }
          figure.visible = !!look && !mine && !guestMirror;
          if (avatar) {
            if (mine && look && host) {
              if (avatar.mirror.parent !== host) host.add(avatar.mirror);
              avatar.mirror.visible = true;
            } else if (avatar.mirror.parent === host) {
              avatar.mirror.visible = false;
            }
          }
          const roomKey = String(view.group.userData.roomId || "");
          const photoHere = Boolean(faceTexture && facePalette) && mirroring && insideId === roomKey;
          if (photoHere && facePalette) applyBlockColors(figure, facePalette);
          else if (look) paintPerson(figure, look.color, look.skin, look.hair || "#4a3b34");
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
      if (mesh.parent && !mesh.parent.visible) continue;
      const tx = Number(mesh.userData.tx) || 0;
      const tz = Number(mesh.userData.tz) || 0;
      const dx = tx - mesh.position.x;
      const dz = tz - mesh.position.z;
      const gap = Math.hypot(dx, dz);
      const indoorsWalker = Boolean(mesh.userData.visit);
      if (mesh.userData.snap || gap > 8) {
        mesh.position.x = tx;
        mesh.position.z = tz;
        mesh.userData.snap = false;
      } else if (gap > 0.008) {
        const since = Math.max(0.05, Math.min(0.45, (performance.now() - Number(mesh.userData.tAt || 0)) / 1000));
        const measured = Math.hypot(Number(mesh.userData.vx) || 0, Number(mesh.userData.vz) || 0);
        const pace = measured > 0.3 ? measured : indoorsWalker ? ROOM_SPEED : WALK_SPEED;
        const cushion = Math.max(0.18, pace * since);
        const rate = gap > cushion ? pace * Math.min(1.85, gap / cushion) : pace * (gap / cushion);
        const step = Math.min(gap, rate * dt);
        mesh.position.x += (dx / gap) * step;
        mesh.position.z += (dz / gap) * step;
      }
      mesh.position.y = Number(mesh.userData.ty) || 0;
      const tail = mesh.getObjectByName("tail");
      if (tail) {
        const wag = mesh.userData.kind === "cat" ? 0.25 : 0.42;
        tail.rotation.z = Math.sin(time * (gap > 0.03 ? 9 : 2.2) + mesh.position.x) * wag;
      }
      const critterBody = mesh.getObjectByName("critter-body");
      if (critterBody) {
        critterBody.position.y = gap > 0.03 ? Math.abs(Math.sin(time * 9)) * 0.03 : Math.sin(time * 1.5) * 0.006;
      }
      const pose = String(mesh.userData.pose || "stand");
      const remoteMode = pose === "sit" ? "sit" : gap > 0.03 && pose === "stand" ? "walk" : "idle";
      const worn = showRemote(mesh, dt, remoteMode);
      const remote = mesh.userData.remote as FigureAvatar | undefined;
      if (remote && pose !== "mirror") remote.mirror.visible = false;
      if (!worn) {
        for (const child of mesh.children) {
          if (child.name === "seat-pose" || child.name === "who-plate" || child.name === "figure") continue;
          child.visible = child.name === "block-figure" && pose !== "sit";
        }
        const seatPose = mesh.getObjectByName("seat-pose");
        if (seatPose) seatPose.visible = pose === "sit";
        if (pose !== "sit") swingLimbs(mesh, dt, gap > 0.04);
      }
      if (pose === "sit") mesh.rotation.y = Math.PI / 2;
      else if (pose === "mirror") mesh.rotation.y = Math.PI;
      else if (gap > 0.04) {
        const aim = Math.atan2(dx, dz);
        let turn = aim - mesh.rotation.y;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        mesh.rotation.y += turn * Math.min(1, dt * 10);
      }
      mesh.getWorldPosition(scratch);
      const plate = mesh.getObjectByName("who-plate");
      if (plate instanceof CSS2DObject) {
        const wornFigure = mesh.userData.remote as FigureAvatar | undefined;
        plate.position.y = wornFigure
          ? crownLocalY(mesh, wornFigure.object, dollCrown(pose === "sit", false))
          : pose === "sit"
            ? 1.62
            : 2.2;
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
      paintPerson(selfSeat.person, color, skin, hair);
      if (faceTexture && facePalette) paintBlockHosts(facePalette);
    },
    async setFace(url: string | null) {
      const token = ++faceToken;
      if (!url) {
        faceTexture?.dispose();
        faceTexture = null;
        faceSphere?.dispose();
        faceSphere = null;
        facePalette = null;
        paintFaces();
        paintBlockHosts({
          head: selfLook.skin,
          hair: selfLook.hair,
          torso: selfLook.color,
          leg: darkenHex(selfLook.color, 0.72),
        });
        showDoll(!sheetOn);
        return;
      }
      const face = cropFace(await imageForFace(url));
      if (token !== faceToken) {
        face.texture.dispose();
        face.round.dispose();
        return;
      }
      faceTexture?.dispose();
      faceSphere?.dispose();
      faceTexture = face.texture;
      faceSphere = face.round;
      paintFaces();
      const shirt = face.palette.shirt ?? selfLook.color;
      facePalette = {
        head: face.palette.head,
        hair: face.palette.hair,
        torso: shirt,
        leg: face.palette.shirt ? darkenHex(face.palette.shirt, 0.62) : selfLook.color,
      };
      paintBlockHosts(facePalette);
      showDoll(!sheetOn);
    },
    setFigure(next: FigureAvatar | null) {
      if (avatar === next) {
        showDoll(!sheetOn);
        return;
      }
      if (avatar?.object.parent) avatar.object.removeFromParent();
      if (avatar?.mirror.parent) avatar.mirror.removeFromParent();
      avatar = next;
      if (next) {
        self.person.add(next.object);
        sheetOn = false;
        sheetFigure.visible = false;
      }
      showDoll(!sheetOn);
    },
    playBow() {
      bowUntil = performance.now() + 2800;
    },
    setSheet(source: HTMLCanvasElement | null) {
      if (!source) {
        if (!sheetOn) return;
        sheetOn = false;
        sheetSource = null;
        sheetFigure.visible = false;
        if (sheetMap) {
          sheetMap.dispose();
          sheetMap = null;
          sheetMat.map = null;
        }
        showDoll(true);
        return;
      }
      if (source === sheetSource && sheetOn) {
        showDoll(false);
        return;
      }
      if (sheetMap) sheetMap.dispose();
      sheetMap = new THREE.CanvasTexture(source);
      sheetMap.colorSpace = THREE.SRGBColorSpace;
      sheetMap.needsUpdate = true;
      sheetMat.map = sheetMap;
      sheetMat.needsUpdate = true;
      const localH = 1.62 / 0.82;
      const localW = localH * (source.width / Math.max(1, source.height));
      sheetFigure.scale.set(localW, localH, 1);
      sheetFigure.position.y = localH / 2;
      sheetSource = source;
      sheetOn = true;
      showDoll(false);
    },
    pick,
    walkTo,
    useProp,
    stop,
    enterRoom(id: string) {
      const view = rooms.get(id);
      if (!view || insideId === id) return;
      if (insideId) exitInterior(true);
      insideId = id;
      hasDest = false;
      route = [];
      keys.clear();
      if (savedOutdoor === null) savedOutdoor = distance;
      distance = 5.2;
      pitch = 0.32;
      yaw = view.group.rotation.y + 0.16;
      snapCamera = true;
      view.group.attach(self.person);
      self.person.position.set(0, 0.12, -0.55);
      faceYaw(Math.PI);
      self.person.visible = true;
      selfPlate.element.style.visibility = "visible";
      moveSent = 0;
      publishMove();
    },
    leaveRoom() {
      exitInterior(true);
    },
    beginAgain() {
      if (insideId) {
        insideId = null;
        scene.attach(self.person);
      }
      hasDest = false;
      route = [];
      pending = null;
      keys.clear();
      setSitting(false);
      mirroring = false;
      mirrorUntil = 0;
      savedOutdoor = null;
      self.person.position.set(0, 0, 34);
      faceYaw(Math.PI);
      yaw = 0;
      pitch = 0.4;
      distance = 9.6;
      snapCamera = true;
      moveSent = 0;
      publishMove();
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
    setLive,
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
