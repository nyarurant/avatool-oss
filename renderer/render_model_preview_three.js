import * as THREE from './vendor/three/three.module.js';
import { FBXLoader } from './vendor/three/addons/loaders/FBXLoader.js';
import { OBJLoader } from './vendor/three/addons/loaders/OBJLoader.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

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
    return textureBlobMap.get(base) || url;
  });
  return manager;
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap']) {
      const tex = mat[key];
      if (!tex?.isTexture) continue;
      // FBXLoader creates its own blob: URLs for binary-embedded texture data
      // (separate from our own textureBlobMap); revoke those here too.
      const src = tex.image?.src;
      if (typeof src === 'string' && src.startsWith('blob:')) {
        try { URL.revokeObjectURL(src); } catch { /* already revoked */ }
      }
      tex.dispose();
    }
    mat.dispose?.();
  }
}

function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) {
      obj.geometry?.dispose?.();
      disposeMaterial(obj.material);
    }
  });
}

function frameCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const distance = maxDim * 1.8;
  camera.near = Math.max(maxDim / 1000, 0.01);
  camera.far = maxDim * 100;
  camera.position.set(center.x + distance * 0.6, center.y + distance * 0.4, center.z + distance * 0.6);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

async function buildTextureBlobMap(textures, readFile) {
  const map = new Map();
  for (const tex of (textures || [])) {
    try {
      const bytes = await readFile(tex.relPath);
      if (!bytes) continue;
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      map.set(tex.relPath.split('/').pop(), url);
    } catch {
      // Non-fatal: this single texture just won't resolve; material falls back to default.
    }
  }
  return map;
}

function applyFallbackMaterial(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const hasUsableMaterial = Array.isArray(child.material)
      ? child.material.some((m) => m?.map)
      : Boolean(child.material?.map);
    if (hasUsableMaterial) return;
    const fallback = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.75, metalness: 0.05 });
    child.material = fallback;
  });
}

async function createViewer(canvasEl, opts) {
  const { readFile, meshRelPath, ext, textures } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1e);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(2, 1.5, 2);

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight1.position.set(3, 5, 4);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dirLight2.position.set(-4, -2, -3);
  scene.add(ambient, dirLight1, dirLight2);

  const grid = new THREE.GridHelper(4, 16, 0x444444, 0x2a2a2e);
  scene.add(grid);

  const controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const textureBlobMap = await buildTextureBlobMap(textures, readFile);
  const manager = buildTextureUrlModifier(textureBlobMap);

  const meshBytes = await readFile(meshRelPath);
  if (!meshBytes) throw new Error('mesh_read_failed');
  const arrayBuffer = meshBytes.buffer
    ? meshBytes.buffer.slice(meshBytes.byteOffset, meshBytes.byteOffset + meshBytes.byteLength)
    : meshBytes;

  let object;
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

  applyFallbackMaterial(object);
  scene.add(object);
  frameCameraToObject(camera, controls, object);

  let rafId = null;
  let disposed = false;

  function resize() {
    const w = canvasEl.clientWidth || 1;
    const h = canvasEl.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasEl);
  resize();

  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    controls.dispose();
    disposeScene(scene);
    for (const url of textureBlobMap.values()) {
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return { dispose };
}

window.AvatoolThreeBridge = { createViewer };
window.AvatoolThreeBridgeReadyPromise = Promise.resolve();
window.dispatchEvent(new CustomEvent('avatool-three-bridge-ready'));
