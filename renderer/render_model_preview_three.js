import * as THREE from './vendor/three/three.module.js';
import { FBXLoader } from './vendor/three/addons/loaders/FBXLoader.js';
import { OBJLoader } from './vendor/three/addons/loaders/OBJLoader.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import {
  createLilToonMaterial,
  syncLilToonLightUniforms,
  disposeLilToonMaterial,
} from './render_model_preview_liltoon.js';
import { createPhysBoneRuntime } from './render_physbone_runtime.js';
import { createConstraintRuntime } from './render_constraint_runtime.js';
import { createContactRuntime } from './render_contact_runtime.js';
import { createAvatarFaceRuntime } from './render_avatar_face_runtime.js';
import { createHumanoidRuntime } from './render_humanoid_runtime.js';
import { createUnityAnimationRuntime } from './render_unity_animation_runtime.js';

// 1x1 transparent PNG. Used in place of an unresolved texture URL so FBXLoader's
// own (eager, synchronous-on-parse) texture auto-load never issues a real file://
// fetch — that fetch always 404s here (CSP connect-src blocks file:// anyway, and
// even resolvable paths point at the wrong cwd) and its result is discarded
// regardless, since applyParsedMaterials() always replaces materials afterward
// with GUID-resolved (.mat-derived) textures. This only silences pointless noise;
// it never affects what's actually rendered.
const BLANK_TEXTURE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Revoking while HTMLImageElement is still decoding produces noisy
// blob:file ERR_FILE_NOT_FOUND entries and can leave a texture blank. Local blobs
// normally finish within milliseconds, but large avatar textures need a little room.
const pendingBlobRevokes = new Map();
function revokeBlobUrlAfterDecode(url, delayMs = 5000) {
  if (typeof url !== 'string' || !url.startsWith('blob:') || pendingBlobRevokes.has(url)) return;
  const timer = setTimeout(() => {
    pendingBlobRevokes.delete(url);
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  }, delayMs);
  pendingBlobRevokes.set(url, timer);
}

// Builds a synchronous filename -> blob: URL lookup for every texture already
// fetched via IPC, so THREE's internal Image()-based texture loading never
// needs to hit fetch()/XHR (which the app's CSP connect-src blocks for local
// files). Embedded FBX textures (data:/blob: URLs) already bypass fetch on
// their own; this only matters for externally-referenced texture files.
function buildTextureUrlModifier(textureBlobMap) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data:|blob:)/i.test(url)) return url;
    const base = String(url || '').split('/').pop().split('\\').pop();
    return textureBlobMap.get(base) || textureBlobMap.get(String(url || '').replace(/\\/g, '/')) || BLANK_TEXTURE_DATA_URI;
  });
  return manager;
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    // lilToon ShaderMaterial: dispose dummy 1x1s + uniform-held real maps
    if (mat?.userData?.isLilToonApprox) {
      disposeLilToonMaterial(mat);
      const u = mat.uniforms || {};
      for (const key of Object.keys(u)) {
        const tex = u[key]?.value;
        if (!tex?.isTexture || tex.userData?.isDummy) continue;
        // Do not revoke blob: URLs here — textureBlobMap owns them for the viewer lifetime
        // (multiple materials may share the same blob URL).
        tex.dispose();
      }
      mat.dispose?.();
      continue;
    }
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap']) {
      const tex = mat[key];
      if (!tex?.isTexture) continue;
      // FBXLoader creates its own blob: URLs for binary-embedded texture data
      // (separate from our own textureBlobMap); revoke those here too.
      const src = tex.image?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) {
        revokeBlobUrlAfterDecode(src);
      }
      tex.dispose();
    }
    mat.dispose?.();
  }
}

function disposeObjectSubtree(root) {
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    // Outline hulls share geometry with the parent mesh — only dispose their material.
    if (obj.userData?.isApproxOutline) {
      disposeMaterial(obj.material);
      return;
    }
    obj.geometry?.dispose?.();
    disposeMaterial(obj.material);
  });
}

function disposeScene(scene) {
  disposeObjectSubtree(scene);
}

// Simplified "Modular Avatar"-style outfit fitting: match bones purely by name (no body-shape
// retargeting). Works well when both items share a common naming convention (e.g. the
// MochiFitter-style humanoid names seen on several real packages); degrades gracefully to a
// static bind-pose attachment for bones with no name match, rather than erroring out.
function normalizeBoneName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^mixamorig:?/, '')
    .replace(/[\s_-]+/g, '');
}

function collectSkeletonBones(root) {
  const bones = new Map();
  root.traverse((child) => {
    if (!child.isSkinnedMesh || !child.skeleton) return;
    for (const bone of child.skeleton.bones) {
      const key = normalizeBoneName(bone.name);
      if (key && !bones.has(key)) bones.set(key, bone);
    }
  });
  return bones;
}

/**
 * Reparents `outfitRoot` under `avatarRoot` and, for every SkinnedMesh inside it, swaps each
 * skeleton bone for the avatar's same-named bone where one exists. Unmatched bones (outfit-only
 * decorations, physics bones) keep their own original bone object — they stay static in the
 * outfit's authored bind pose rather than tracking the avatar's current pose, since their parent
 * chain is unchanged. bindMatrix is left as-authored: no body-shape/scale retargeting is
 * attempted, matching the approximate-preview scope agreed for this feature.
 */
function maBoneName(name, mergeArmature) {
  let value = String(name || '');
  const prefix = String(mergeArmature?.prefix || '');
  const suffix = String(mergeArmature?.suffix || '');
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return value;
}

function attachOutfitToAvatar(avatarRoot, outfitRoot, maComponents = []) {
  const avatarBones = collectSkeletonBones(avatarRoot);
  const mergeArmature = (Array.isArray(maComponents) ? maComponents : []).find((row) => row?.type === 'mergeArmature');
  const totalBoneNames = new Set();
  const matchedBoneNames = new Set();
  const coreBoneNames = new Set();
  const matchedCoreBoneNames = new Set();
  const isCoreBone = (key) => /^(?:hips?|pelvis|spine\d*|chest|upperchest|neck|head|leftshoulder|rightshoulder|leftupperarm|rightupperarm|leftlowerarm|rightlowerarm|leftforearm|rightforearm|lefthand|righthand|leftupperleg|rightupperleg|leftlowerleg|rightlowerleg|leftfoot|rightfoot|lefttoes?|righttoes?)$/.test(key);
  outfitRoot.traverse((child) => {
    if (!child.isSkinnedMesh || !child.skeleton) return;
    const newBones = child.skeleton.bones.map((bone) => {
      const boneKey = normalizeBoneName(maBoneName(bone.name, mergeArmature));
      if (boneKey) totalBoneNames.add(boneKey);
      if (boneKey && isCoreBone(boneKey)) coreBoneNames.add(boneKey);
      const avatarBone = avatarBones.get(boneKey);
      if (avatarBone) {
        matchedBoneNames.add(boneKey);
        if (isCoreBone(boneKey)) matchedCoreBoneNames.add(boneKey);
        return avatarBone;
      }
      return bone;
    });
    const newSkeleton = new THREE.Skeleton(newBones, child.skeleton.boneInverses);
    child.bind(newSkeleton, child.bindMatrix);
  });
  outfitRoot.position.set(0, 0, 0);
  outfitRoot.quaternion.identity();
  outfitRoot.scale.set(1, 1, 1);
  avatarRoot.add(outfitRoot);
  const matchedBones = matchedBoneNames.size;
  const totalBones = totalBoneNames.size;
  const matchedCoreBones = matchedCoreBoneNames.size;
  const totalCoreBones = coreBoneNames.size;
  return {
    matchedBones,
    totalBones,
    matchRatio: totalBones > 0 ? matchedBones / totalBones : 0,
    matchedCoreBones,
    totalCoreBones,
    coreMatchRatio: totalCoreBones > 0 ? matchedCoreBones / totalCoreBones : 0,
    modularAvatarPreset: Boolean(mergeArmature),
  };
}

const ORIGINAL_GARMENT_RE = /(?:cloth|costume|outfit|wear|dress|shirt|tops?|jacket|coat|hoodie|pants?|trouser|skirt|shorts?|underwear|inner|bra|socks?|shoes?|boots?|uniform|sailor|服|衣装|上着|スカート|ズボン|下着|靴)/i;
const BODY_PART_RE = /(?:body|base|sotai|素体|face|head|skin|hair|eye|mouth|teeth|tongue|armature|root)/i;

function isInsideObject(node, root) {
  for (let current = node; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

function hideOriginalGarments(avatarRoot, outfitRoot) {
  const changed = [];
  avatarRoot.traverse((node) => {
    if (isInsideObject(node, outfitRoot)) return;
    if ((!node.isMesh && !node.isSkinnedMesh) || node.visible === false || node.userData?.isApproxOutline) return;
    const label = `${node.name || ''} ${node.parent?.name || ''}`;
    if (!ORIGINAL_GARMENT_RE.test(label) || BODY_PART_RE.test(label)) return;
    changed.push({ node, visible: node.visible });
    node.visible = false;
  });
  return changed;
}

function restoreOriginalGarments(changed) {
  for (const row of changed || []) {
    if (row?.node) row.node.visible = row.visible;
  }
}

function applyMaShapeChanges(avatarRoot, maComponents) {
  const changed = [];
  const operations = (Array.isArray(maComponents) ? maComponents : [])
    .filter((row) => row?.type === 'shapeChanger')
    .flatMap((row) => Array.isArray(row.shapes) ? row.shapes : [])
    .filter((row) => row.changeType === 1 && row.shapeName);
  for (const op of operations) {
    const targetName = String(op.objectPath || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
    avatarRoot.traverse((node) => {
      if (!node.morphTargetDictionary || !Array.isArray(node.morphTargetInfluences)) return;
      if (targetName && String(node.name || '').toLowerCase() !== targetName) return;
      const index = node.morphTargetDictionary[op.shapeName];
      if (!Number.isInteger(index)) return;
      changed.push({ node, index, value: node.morphTargetInfluences[index] });
      node.morphTargetInfluences[index] = Number(op.value || 0) / 100;
    });
  }
  return changed;
}

function restoreMaShapeChanges(changed) {
  for (const row of changed || []) {
    if (row?.node && Number.isInteger(row.index)) row.node.morphTargetInfluences[row.index] = row.value;
  }
}

function keepAnimatedSkinnedMeshesRenderable(object) {
  object?.traverse((child) => {
    if (child.isSkinnedMesh) child.frustumCulled = false;
  });
}

function frameCameraToObject(camera, controls, object, precise = false) {
  let box = new THREE.Box3().setFromObject(object, precise);
  let size = box.getSize(new THREE.Vector3());
  let center = box.getCenter(new THREE.Vector3());
  const validFrame = () => !box.isEmpty()
    && size.toArray().every(Number.isFinite)
    && center.toArray().every(Number.isFinite);
  // Precise skinned bounds can become non-finite when an FBX contains invalid
  // skin indices/weights. Never poison the camera with NaN; the regular object
  // bounds are a stable fallback for those assets.
  if (!validFrame() && precise) {
    box = new THREE.Box3().setFromObject(object, false);
    size = box.getSize(new THREE.Vector3());
    center = box.getCenter(new THREE.Vector3());
  }
  if (!validFrame()) return;
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const distance = maxDim * 1.8;
  camera.near = Math.max(maxDim / 1000, 0.01);
  camera.far = maxDim * 100;
  camera.position.set(center.x + distance * 0.6, center.y + distance * 0.4, center.z + distance * 0.6);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function basename(p) {
  return String(p || '').replace(/\\/g, '/').split('/').pop();
}

function toArrayBuffer(bytes) {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  // Electron IPC sometimes yields { type: 'Buffer', data: number[] }
  if (bytes.type === 'Buffer' && Array.isArray(bytes.data)) {
    return Uint8Array.from(bytes.data).buffer;
  }
  if (Array.isArray(bytes)) return Uint8Array.from(bytes).buffer;
  return null;
}

function mimeForRelPath(relPath) {
  const ext = String(relPath || '').toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'tga') return 'image/targa';
  return 'application/octet-stream';
}

async function buildTextureBlobMap(textures, readFile) {
  const map = new Map();
  for (const tex of (textures || [])) {
    try {
      const bytes = await readFile(tex.relPath);
      if (!bytes) continue;
      const ab = toArrayBuffer(bytes);
      if (!ab) continue;
      const blob = new Blob([ab], { type: mimeForRelPath(tex.relPath) });
      const url = URL.createObjectURL(blob);
      const base = basename(tex.relPath);
      map.set(base, url);
      // Also key by full relPath for mat-resolved paths.
      map.set(String(tex.relPath).replace(/\\/g, '/'), url);
    } catch {
      // Non-fatal: this single texture just won't resolve; material falls back to default.
    }
  }
  return map;
}

function loadTextureFromUrl(url, { flipY = true, colorSpace = null, isDataTexture = false } = {}) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        // Unity-exported PNG/JPG used as external maps: flipY=true (three.js default)
        // matches OpenGL UV origin. flipY=false was vertically inverting hair atlases.
        tex.flipY = flipY;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        if (typeof tex.anisotropy === 'number') tex.anisotropy = 8;
        if (colorSpace != null && 'colorSpace' in tex) tex.colorSpace = colorSpace;
        else if (colorSpace != null && 'encoding' in tex) tex.encoding = colorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/** Unity Cull: 0=Off, 1=Front, 2=Back → three.js side */
function cullToSide(cull) {
  const c = Number(cull);
  if (c === 0) return THREE.DoubleSide;
  if (c === 1) return THREE.BackSide;
  return THREE.FrontSide;
}

function colorFromRgba(arr, fallback = 0xffffff) {
  if (!Array.isArray(arr) || arr.length < 3) return new THREE.Color(fallback);
  return new THREE.Color(
    Math.min(1, Math.max(0, Number(arr[0]) || 0)),
    Math.min(1, Math.max(0, Number(arr[1]) || 0)),
    Math.min(1, Math.max(0, Number(arr[2]) || 0))
  );
}

function applyUvTransform(tex, scale, offset) {
  if (!tex) return;
  const sx = Array.isArray(scale) ? Number(scale[0]) : 1;
  const sy = Array.isArray(scale) ? Number(scale[1]) : 1;
  const ox = Array.isArray(offset) ? Number(offset[0]) : 0;
  const oy = Array.isArray(offset) ? Number(offset[1]) : 0;
  if (Number.isFinite(sx) && Number.isFinite(sy)) tex.repeat.set(sx || 1, sy || 1);
  if (Number.isFinite(ox) && Number.isFinite(oy)) tex.offset.set(ox, oy);
}

function resolveTexUrl(textureBlobMap, relPath) {
  if (!relPath) return null;
  const norm = String(relPath).replace(/\\/g, '/');
  return textureBlobMap.get(norm) || textureBlobMap.get(basename(norm)) || null;
}

async function loadMap(textureBlobMap, relPath, opts) {
  const url = resolveTexUrl(textureBlobMap, relPath);
  if (!url) return null;
  return loadTextureFromUrl(url, opts);
}

/**
 * Build a THREE material from parsed .mat data.
 * lilToon (and anything with toon shadow props) → feature-rich toon ShaderMaterial.
 * Others → MeshStandard approximation.
 */
async function buildApproxMaterial(desc, textureBlobMap) {
  const srgb = (THREE.SRGBColorSpace != null) ? THREE.SRGBColorSpace : THREE.sRGBEncoding;
  const family = String(desc.shaderFamily || '');
  // Prefer lilToon path whenever it looks like a toon mat — fidelity is approximate by design.
  const useLilToon = family === 'liltoon'
    || family === 'poiyomi'
    || (Array.isArray(desc.shadowColor) && desc.shadowBorder != null)
    || desc.useRim != null
    || desc.outlineWidth != null;

  if (useLilToon) {
    // External Unity atlas PNGs: flipY=true. (FBX-embedded maps stay false via FBXLoader.)
    const texOpts = { flipY: true, colorSpace: srgb };
    const linearOpts = { flipY: true };
    const [
      main, alpha, emission, normal, main2nd,
      shadow1, shadow2, shadow3, matCap, matCapMask, ao,
    ] = await Promise.all([
      loadMap(textureBlobMap, desc.mainTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.alphaMaskRelPath, linearOpts),
      loadMap(textureBlobMap, desc.emissionMapRelPath, texOpts),
      loadMap(textureBlobMap, desc.normalMapRelPath, linearOpts),
      loadMap(textureBlobMap, desc.main2ndTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.shadowColorTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.shadow2ndColorTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.shadow3rdColorTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.matCapTexRelPath, texOpts),
      loadMap(textureBlobMap, desc.matCapBlendMaskRelPath, linearOpts),
      loadMap(textureBlobMap, desc.aoMapRelPath, linearOpts),
    ]);
    if (main) applyUvTransform(main, desc.mainTexScale, desc.mainTexOffset);
    if (main2nd) applyUvTransform(main2nd, desc.main2ndTexScale, desc.main2ndTexOffset);
    return createLilToonMaterial(desc, {
      main,
      alpha,
      emission,
      normal,
      main2nd,
      shadow1,
      shadow2,
      shadow3,
      matCap,
      matCapMask,
      ao,
    });
  }

  const color = colorFromRgba(desc.color, 0xcccccc);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.04,
    side: cullToSide(desc.cull),
    name: desc.name || 'ApproxMat',
  });

  const mainKey = resolveTexUrl(textureBlobMap, desc.mainTexRelPath);
  if (mainKey) {
    const map = await loadTextureFromUrl(mainKey, { flipY: true, colorSpace: srgb });
    if (map) {
      applyUvTransform(map, desc.mainTexScale, desc.mainTexOffset);
      mat.map = map;
      mat.color.setRGB(color.r, color.g, color.b);
    }
  }

  // lilToon _TransparentMode: 0=Opaque, 1=Cutout, 2=Transparent, 3+=other fade modes.
  // Poiyomi often uses _Mode similarly (0 opaque / 1 cutout / 2 fade / 3 transparent).
  const tMode = Number(desc.transparentMode);
  const cutoff = Number(desc.cutoff);
  const alphaKey = resolveTexUrl(textureBlobMap, desc.alphaMaskRelPath);
  if (alphaKey) {
    const alphaMap = await loadTextureFromUrl(alphaKey, { flipY: true });
    if (alphaMap) {
      mat.alphaMap = alphaMap;
      mat.transparent = true;
      if (tMode >= 2) {
        mat.alphaTest = 0.001;
        mat.depthWrite = false;
      } else {
        mat.alphaTest = Number.isFinite(cutoff) ? Math.min(Math.max(cutoff, 0.001), 0.99) : 0.5;
        mat.depthWrite = true;
      }
    }
  } else if (tMode > 0 || (Number.isFinite(cutoff) && cutoff > 0 && cutoff < 1)) {
    if (mat.map) {
      mat.transparent = true;
      if (tMode >= 2) {
        mat.alphaTest = 0.001;
        mat.depthWrite = false;
      } else {
        mat.alphaTest = Number.isFinite(cutoff) ? Math.min(Math.max(cutoff, 0.001), 0.99) : 0.5;
        mat.depthWrite = true;
      }
    }
  }

  const normalKey = resolveTexUrl(textureBlobMap, desc.normalMapRelPath);
  if (normalKey) {
    const nmap = await loadTextureFromUrl(normalKey, { flipY: true });
    if (nmap) {
      mat.normalMap = nmap;
      mat.normalScale = new THREE.Vector2(1, 1);
    }
  }

  if (Array.isArray(desc.emissionColor)) {
    const e = desc.emissionColor;
    const intensity = Math.max(e[0] || 0, e[1] || 0, e[2] || 0);
    if (intensity > 0.001) {
      mat.emissive = colorFromRgba(e, 0x000000);
      mat.emissiveIntensity = Math.min(intensity * 2, 2);
      const emKey = resolveTexUrl(textureBlobMap, desc.emissionMapRelPath);
      if (emKey) {
        mat.emissiveMap = await loadTextureFromUrl(emKey, { flipY: true, colorSpace: srgb });
      }
    }
  }

  mat.userData.approxFrom = desc.shaderFamily || 'unknown';
  mat.userData.outlineColor = desc.outlineColor;
  mat.userData.outlineWidth = desc.outlineWidth;
  return mat;
}

function meshMaterialNames(child) {
  if (Array.isArray(child.material)) {
    return child.material.map((m) => String(m?.name || '').trim());
  }
  return [String(child.material?.name || '').trim()];
}

function pickMaterialDesc(name, materials, preferredName) {
  if (!materials?.length) return null;
  const byLower = new Map(materials.map((m) => [String(m.name || '').toLowerCase(), m]));
  if (preferredName) {
    const pref = byLower.get(String(preferredName).toLowerCase());
    if (pref) return pref;
  }
  if (name) {
    const hit = byLower.get(String(name).toLowerCase());
    if (hit) return hit;
  }
  // Single material package → apply to everything.
  if (materials.length === 1) return materials[0];
  return null;
}

function removeOutlineChildren(mesh) {
  const toRemove = [];
  for (const child of mesh.children) {
    if (child.userData?.isApproxOutline) toRemove.push(child);
  }
  for (const child of toRemove) {
    mesh.remove(child);
    disposeMaterial(child.material);
    // Don't dispose shared geometry (owned by parent mesh).
  }
  if (mesh.parent) {
    for (const c of mesh.parent.children.slice()) {
      if (c.userData?.isApproxOutline && c.userData?.outlineFor === mesh.uuid) {
        mesh.parent.remove(c);
        disposeMaterial(c.material);
      }
    }
  }
}

/**
 * Inverted-hull outline approximation.
 * IMPORTANT: must be a SIBLING of SkinnedMesh (not a child) — parenting under the
 * skinned mesh double-applies the root transform and looks wildly wrong.
 */
function attachOutlineHull(mesh, outlineColorRgba, outlineWidth) {
  removeOutlineChildren(mesh);
  // Also remove sibling outlines previously parented next to this mesh
  if (mesh.parent) {
    const siblings = mesh.parent.children.slice();
    for (const c of siblings) {
      if (c.userData?.isApproxOutline && c.userData?.outlineFor === mesh.uuid) {
        mesh.parent.remove(c);
        disposeMaterial(c.material);
      }
    }
  }

  const w = Number(outlineWidth);
  if (!Number.isFinite(w) || w <= 0) return;
  if (!Array.isArray(outlineColorRgba)) return;

  // Scale extrusion relative to mesh size so hair (small) and body (large) both look sane.
  let size = 1;
  try {
    const box = new THREE.Box3().setFromObject(mesh);
    const s = box.getSize(new THREE.Vector3());
    size = Math.max(s.x, s.y, s.z) || 1;
  } catch {
    size = 1;
  }
  // lilToon _OutlineWidth ~0.01–0.08 → a few % of mesh extent, hard-capped.
  const extrude = Math.min(Math.max(w * size * 0.15, size * 0.002), size * 0.02);

  const color = colorFromRgba(outlineColorRgba, 0x000000);
  const outlineMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    depthWrite: true,
  });
  outlineMat.onBeforeCompile = (shader) => {
    shader.uniforms.outlineExtrude = { value: extrude };
    shader.vertexShader = `uniform float outlineExtrude;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'transformed += normalize( objectNormal ) * outlineExtrude;',
      ].join('\n')
    );
  };
  outlineMat.userData.outlineExtrude = extrude;

  let outline;
  if (mesh.isSkinnedMesh) {
    outline = new THREE.SkinnedMesh(mesh.geometry, outlineMat);
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.bindMode = mesh.bindMode;
  } else {
    outline = new THREE.Mesh(mesh.geometry, outlineMat);
  }
  outline.userData.isApproxOutline = true;
  outline.userData.outlineFor = mesh.uuid;
  outline.renderOrder = (mesh.renderOrder || 0) - 1;
  outline.frustumCulled = mesh.frustumCulled;
  // Match local TRS; for skinned meshes bones drive deformation so identity local is fine.
  outline.position.copy(mesh.position);
  outline.quaternion.copy(mesh.quaternion);
  outline.scale.copy(mesh.scale);

  if (mesh.parent) {
    mesh.parent.add(outline);
  } else {
    mesh.add(outline);
  }
}

function isUsableTextureMap(map) {
  if (!map) return false;
  // The 1x1 BLANK_TEXTURE_DATA_URI stand-in (see its definition above) is only meant to
  // silence FBXLoader's own eager texture fetch when a package HAS real .mat-derived
  // textures to apply afterward. When a package has none at all (materials.length === 0,
  // e.g. a mesh-only .unitypackage whose real materials live in a separate companion
  // package), applyParsedMaterials() short-circuits straight to this fallback without ever
  // overwriting it — so this placeholder can end up as the actually-rendered map. Treat it
  // as "no texture", not "has a texture". Only meaningful once the image has actually
  // finished loading (see waitForTextureImages) — right after FBXLoader.parse() the Texture
  // exists but its underlying <img>.src hasn't been assigned yet.
  const src = map.image?.src;
  if (typeof src === 'string' && src.startsWith(BLANK_TEXTURE_DATA_URI)) return false;
  return true;
}

// FBXLoader's texture loading goes through the LoadingManager we hand it, which calls
// itemStart()/itemEnd() for each one — manager.onLoad is THREE's own built-in "all pending
// loads for this manager finished" signal, and is the reliable way to know when a Texture's
// underlying <img>.src has actually been assigned and resolved. (Image.complete is not
// reliable for this: it's also true for an <img> that has no src yet at all, i.e. one whose
// load hasn't even started — checking it right after parse() would report "done" too early.)
function waitForManagerLoad(manager, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    manager.onLoad = finish;
    manager.onError = () => { /* isUsableTextureMap() below decides based on the result */ };
    setTimeout(finish, timeoutMs);
  });
}

async function applyFallbackMaterial(object, manager) {
  if (manager) await waitForManagerLoad(manager);
  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    if (child.userData?.isApproxOutline) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const hasUsableMaterial = mats.some((m) => isUsableTextureMap(m?.map));
    if (hasUsableMaterial) return;
    // A map that resolved to our own blank placeholder is a definite "texture missing"
    // signal — the material's own color is equally unresolved in that case, so don't try to
    // preserve it. Only respect an existing non-default color when there was never a map
    // reference to begin with (a deliberately solid-colored FBX material).
    const hadBlankMap = mats.some((m) => m?.map);
    const existing = mats[0];
    if (!hadBlankMap && existing?.color && existing.color.getHex() !== 0xffffff && existing.color.getHex() !== 0xcccccc) {
      return;
    }
    const fallback = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.75, metalness: 0.05 });
    child.material = fallback;
  });
}

function collectNodeNames(child) {
  const names = [];
  let o = child;
  for (let depth = 0; depth < 8 && o; depth += 1) {
    if (o.name) {
      const raw = String(o.name);
      names.push(raw.toLowerCase());
      // FBX often suffixes " 1", "_geo", "Mesh"
      names.push(raw.toLowerCase().replace(/\s+\d+$/, ''));
      names.push(raw.toLowerCase().replace(/_geo$/i, ''));
      names.push(raw.toLowerCase().replace(/mesh$/i, ''));
    }
    o = o.parent;
  }
  return [...new Set(names.filter(Boolean))];
}

/**
 * Find prefab binding for a three.js mesh node.
 * Prefers exact GameObject name match, then fuzzy includes.
 * Returns { materialNames, materialRelPaths } for slot assignment.
 */
function prefabBindingForObject(child, prefabBindings, meshRelPath) {
  const list = Array.isArray(prefabBindings) ? prefabBindings : [];
  if (!list.length) return null;
  const mesh = String(meshRelPath || '').replace(/\\/g, '/');
  const base = mesh.split('/').pop() || '';
  const forMesh = list.filter((b) => {
    const mp = String(b.meshRelPath || '').replace(/\\/g, '/');
    if (!mp) return true;
    return mp === mesh || mp.endsWith('/' + base) || mp.split('/').pop() === base;
  });
  const candidates = forMesh.length ? forMesh : list;
  if (!candidates.length) return null;

  const nodeNames = collectNodeNames(child);
  if (!nodeNames.length) {
    // No names — only if single candidate
    return candidates.length === 1 ? candidates[0] : null;
  }

  // 1) exact goName match
  let pick = candidates.find(
    (b) => b.goName && nodeNames.includes(String(b.goName).toLowerCase())
  );
  // 2) fuzzy: goName contained in node name or vice versa
  if (!pick) {
    pick = candidates.find((b) => {
      if (!b.goName) return false;
      const g = String(b.goName).toLowerCase();
      return nodeNames.some((n) => n === g || n.includes(g) || g.includes(n));
    });
  }
  // 3) match FBX material slot name to binding's first material
  if (!pick) {
    const slots = meshMaterialNames(child).map((n) => String(n || '').toLowerCase()).filter(Boolean);
    if (slots.length) {
      pick = candidates.find((b) =>
        (b.materialNames || []).some((mn) => slots.includes(String(mn).toLowerCase()))
      );
    }
  }
  // Do NOT fall back to candidates[0] for multi-GO avatars — wrong mat on wrong part.
  return pick || null;
}

async function applyParsedMaterials(object, materials, textureBlobMap, preferredMaterialName, threeCache, prefabBindings, meshRelPath, manager) {
  if (!materials?.length) {
    await applyFallbackMaterial(object, manager);
    return { applied: 0, mode: 'fallback' };
  }

  const cache = threeCache || new Map();
  const cachedMats = () => new Set(cache.values());

  async function getThreeMat(desc) {
    const key = desc.relPath || desc.name;
    if (cache.has(key)) return cache.get(key);
    const m = await buildApproxMaterial(desc, textureBlobMap);
    cache.set(key, m);
    return m;
  }

  function safeDisposeReplaced(oldMat, nextMats) {
    if (!oldMat) return;
    const nextSet = new Set(Array.isArray(nextMats) ? nextMats : [nextMats]);
    const keep = cachedMats();
    const list = Array.isArray(oldMat) ? oldMat : [oldMat];
    for (const m of list) {
      if (!m || nextSet.has(m) || keep.has(m)) continue;
      disposeMaterial(m);
    }
  }

  function findMat(name, relPath) {
    const stripExt = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\.mat$/i, '')
        .replace(/\.asset$/i, '');

    if (relPath) {
      const norm = String(relPath).replace(/\\/g, '/').toLowerCase();
      // 1) exact relPath
      let byPath = materials.find(
        (m) => String(m.relPath || '').replace(/\\/g, '/').toLowerCase() === norm
      );
      if (byPath) return byPath;
      // 2) path ends-with (full subpath, not bare basename alone when ambiguous)
      byPath = materials.find((m) => {
        const rp = String(m.relPath || '').replace(/\\/g, '/').toLowerCase();
        return rp.endsWith('/' + norm) || norm.endsWith('/' + rp) || rp.endsWith(norm) || norm.endsWith(rp);
      });
      if (byPath) return byPath;
      // 3) basename only if UNIQUE among materials
      const base = norm.split('/').pop();
      const baseHits = materials.filter((m) => {
        const rp = String(m.relPath || '').replace(/\\/g, '/').toLowerCase();
        return rp.split('/').pop() === base;
      });
      if (baseHits.length === 1) return baseHits[0];
      // 4) basename + name disambiguation
      if (baseHits.length > 1 && name) {
        const n = stripExt(name);
        const named = baseHits.find((m) => stripExt(m.name) === n);
        if (named) return named;
      }
    }
    if (!name) return null;
    const lower = stripExt(name);
    const matches = materials.filter(
      (m) =>
        stripExt(m.name) === lower
        || stripExt(String(m.relPath || '').replace(/\\/g, '/').split('/').pop()) === lower
    );
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    // Ambiguous name (e.g. two LightGrey.mat): prefer path containing Material folder hint from name
    return matches.find((m) => m.mainTexRelPath) || matches[0];
  }

  let applied = 0;
  const meshes = [];
  object.traverse((child) => {
    if ((child.isMesh || child.isSkinnedMesh) && !child.userData?.isApproxOutline) {
      meshes.push(child);
    }
  });

  // How many distinct GO bindings exist for this mesh? Used to decide color-variant force.
  const meshBindings = (Array.isArray(prefabBindings) ? prefabBindings : []).filter((b) => {
    const mp = String(b.meshRelPath || '').replace(/\\/g, '/');
    const mesh = String(meshRelPath || '').replace(/\\/g, '/');
    if (!mp || !mesh) return true;
    return mp === mesh || mp.endsWith('/' + mesh.split('/').pop());
  });
  // Binding count alone under-counts a real avatar when its Prefab has no per-part material
  // override at all (a stripped Nested-Prefab renderer with an empty modification list — a
  // valid Unity pattern when materials are assigned via the FBX's own import-time remap
  // rather than a Prefab override). Observed on a real item: 11 submeshes / 8 distinct FBX
  // material slots (Hair, Face, Body, Cloth...) folded into a single binding with no
  // materialNames, which made this look like a 1-part item and forced one material onto the
  // whole mesh.
  //
  // Only count a raw FBX slot name if it actually resolves to a real material in this
  // package — plain "many distinct slot names" is not enough. A color-variant hair pack's
  // raw FBX slots are typically internal part labels ("Noir_Hair_Front", "Noir_Hair_ACC_1")
  // that don't match any of the real selectable materials (named by color, e.g. "Amber"); for
  // those, forcing the user's selected color across every submesh is still correct, and
  // counting the (unresolvable) slot names as "multi-part" wrongly disabled that forcing and
  // left every submesh on an untextured fallback material.
  const materialNameSet = new Set(
    (materials || []).map((m) => String(m?.name || '').trim().toLowerCase()).filter(Boolean)
  );
  const resolvableSlotNames = new Set();
  for (const m of meshes) {
    for (const n of meshMaterialNames(m)) {
      if (n && materialNameSet.has(n.trim().toLowerCase())) resolvableSlotNames.add(n);
    }
  }
  const multiPartAvatar = meshBindings.length > 2 || resolvableSlotNames.size > 2;

  // If every mesh the user is currently looking at (i.e. everything under the selected
  // Prefab/mesh) is bound to a GameObject that's inactive by default (e.g. an AFK-only prop
  // meant to be toggled on by a VRChat Animator state we can't simulate), respecting that
  // flag would render a totally blank scene for a Prefab the user explicitly picked from the
  // dropdown. A blank canvas with no explanation is worse than showing an "off by default"
  // part, so only hide-by-default when at least one mesh would remain visible.
  const bindingsForMeshes = meshes.map((child) => prefabBindingForObject(child, prefabBindings, meshRelPath));
  const allWouldBeHidden = bindingsForMeshes.length > 0
    && bindingsForMeshes.every((b) => b && b.active === false);

  for (let meshIdx = 0; meshIdx < meshes.length; meshIdx++) {
    const child = meshes[meshIdx];
    const slotNames = meshMaterialNames(child);
    const binding = bindingsForMeshes[meshIdx];
    const prefabSlots = binding?.materialNames || null;
    const prefabPaths = binding?.materialRelPaths || null;

    // Respect the Prefab's own default GameObject/Renderer enabled state (e.g. underwear
    // or animation-only props that ship disabled by default). No binding match at all
    // means we can't judge either way, so default to visible.
    const hiddenByPrefabDefault = binding && binding.active === false && !allWouldBeHidden;
    child.visible = !hiddenByPrefabDefault;
    if (hiddenByPrefabDefault) removeOutlineChildren(child);

    // An inactive Renderer can still be enabled later by a VRChat Animator/Expression.
    // Apply its authored Prefab material while it is hidden so that toggling it on does
    // not expose the raw FBX fallback material (observed on Sio's Underwear_Bra).

    // Color-variant force only for simple single-part meshes (hair packs), not full avatars.
    const forceColorVariant =
      Boolean(preferredMaterialName) &&
      !multiPartAvatar &&
      (!prefabSlots || prefabSlots.length <= 1);

    const resolveSlot = (i) => {
      if (forceColorVariant) return findMat(preferredMaterialName, null);
      const name = (prefabSlots && (prefabSlots[i] || prefabSlots[0])) || slotNames[i] || slotNames[0];
      // Prefer path aligned to the same index as the name
      const rel = prefabPaths
        ? (prefabPaths[i] || (prefabSlots && prefabSlots[i] ? prefabPaths[prefabSlots.indexOf(prefabSlots[i])] : null) || prefabPaths[0])
        : null;
      return (
        findMat(name, rel) ||
        findMat(slotNames[i], null) ||
        findMat(slotNames[0], null) ||
        // Mesh node name often equals material name (Body, Hair, Shoes…)
        findMat(child.name, null) ||
        findMat(child.parent?.name, null)
      );
    };

    if (Array.isArray(child.material) && child.material.length > 1) {
      const prevList = child.material.slice();
      const next = [];
      for (let i = 0; i < prevList.length; i++) {
        const desc = resolveSlot(i);
        if (desc) {
          next.push(await getThreeMat(desc));
          applied += 1;
        } else {
          next.push(prevList[i]);
        }
      }
      child.material = next;
      for (const old of prevList) {
        if (!next.includes(old) && !cachedMats().has(old)) disposeMaterial(old);
      }
      const outlineSrc = resolveSlot(0) || materials[0];
      // Inverted-hull outlines need a dedicated skinning-compatible vertex path to be
      // reliable. With a shared FBX SkinnedMesh geometry they can render as a solid,
      // pale shell over the mesh (not an outline), so omit this approximation for
      // skinned avatar parts rather than obscuring the authored material.
      if (!child.isSkinnedMesh && outlineSrc?.outlineColor && outlineSrc.outlineWidth > 0) {
        attachOutlineHull(child, outlineSrc.outlineColor, outlineSrc.outlineWidth);
      } else {
        removeOutlineChildren(child);
      }
    } else {
      const use = resolveSlot(0) || (materials.length === 1 ? materials[0] : null);
      if (use) {
        const prev = child.material;
        const next = await getThreeMat(use);
        child.material = next;
        safeDisposeReplaced(prev, next);
        applied += 1;
        if (!child.isSkinnedMesh && use.outlineColor && use.outlineWidth > 0) {
          attachOutlineHull(child, use.outlineColor, use.outlineWidth);
        } else {
          removeOutlineChildren(child);
        }
      }
    }
  }

  if (!applied) await applyFallbackMaterial(object, manager);
  return { applied, mode: applied ? 'mat' : 'fallback', cache };
}

/**
 * Reads + parses a mesh (.fbx/.obj) and applies its materials. Shared by the main viewer load
 * and by `wearOutfit()` — each call gets its own texture blob map so an outfit's textures can be
 * revoked independently when it's removed/swapped without touching the avatar's own.
 */
async function loadMeshObject({
  readFile,
  meshRelPath,
  ext,
  textures,
  materials = [],
  prefabBindings = [],
  preferredMaterialName = null,
}) {
  const textureBlobMap = await buildTextureBlobMap(textures, readFile);
  const manager = buildTextureUrlModifier(textureBlobMap);
  let object = null;
  const materialThreeCache = new Map();

  const cleanupFailedLoad = () => {
    if (object) disposeObjectSubtree(object);
    for (const mat of materialThreeCache.values()) disposeMaterial(mat);
    for (const url of new Set(textureBlobMap.values())) {
      revokeBlobUrlAfterDecode(url);
    }
  };

  try {

  // Also ensure textures referenced only via .mat (already in textures list) are present;
  // if a mat points at a path not in textures, try a best-effort read by relPath.
  const matTexKeys = [
    'mainTexRelPath', 'alphaMaskRelPath', 'normalMapRelPath', 'emissionMapRelPath', 'outlineTexRelPath',
    'main2ndTexRelPath', 'shadowColorTexRelPath', 'shadow2ndColorTexRelPath', 'shadow3rdColorTexRelPath',
    'matCapTexRelPath', 'matCapBlendMaskRelPath', 'aoMapRelPath',
  ];
  for (const mat of (materials || [])) {
    for (const key of matTexKeys) {
      const rel = mat[key];
      if (!rel) continue;
      const norm = String(rel).replace(/\\/g, '/');
      if (textureBlobMap.has(norm) || textureBlobMap.has(basename(norm))) continue;
      try {
        const bytes = await readFile(norm);
        const ab = toArrayBuffer(bytes);
        if (!ab) continue;
        const url = URL.createObjectURL(new Blob([ab], { type: mimeForRelPath(norm) }));
        textureBlobMap.set(norm, url);
        textureBlobMap.set(basename(norm), url);
      } catch {
        // skip
      }
    }
  }

  const meshBytes = await readFile(meshRelPath);
  if (!meshBytes) throw new Error('mesh_read_failed');
  const arrayBuffer = toArrayBuffer(meshBytes);
  if (!arrayBuffer) throw new Error('mesh_buffer_invalid');

  if (ext === '.fbx') {
    const loader = new FBXLoader(manager);
    object = loader.parse(arrayBuffer, '');
  } else if (ext === '.obj') {
    const text = new TextDecoder('utf-8').decode(meshBytes);
    const loader = new OBJLoader(manager);
    object = loader.parse(text);
  } else {
    throw new Error('unsupported_mesh_ext');
  }

  const applyResult = await applyParsedMaterials(
    object,
    materials,
    textureBlobMap,
    preferredMaterialName,
    materialThreeCache,
    prefabBindings,
    meshRelPath,
    manager
  );

  return { object, textureBlobMap, applyResult, materialThreeCache };
  } catch (e) {
    cleanupFailedLoad();
    throw e;
  }
}

async function createViewer(canvasEl, opts) {
  const {
    readFile,
    meshRelPath,
    ext,
    textures,
    materials = [],
    prefabBindings = [],
    preferredMaterialName = null,
  } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1e);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(2, 1.5, 2);

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace != null) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer && THREE.sRGBEncoding != null) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  // Scene lights mainly affect non-lilToon (MeshStandard) fallbacks; lilToon uses its own uniforms.
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight1.position.set(3, 5, 4);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.25);
  dirLight2.position.set(-4, -2, -3);
  scene.add(ambient, dirLight1, dirLight2);

  const grid = new THREE.GridHelper(4, 16, 0x444444, 0x2a2a2e);
  scene.add(grid);

  const controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  let loaded;
  try {
    loaded = await loadMeshObject({
      readFile,
      meshRelPath,
      ext,
      textures,
      materials,
      prefabBindings,
      preferredMaterialName,
    });
  } catch (e) {
    controls.dispose();
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss?.();
    throw e;
  }
  const { object, textureBlobMap, applyResult, materialThreeCache } = loaded;
  keepAnimatedSkinnedMeshesRenderable(object);
  scene.add(object);
  frameCameraToObject(camera, controls, object);
  syncLilToonLightUniforms(object, dirLight1.position, { ambient: 0.35, fillLightDir: dirLight2.position, fillStrength: 0.55 });

  let rafId = null;
  let disposed = false;
  let currentObject = object;
  let renderInvalidated = true;
  let lastRenderAt = 0;
  let warmupUntil = window.performance.now() + 2000;
  let physBoneRuntime = null;
  let constraintRuntime = null;
  let contactRuntime = null;
  let avatarFaceRuntime = null;
  let humanoidRuntime = null;
  let unityAnimationRuntime = createUnityAnimationRuntime({ root: currentObject, invalidate });

  function invalidate(warmupMs = 0) {
    renderInvalidated = true;
    if (warmupMs > 0) warmupUntil = Math.max(warmupUntil, window.performance.now() + warmupMs);
  }

  function resize() {
    const w = canvasEl.clientWidth || 1;
    const h = canvasEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasEl);
  resize();

  const handleControlsChange = () => invalidate();
  controls.addEventListener('change', handleControlsChange);

  function animate(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    controls.update();
    constraintRuntime?.update(now);
    physBoneRuntime?.update(now);
    contactRuntime?.update(now);
    const warmingUp = now < warmupUntil && now - lastRenderAt >= 66;
    if (!renderInvalidated && !warmingUp) return;
    if (currentObject && renderInvalidated) {
      syncLilToonLightUniforms(currentObject, dirLight1.position, { ambient: 0.35, fillLightDir: dirLight2.position, fillStrength: 0.55 });
    }
    renderer.render(scene, camera);
    renderInvalidated = false;
    lastRenderAt = now;
  }
  animate(window.performance.now());

  let materialChangeSeq = 0;
  let materialChangeQueue = Promise.resolve();
  function setPreferredMaterial(name) {
    const seq = ++materialChangeSeq;
    materialChangeQueue = materialChangeQueue.then(async () => {
      if (disposed || !currentObject || seq !== materialChangeSeq) return;
      await applyParsedMaterials(
        currentObject,
        materials,
        textureBlobMap,
        name || null,
        materialThreeCache,
        prefabBindings,
        meshRelPath
      );
      if (disposed || !currentObject) return;
      syncLilToonLightUniforms(currentObject, dirLight1.position, { ambient: 0.35, fillLightDir: dirLight2.position, fillStrength: 0.55 });
      invalidate(1000);
    });
    return materialChangeQueue;
  }

  function frameCurrentObject(precise = false) {
    if (!currentObject) return { error: 'disposed' };
    currentObject.updateMatrixWorld(true);
    frameCameraToObject(camera, controls, currentObject, precise);
    invalidate(250);
    return { ok: true };
  }

  let outfitState = null; // { object, textureBlobMap }
  const compositeStates = [];
  const externalBoneBaseline = new Map();
  let externalBonePathIndex = null;
  const externalBoneBindingCache = new Map();
  const externalDeltaPosition = new THREE.Vector3();
  const externalDeltaRotation = new THREE.Quaternion();
  const vrcVisibilityBaseline = new Map();
  const vrcMorphBaseline = new Map();
  const vrcMaterialBaseline = new Map();
  const vrcObjectBindingCache = new Map();
  function normalizeUnityPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function normalizeExternalBonePath(value) {
    return normalizeUnityPath(value)
      .split('/')
      .map((segment) => segment.replace(/\./g, ''))
      .join('/');
  }

  function objectRelativePath(object) {
    const names = [];
    let current = object;
    while (current && current !== currentObject) {
      names.unshift(String(current.name || ''));
      current = current.parent;
    }
    return normalizeUnityPath(names.filter(Boolean).join('/'));
  }

  function buildExternalBonePathIndex() {
    const exact = new Map();
    const byLeaf = new Map();
    currentObject?.traverse((object) => {
      if (!object.isBone) return;
      const rel = normalizeExternalBonePath(objectRelativePath(object));
      if (rel) {
        if (!exact.has(rel)) exact.set(rel, []);
        exact.get(rel).push(object);
      }
      const leaf = String(object.name || '');
      if (!leaf) return;
      if (!byLeaf.has(leaf)) byLeaf.set(leaf, []);
      byLeaf.get(leaf).push(object);
    });
    externalBonePathIndex = { exact, byLeaf };
  }

  function findExternalBones(pathValue) {
    if (!externalBonePathIndex) buildExternalBonePathIndex();
    const wanted = normalizeExternalBonePath(pathValue);
    if (!wanted) return [];
    if (externalBoneBindingCache.has(wanted)) return externalBoneBindingCache.get(wanted);
    const segments = wanted.split('/');
    const leaf = segments.at(-1);
    const leaves = externalBonePathIndex.byLeaf.get(leaf) || [];
    const wantedParent = segments.at(-2) || '';
    const parentMatches = wantedParent
      ? leaves.filter((bone) => String(bone.parent?.name || '') === wantedParent)
      : [];
    const direct = externalBonePathIndex.exact.get(wanted);
    if (direct) {
      const resolved = [...new Set([...direct, ...parentMatches])];
      externalBoneBindingCache.set(wanted, resolved);
      return resolved;
    }
    const suffix = new Set();
    for (const [path, bones] of externalBonePathIndex.exact) {
      if (!path.endsWith(`/${wanted}`) && !wanted.endsWith(`/${path}`)) continue;
      for (const bone of bones) suffix.add(bone);
    }
    if (suffix.size) {
      for (const bone of parentMatches) suffix.add(bone);
      const resolved = [...suffix];
      externalBoneBindingCache.set(wanted, resolved);
      return resolved;
    }
    const resolved = parentMatches.length ? parentMatches : (leaves.length === 1 ? leaves : []);
    externalBoneBindingCache.set(wanted, resolved);
    return resolved;
  }

  function applyExternalBonePoses(frame) {
    if (disposed || !currentObject) return { error: 'disposed' };
    let applied = 0;
    let unresolved = 0;
    let transformed = 0;
    for (const pose of (Array.isArray(frame?.bones) ? frame.bones : [])) {
      let bones = findExternalBones(pose?.path);
      if (!bones.length && pose?.humanBone) {
        bones = unityAnimationRuntime?.resolveHumanBones?.(pose.humanBone) || [];
      }
      if (!bones.length) {
        unresolved += 1;
        continue;
      }
      const p = pose.position || {};
      const q = pose.rotation || {};
      externalDeltaPosition.set(
        Number(p.x) || 0,
        Number(p.y) || 0,
        -(Number(p.z) || 0)
      );
      // Unity is left-handed while three.js/FBXLoader is right-handed. Reflect the
      // delta rotation through Z before composing it with three.js's imported rest pose.
      externalDeltaRotation.set(
        -(Number(q.x) || 0),
        -(Number(q.y) || 0),
        Number(q.z) || 0,
        Number.isFinite(Number(q.w)) ? Number(q.w) : 1
      ).normalize();
      for (const bone of bones) {
        if (!externalBoneBaseline.has(bone)) {
          externalBoneBaseline.set(bone, {
            position: bone.position.clone(),
            quaternion: bone.quaternion.clone(),
          });
        }
        const baseline = externalBoneBaseline.get(bone);
        bone.position.copy(baseline.position).add(externalDeltaPosition);
        bone.quaternion.copy(baseline.quaternion).multiply(externalDeltaRotation);
        transformed += 1;
      }
      applied += 1;
    }
    invalidate();
    return { applied, unresolved, transformed, sequence: frame?.sequence || 0 };
  }

  function resetExternalBonePoses() {
    for (const [bone, baseline] of externalBoneBaseline) {
      bone.position.copy(baseline.position);
      bone.quaternion.copy(baseline.quaternion);
    }
    externalBoneBaseline.clear();
    externalBonePathIndex = null;
    externalBoneBindingCache.clear();
    invalidate();
    return { ok: true };
  }

  function startLocalPhysBones(components) {
    physBoneRuntime?.dispose();
    physBoneRuntime = createPhysBoneRuntime({ root: currentObject, components, invalidate });
    return physBoneRuntime.start();
  }

  function stopLocalPhysBones() {
    const result = physBoneRuntime?.stop() || { ok: true };
    physBoneRuntime?.dispose();
    physBoneRuntime = null;
    return result;
  }

  function startConstraints(components) {
    constraintRuntime?.dispose();
    constraintRuntime = createConstraintRuntime({ root: currentObject, components, invalidate });
    constraintRuntime.update();
    return { ok: true, ...constraintRuntime.stats() };
  }

  function stopConstraints() {
    constraintRuntime?.dispose();
    constraintRuntime = null;
    return { ok: true };
  }

  function startContacts(components, onParameters) {
    contactRuntime?.dispose();
    contactRuntime = createContactRuntime({ root: currentObject, components, onParameters });
    return { ok: true, ...contactRuntime.stats() };
  }

  function stopContacts() {
    contactRuntime?.dispose();
    contactRuntime = null;
    return { ok: true };
  }

  function startAvatarFace(components) {
    avatarFaceRuntime?.dispose();
    avatarFaceRuntime = createAvatarFaceRuntime({ root: currentObject, components, invalidate });
    avatarFaceRuntime.setFace();
    return { ok: true, ...avatarFaceRuntime.stats() };
  }

  function stopAvatarFace() {
    avatarFaceRuntime?.dispose();
    avatarFaceRuntime = null;
    return { ok: true };
  }

  function setAvatarFace(values) {
    return avatarFaceRuntime?.setFace(values) || { error: 'face_runtime_unavailable' };
  }

  function setAvatarTracking(values) {
    const face = avatarFaceRuntime?.setTracking(values) || null;
    const humanoid = humanoidRuntime?.setTracking(values) || null;
    return { face, humanoid };
  }

  function startHumanoidRuntime() {
    humanoidRuntime?.dispose();
    humanoidRuntime = createHumanoidRuntime({ root: currentObject, invalidate });
    return { ok: true, ...humanoidRuntime.stats() };
  }

  function stopHumanoidRuntime() {
    humanoidRuntime?.dispose();
    humanoidRuntime = null;
    return { ok: true };
  }

  function setHumanoidPose(values) {
    return humanoidRuntime?.setPose(values) || { error: 'humanoid_runtime_unavailable' };
  }

  function findUnityObject(unityPath) {
    if (!currentObject) return null;
    const wanted = normalizeUnityPath(unityPath);
    if (!wanted) return currentObject;
    if (vrcObjectBindingCache.has(wanted)) return vrcObjectBindingCache.get(wanted);
    const exact = [];
    const suffix = [];
    const leaf = wanted.split('/').at(-1);
    currentObject.traverse((object) => {
      const rel = objectRelativePath(object);
      if (rel === wanted) exact.push(object);
      else if (rel.endsWith(`/${wanted}`) || wanted.endsWith(`/${rel}`)) suffix.push(object);
    });
    if (exact.length) {
      vrcObjectBindingCache.set(wanted, exact[0]);
      return exact[0];
    }
    if (suffix.length === 1) {
      vrcObjectBindingCache.set(wanted, suffix[0]);
      return suffix[0];
    }
    const leafMatches = [];
    currentObject.traverse((object) => {
      if (String(object.name || '') === leaf) leafMatches.push(object);
    });
    const resolved = leafMatches.length === 1 ? leafMatches[0] : null;
    vrcObjectBindingCache.set(wanted, resolved);
    return resolved;
  }

  function resetVrcAnimationFrame(reapplyFace = true) {
    avatarFaceRuntime?.beforeAnimation();
    unityAnimationRuntime?.reset();
    for (const [object, visible] of vrcVisibilityBaseline) object.visible = visible;
    for (const [mesh, values] of vrcMorphBaseline) {
      if (!mesh.morphTargetInfluences) continue;
      for (const [index, value] of values) mesh.morphTargetInfluences[index] = value;
    }
    for (const [material, baseline] of vrcMaterialBaseline) {
      if (baseline.color && material.color) material.color.copy(baseline.color);
      if (baseline.emissive && material.emissive) material.emissive.copy(baseline.emissive);
      material.opacity = baseline.opacity;
      material.alphaTest = baseline.alphaTest;
      material.transparent = baseline.transparent;
      for (const [name, value] of baseline.uniforms) {
        if (material.uniforms?.[name]) material.uniforms[name].value = value;
      }
      material.needsUpdate = true;
    }
    vrcVisibilityBaseline.clear();
    vrcMorphBaseline.clear();
    vrcMaterialBaseline.clear();
    if (reapplyFace) avatarFaceRuntime?.afterAnimation();
    invalidate();
  }

  function sampleCurveValue(curve, timeSeconds, clip, reverse = false, loopOverride) {
    const keys = Array.isArray(curve?.keyframes) ? curve.keyframes : [];
    if (!keys.length) return NaN;
    if (!Number.isFinite(timeSeconds)) return Number(keys[reverse ? 0 : keys.length - 1].value);
    const start = Number(clip?.startTime ?? keys[0].time) || 0;
    const stop = Number(clip?.stopTime ?? keys.at(-1).time) || start;
    let time = timeSeconds;
    if (reverse) time = stop - (time - start);
    const shouldLoop = typeof loopOverride === 'boolean' ? loopOverride : Boolean(clip?.loopTime);
    if (shouldLoop && stop > start) time = start + ((((time - start) % (stop - start)) + (stop - start)) % (stop - start));
    else time = Math.max(start, Math.min(stop, time));
    if (time <= Number(keys[0].time)) return Number(keys[0].value);
    if (time >= Number(keys.at(-1).time)) return Number(keys.at(-1).value);
    for (let index = 0; index < keys.length - 1; index += 1) {
      const left = keys[index];
      const right = keys[index + 1];
      if (time < left.time || time > right.time) continue;
      const duration = Number(right.time) - Number(left.time);
      if (!(duration > 0)) return Number(right.value);
      if (!Number.isFinite(left.outSlope) || !Number.isFinite(right.inSlope)) return Number(left.value);
      const t = (time - Number(left.time)) / duration;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = (2 * t3) - (3 * t2) + 1;
      const h10 = t3 - (2 * t2) + t;
      const h01 = (-2 * t3) + (3 * t2);
      const h11 = t3 - t2;
      return (h00 * Number(left.value))
        + (h10 * duration * Number(left.outSlope || 0))
        + (h01 * Number(right.value))
        + (h11 * duration * Number(right.inSlope || 0));
    }
    return Number(keys.at(-1).value);
  }

  function applyVrcAnimationClips(clipsOrSamples) {
    if (disposed || !currentObject) return { error: 'disposed' };
    avatarFaceRuntime?.beforeAnimation();
    resetVrcAnimationFrame(false);
    const entries = Array.isArray(clipsOrSamples) ? clipsOrSamples : [];
    const transformStats = unityAnimationRuntime?.apply(entries) || {};
    const stats = {
      clipCount: 0,
      visibilityCount: 0,
      blendShapeCount: 0,
      materialCount: 0,
      transformCount: Number(transformStats.transformCount) || 0,
      muscleCount: Number(transformStats.muscleCount) || 0,
      ignoredCurveCount: Number(transformStats.ignoredCurveCount) || 0,
      unresolvedCount: Number(transformStats.unresolvedTransformCount) || 0,
      unresolvedAttributes: [...new Set(transformStats.unresolvedAttributes || [])],
    };
    const visibilityValues = new Map();
    const morphValues = new Map();
    const materialValues = new Map();
    for (const entry of entries) {
      const clip = entry?.clip || entry;
      const weight = Math.max(0, Number(entry?.clip ? entry.weight : 1) || 0);
      let time = entry?.clip ? Number(entry.time) : NaN;
      if (entry?.normalizedTime && Number.isFinite(time)) {
        const start = Number(clip?.startTime) || 0;
        const stop = Number(clip?.stopTime) || start;
        time = start + Math.max(0, Math.min(1, time)) * Math.max(0, stop - start);
      }
      if (!clip || weight <= 0) continue;
      stats.clipCount += 1;
      const loopOverride = typeof entry?.loop === 'boolean' ? entry.loop : undefined;
      for (const curve of clip?.floatCurves || []) {
        const value = sampleCurveValue(curve, time, clip, Boolean(entry?.reverse), loopOverride);
        if (!Number.isFinite(value)) continue;
        const target = findUnityObject(curve.path);
        if (!target) {
          stats.unresolvedCount += 1;
          continue;
        }
        if (curve.attribute === 'm_IsActive') {
          if (!visibilityValues.has(target)) visibilityValues.set(target, { value: 0, weight: 0 });
          const blended = visibilityValues.get(target);
          blended.value += value * weight;
          blended.weight += weight;
          stats.visibilityCount += 1;
          continue;
        }
        const blendShapeName = String(curve.attribute || '').match(/^blendShape\.(.+)$/)?.[1];
        const materialProperty = String(curve.attribute || '').match(/^material\.(.+)$/)?.[1];
        if (!blendShapeName && materialProperty) {
          let appliedMaterial = false;
          target.traverse((object) => {
            const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
            for (const material of objectMaterials) {
              if (!materialValues.has(material)) materialValues.set(material, new Map());
              const properties = materialValues.get(material);
              if (!properties.has(materialProperty)) properties.set(materialProperty, { value: 0, weight: 0 });
              const blended = properties.get(materialProperty);
              blended.value += value * weight;
              blended.weight += weight;
              appliedMaterial = true;
              stats.materialCount += 1;
            }
          });
          if (!appliedMaterial) stats.unresolvedCount += 1;
          continue;
        }
        if (!blendShapeName) continue;
        let applied = false;
        target.traverse((mesh) => {
          const index = mesh.morphTargetDictionary?.[blendShapeName];
          if (!Number.isInteger(index) || !mesh.morphTargetInfluences) return;
          if (!morphValues.has(mesh)) morphValues.set(mesh, new Map());
          const byIndex = morphValues.get(mesh);
          if (!byIndex.has(index)) byIndex.set(index, { value: 0, weight: 0 });
          const blended = byIndex.get(index);
          blended.value += (value / 100) * weight;
          blended.weight += weight;
          stats.blendShapeCount += 1;
          applied = true;
        });
        if (!applied) stats.unresolvedCount += 1;
      }
    }
    for (const [target, blended] of visibilityValues) {
      if (!vrcVisibilityBaseline.has(target)) vrcVisibilityBaseline.set(target, target.visible);
      target.visible = (blended.value / Math.max(blended.weight, 1e-8)) >= 0.5;
    }
    for (const [mesh, byIndex] of morphValues) {
      if (!vrcMorphBaseline.has(mesh)) vrcMorphBaseline.set(mesh, new Map());
      const baseline = vrcMorphBaseline.get(mesh);
      for (const [index, blended] of byIndex) {
        if (!baseline.has(index)) baseline.set(index, mesh.morphTargetInfluences[index]);
        mesh.morphTargetInfluences[index] = blended.value / Math.max(blended.weight, 1e-8);
      }
    }
    for (const [material, properties] of materialValues) {
      const baseline = {
        color: material.color?.clone?.() || null,
        emissive: material.emissive?.clone?.() || null,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
        transparent: material.transparent,
        uniforms: new Map(),
      };
      vrcMaterialBaseline.set(material, baseline);
      for (const [property, blended] of properties) {
        const value = blended.value / Math.max(blended.weight, 1e-8);
        const colorChannel = property.match(/^_(?:Color|BaseColor)\.([rgba])$/)?.[1];
        const emissionChannel = property.match(/^_EmissionColor\.([rgba])$/)?.[1];
        if (colorChannel === 'a') {
          material.opacity = value;
          material.transparent = value < 0.999 || material.transparent;
        } else if (colorChannel && material.color) {
          material.color[colorChannel] = value;
        } else if (emissionChannel && emissionChannel !== 'a' && material.emissive) {
          material.emissive[emissionChannel] = value;
        } else if (property === '_Cutoff') {
          material.alphaTest = value;
        } else if (material.uniforms?.[property] && typeof material.uniforms[property].value === 'number') {
          baseline.uniforms.set(property, material.uniforms[property].value);
          material.uniforms[property].value = value;
        }
      }
      material.needsUpdate = true;
    }
    avatarFaceRuntime?.afterAnimation();
    invalidate();
    return stats;
  }

  function disposeLoadedMesh(loaded) {
    if (!loaded) return;
    disposeObjectSubtree(loaded.object);
    for (const mat of loaded.materialThreeCache?.values?.() || []) disposeMaterial(mat);
    for (const url of loaded.textureBlobMap?.values?.() || []) {
      revokeBlobUrlAfterDecode(url);
    }
  }

  function removeOutfit() {
    if (!outfitState) return { ok: true, restoredOriginalGarmentCount: 0, restoredMaShapeCount: 0 };
    const restoredOriginalGarmentCount = outfitState.hiddenOriginalGarments?.length || 0;
    const restoredMaShapeCount = outfitState.maShapeChanges?.length || 0;
    restoreOriginalGarments(outfitState.hiddenOriginalGarments);
    restoreMaShapeChanges(outfitState.maShapeChanges);
    disposeObjectSubtree(outfitState.object);
    outfitState.object.parent?.remove(outfitState.object);
    for (const mat of outfitState.materialThreeCache?.values?.() || []) disposeMaterial(mat);
    for (const url of outfitState.textureBlobMap.values()) {
      revokeBlobUrlAfterDecode(url);
    }
    outfitState = null;
    invalidate();
    return { ok: true, restoredOriginalGarmentCount, restoredMaShapeCount };
  }

  function removeCompositeLayers() {
    while (compositeStates.length) {
      const state = compositeStates.pop();
      disposeObjectSubtree(state.object);
      state.object.parent?.remove(state.object);
      for (const mat of state.materialThreeCache?.values?.() || []) disposeMaterial(mat);
      for (const url of state.textureBlobMap?.values?.() || []) revokeBlobUrlAfterDecode(url);
    }
    invalidate();
    return { ok: true };
  }

  async function addCompositeLayer(layerOpts) {
    if (disposed || !currentObject) return { error: 'disposed' };
    const loaded = await loadMeshObject(layerOpts);
    if (disposed || !currentObject) {
      disposeLoadedMesh(loaded);
      return { error: 'disposed' };
    }
    keepAnimatedSkinnedMeshesRenderable(loaded.object);
    const stats = attachOutfitToAvatar(currentObject, loaded.object, layerOpts.maComponents);
    const compatible = stats.totalBones === 0 || (stats.totalBones >= 8 && (
      stats.matchRatio >= 0.55
      || (stats.totalCoreBones >= 4 && stats.coreMatchRatio >= 0.9)
    ));
    if (!compatible) {
      loaded.object.parent?.remove(loaded.object);
      disposeLoadedMesh(loaded);
      return { error: 'incompatible_composite', ...stats };
    }
    compositeStates.push({
      object: loaded.object,
      textureBlobMap: loaded.textureBlobMap,
      materialThreeCache: loaded.materialThreeCache,
    });
    syncLilToonLightUniforms(loaded.object, dirLight1.position, {
      ambient: 0.35,
      fillLightDir: dirLight2.position,
      fillStrength: 0.55,
    });
    invalidate(1000);
    return { ok: true, ...stats };
  }

  async function wearOutfit(outfitOpts) {
    if (disposed || !currentObject) return { error: 'disposed' };
    removeOutfit();
    const outfitLoaded = await loadMeshObject(outfitOpts);
    if (disposed || !currentObject) {
      disposeLoadedMesh(outfitLoaded);
      return { error: 'disposed' };
    }
    keepAnimatedSkinnedMeshesRenderable(outfitLoaded.object);
    const stats = attachOutfitToAvatar(currentObject, outfitLoaded.object, outfitOpts.maComponents);
    const compatible = stats.totalBones >= 8 && (
      stats.matchRatio >= 0.55
      || (stats.totalCoreBones >= 4 && stats.coreMatchRatio >= 0.9)
    );
    if (!compatible) {
      outfitLoaded.object.parent?.remove(outfitLoaded.object);
      disposeLoadedMesh(outfitLoaded);
      return { error: 'incompatible_outfit', ...stats };
    }
    const hiddenOriginalGarments = hideOriginalGarments(currentObject, outfitLoaded.object);
    const maShapeChanges = applyMaShapeChanges(currentObject, outfitOpts.maComponents);
    outfitState = {
      object: outfitLoaded.object,
      textureBlobMap: outfitLoaded.textureBlobMap,
      materialThreeCache: outfitLoaded.materialThreeCache,
      hiddenOriginalGarments,
      maShapeChanges,
    };
    invalidate(1000);
    return {
      ok: true,
      hiddenOriginalGarmentCount: hiddenOriginalGarments.length,
      appliedMaShapeCount: maShapeChanges.length,
      ...stats,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    materialChangeSeq += 1;
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    controls.removeEventListener('change', handleControlsChange);
    controls.dispose();
    stopAvatarFace();
    stopHumanoidRuntime();
    unityAnimationRuntime?.dispose();
    unityAnimationRuntime = null;
    resetVrcAnimationFrame();
    resetExternalBonePoses();
    vrcObjectBindingCache.clear();
    stopLocalPhysBones();
    stopConstraints();
    stopContacts();
    removeOutfit();
    removeCompositeLayers();
    disposeScene(scene);
    for (const mat of materialThreeCache.values()) disposeMaterial(mat);
    for (const url of textureBlobMap.values()) {
      revokeBlobUrlAfterDecode(url);
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
    try {
      if (window.__avatoolLastViewer === handle) window.__avatoolLastViewer = null;
    } catch {
      /* debug handle was unavailable */
    }
  }

  const handle = {
    dispose,
    setPreferredMaterial,
    frameCurrentObject,
    applyVrcAnimationClips,
    resetVrcAnimationFrame,
    applyExternalBonePoses,
    resetExternalBonePoses,
    startLocalPhysBones,
    stopLocalPhysBones,
    isLocalPhysBoneActive: () => Boolean(physBoneRuntime?.isActive()),
    startConstraints,
    stopConstraints,
    getConstraintStats: () => constraintRuntime?.stats() || { constraintCount: 0, targetCount: 0 },
    startContacts,
    stopContacts,
    getContactStats: () => contactRuntime?.stats() || { senderCount: 0, receiverCount: 0 },
    getContactValues: () => contactRuntime?.values() || {},
    startAvatarFace,
    stopAvatarFace,
    setAvatarFace,
    setAvatarTracking,
    getAvatarFaceStats: () => avatarFaceRuntime?.stats() || { enabled: false, eyeBoneCount: 0, visemeCount: 0 },
    getAvatarFaceState: () => avatarFaceRuntime?.state() || null,
    startHumanoidRuntime,
    stopHumanoidRuntime,
    setHumanoidPose,
    resetHumanoidPose: () => humanoidRuntime?.reset() || { ok: true },
    getHumanoidStats: () => humanoidRuntime?.stats() || { boneCount: 0, armChainCount: 0, legChainCount: 0, hasHead: false },
    getHumanoidState: () => humanoidRuntime?.state() || null,
    wearOutfit,
    removeOutfit,
    addCompositeLayer,
    removeCompositeLayers,
    materialApplyResult: applyResult,
    materials,
    // Debug / tooling: inspect scene after apply
    getRootObject: () => currentObject,
    getScene: () => scene,
    getCamera: () => camera,
    getControls: () => controls,
  };
  try {
    window.__avatoolLastViewer = handle;
  } catch {
    /* ignore */
  }
  return handle;
}

window.AvatoolThreeBridge = { createViewer };
window.AvatoolThreeBridgeReadyPromise = Promise.resolve();
window.dispatchEvent(new CustomEvent('avatool-three-bridge-ready'));
