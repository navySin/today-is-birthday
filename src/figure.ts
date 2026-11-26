import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export type FigureFiles = {
  body: ArrayBuffer;
  walk: ArrayBuffer | null;
  sit: ArrayBuffer | null;
  bow: ArrayBuffer | null;
};

export type FigureMode = "idle" | "walk" | "sit" | "bow";

export type FigureAvatar = {
  object: THREE.Group;
  /** Same body, posed for the mirror glass. Not parented to the walker. */
  mirror: THREE.Object3D;
  has: { walk: boolean; sit: boolean; bow: boolean };
  update(dt: number, mode: FigureMode): void;
  dispose(): void;
};

const loader = new GLTFLoader();

function parseGltf(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.parse(buffer.slice(0), "", resolve, (error) => reject(error));
  });
}

function nodeNames(root: THREE.Object3D) {
  const names = new Set<string>();
  root.traverse((obj) => {
    if (obj.name) names.add(obj.name);
  });
  return names;
}

function retarget(clip: THREE.AnimationClip, names: Set<string>) {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    if (dot <= 0) continue;
    const node = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const leaf = node.split("/").pop() || node;
    const match = names.has(node) ? node : names.has(leaf) ? leaf : "";
    if (!match) continue;
    const next = track.clone();
    next.name = `${match}.${prop}`;
    tracks.push(next);
  }
  if (tracks.length === 0) return null;
  return new THREE.AnimationClip(clip.name || "clip", clip.duration, tracks);
}

function placeOnFeet(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  const height = Math.max(0.01, box.max.y - box.min.y);
  const scale = 1.65 / height;
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;
  model.updateMatrixWorld(true);
}

function syncBones(source: THREE.Object3D, target: THREE.Object3D) {
  const bones = new Map<string, THREE.Bone>();
  source.traverse((obj) => {
    if (obj instanceof THREE.Bone && obj.name) bones.set(obj.name, obj);
  });
  target.traverse((obj) => {
    if (!(obj instanceof THREE.Bone) || !obj.name) return;
    const from = bones.get(obj.name);
    if (!from) return;
    obj.position.copy(from.position);
    obj.quaternion.copy(from.quaternion);
    obj.scale.copy(from.scale);
  });
}

export async function loadFigure(files: FigureFiles): Promise<FigureAvatar> {
  const body = await parseGltf(files.body);
  const object = new THREE.Group();
  object.name = "figure";
  const model = body.scene;
  object.add(model);
  placeOnFeet(model);
  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
  });
  const names = nodeNames(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<FigureMode, THREE.AnimationAction>();

  const add = (mode: FigureMode, clip: THREE.AnimationClip | null, once: boolean) => {
    if (!clip) return;
    const aimed = retarget(clip, names);
    if (!aimed || aimed.tracks.length === 0) return;
    const action = mixer.clipAction(aimed);
    if (once) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    actions.set(mode, action);
  };

  add("idle", body.animations[0] ?? null, false);
  if (files.walk) add("walk", (await parseGltf(files.walk)).animations[0] ?? null, false);
  if (files.sit) add("sit", (await parseGltf(files.sit)).animations[0] ?? null, false);
  if (files.bow) add("bow", (await parseGltf(files.bow)).animations[0] ?? null, true);

  let current: FigureMode = "idle";
  actions.get("idle")?.play();

  const mirror = cloneSkeleton(object) as THREE.Object3D;
  mirror.name = "figure-reflection";
  mirror.scale.setScalar(0.52);
  mirror.rotation.y = Math.PI;
  mirror.position.set(0, -0.5, 0.14);
  mirror.visible = false;
  mirror.traverse((obj) => {
    obj.raycast = () => undefined;
    if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
  });

  return {
    object,
    mirror,
    has: {
      walk: actions.has("walk"),
      sit: actions.has("sit"),
      bow: actions.has("bow"),
    },
    update(dt, mode) {
      const nextMode = actions.has(mode) ? mode : "idle";
      if (nextMode !== current) {
        const next = actions.get(nextMode);
        const prev = actions.get(current);
        next?.reset().fadeIn(0.18).play();
        prev?.fadeOut(0.18);
        current = nextMode;
      }
      mixer.update(dt);
      syncBones(model, mirror);
    },
    dispose() {
      mixer.stopAllAction();
      mirror.removeFromParent();
      object.removeFromParent();
      model.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          const textured = material as THREE.Material & { map?: THREE.Texture | null };
          textured.map?.dispose();
          material.dispose();
        }
      });
    },
  };
}
