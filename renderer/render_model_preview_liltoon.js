/**
 * lilToon feature-rich approximation for Avatool 3D preview.
 *
 * Not pixel-identical to Unity lilToon — intentionally implements as many
 * .mat-driven features as practical for a single-pass three.js ShaderMaterial:
 *   main + HSVG-ish, main2nd, 1st/2nd/3rd toon shadow (+ shadow color tex),
 *   rim, backlight, matcap, normal map (derivative TBN), alpha mask, emission.
 *
 * Skinning via three.js shader chunks for FBX SkinnedMesh.
 */
import * as THREE from './vendor/three/three.module.js';

const LILTOON_VERTEX = /* glsl */ `
#include <common>
#include <uv_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec3 vWorldPos;

void main() {
  #include <uv_vertex>
  vUv = uv;

  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>

  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;
  // transformedNormal is set by defaultnormal_vertex (after skinnormal) — use it, not raw normal.
  vNormalW = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
  vViewDirW = normalize(cameraPosition - worldPos.xyz);
}
`;

const LILTOON_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uColorA;
uniform sampler2D uMainTex;
uniform float uUseMainTex;
uniform vec2 uMainTexRepeat;
uniform vec2 uMainTexOffset;
// HSVG: x=hue shift (turns), y=sat, z=val, w=gamma-ish (lil uses w as gamma)
uniform vec4 uMainTexHsvg;

uniform sampler2D uMain2ndTex;
uniform float uUseMain2nd;
uniform vec3 uMain2ndColor;
uniform float uMain2ndColorA;
uniform vec2 uMain2ndRepeat;
uniform vec2 uMain2ndOffset;
uniform float uMain2ndBlend;
uniform float uMain2ndBlendMode; // 0 normal, 1 add, 2 screen, 3 multiply (approx)

uniform sampler2D uAlphaMap;
uniform float uUseAlphaMap;
uniform float uAlphaMaskMode;
uniform float uAlphaMaskScale;
uniform float uAlphaMaskValue;
uniform float uCutoff;
uniform float uTransparentMode;

uniform sampler2D uBumpMap;
uniform float uUseBumpMap;
uniform float uBumpScale;

uniform vec3 uShadowColor;
uniform float uShadowColorA;
uniform vec3 uShadow2ndColor;
uniform float uShadow2ndColorA;
uniform vec3 uShadow3rdColor;
uniform float uShadow3rdColorA;
uniform vec3 uShadowBorderColor;
uniform float uShadowBorder;
uniform float uShadowBlur;
uniform float uShadow2ndBorder;
uniform float uShadow2ndBlur;
uniform float uShadow3rdBorder;
uniform float uShadow3rdBlur;
uniform float uShadowStrength;
uniform sampler2D uShadowColorTex;
uniform float uUseShadowColorTex;
uniform sampler2D uShadow2ndColorTex;
uniform float uUseShadow2ndColorTex;
uniform sampler2D uShadow3rdColorTex;
uniform float uUseShadow3rdColorTex;

uniform float uLightMinLimit;
uniform float uAsUnlit;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uAmbient;
// Fill light: keep the approximate three.js preview readable with a key +
// fill directional pair plus trilight ambient, so a single hard directional light here made
// the far side of faces fall into an exaggerated, overly warm shadow band that Unity's actual
// render never showed. Blending in a soft fill term brings the shadow terminator in line.
uniform vec3 uFillLightDir;
uniform float uFillStrength;

uniform vec3 uRimColor;
uniform float uRimColorA;
uniform float uRimBorder;
uniform float uRimBlur;
uniform float uRimFresnelPower;
uniform float uUseRim;
uniform float uRimEnableLighting;

uniform vec3 uBacklightColor;
uniform float uBacklightColorA;
uniform float uUseBacklight;
uniform float uBacklightBorder;
uniform float uBacklightBlur;
uniform float uBacklightDirectivity;

uniform vec3 uMatCapColor;
uniform float uMatCapColorA;
uniform float uUseMatCap;
uniform float uMatCapBlend;
uniform sampler2D uMatCapTex;
uniform float uUseMatCapTex;
uniform sampler2D uMatCapBlendMask;
uniform float uUseMatCapBlendMask;

uniform vec3 uEmissionColor;
uniform float uEmissionIntensity;
uniform sampler2D uEmissionMap;
uniform float uUseEmissionMap;

uniform sampler2D uAoMap;
uniform float uUseAoMap;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec3 vWorldPos;

float lilTooning(float value, float border, float blur) {
  float b = max(blur, 1e-4);
  float borderMin = clamp(border - b * 0.5, 0.0, 1.0);
  float borderMax = clamp(border + b * 0.5, 0.0, 1.0);
  return clamp((borderMax - value) / max(borderMax - borderMin, 1e-5), 0.0, 1.0);
}

// Approximate HSV adjust (lil _MainTexHSVG): hue in turns-ish, sat/val multipliers.
vec3 applyHsvg(vec3 rgb, vec4 hsvg) {
  float hue = hsvg.x;
  float sat = hsvg.y;
  float val = hsvg.z;
  // skip if identity-ish
  if (abs(hue) < 1e-5 && abs(sat - 1.0) < 1e-5 && abs(val - 1.0) < 1e-5) return rgb;

  float cmax = max(rgb.r, max(rgb.g, rgb.b));
  float cmin = min(rgb.r, min(rgb.g, rgb.b));
  float d = cmax - cmin;
  float h = 0.0;
  if (d > 1e-5) {
    if (cmax == rgb.r) h = mod((rgb.g - rgb.b) / d, 6.0);
    else if (cmax == rgb.g) h = (rgb.b - rgb.r) / d + 2.0;
    else h = (rgb.r - rgb.g) / d + 4.0;
    h /= 6.0;
  }
  float s = cmax < 1e-5 ? 0.0 : d / cmax;
  float v = cmax;

  h = fract(h + hue);
  s = clamp(s * sat, 0.0, 1.0);
  v = clamp(v * val, 0.0, 1.0);

  float hh = h * 6.0;
  float sector = floor(hh);
  float f = hh - sector;
  float p = v * (1.0 - s);
  float q = v * (1.0 - s * f);
  float t = v * (1.0 - s * (1.0 - f));
  if (sector < 1.0) return vec3(v, t, p);
  if (sector < 2.0) return vec3(q, v, p);
  if (sector < 3.0) return vec3(p, v, t);
  if (sector < 4.0) return vec3(p, q, v);
  if (sector < 5.0) return vec3(t, p, v);
  return vec3(v, p, q);
}

// Cheap normal map without mesh tangents (screen-space derivatives).
vec3 perturbNormalDeriv(vec3 N, vec3 V, vec2 uv, sampler2D map, float scale) {
  vec3 mapN = texture2D(map, uv).xyz * 2.0 - 1.0;
  mapN.xy *= scale;
  mapN = normalize(mapN);

  vec3 q0 = dFdx(V);
  vec3 q1 = dFdy(V);
  // Use world position derivatives for better stability
  q0 = dFdx(vWorldPos);
  q1 = dFdy(vWorldPos);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);

  vec3 S = normalize(q0 * st1.t - q1 * st0.t);
  vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
  vec3 N2 = normalize(N);
  mat3 tbn = mat3(S, T, N2);
  return normalize(tbn * mapN);
}

vec3 blendLayer(vec3 base, vec4 layer, float blend, float mode) {
  float a = clamp(layer.a * blend, 0.0, 1.0);
  if (a < 1e-4) return base;
  vec3 c = layer.rgb;
  if (mode > 2.5) {
    // multiply
    return mix(base, base * c, a);
  }
  if (mode > 1.5) {
    // screen
    vec3 s = 1.0 - (1.0 - base) * (1.0 - c);
    return mix(base, s, a);
  }
  if (mode > 0.5) {
    // add
    return base + c * a;
  }
  // normal
  return mix(base, c, a);
}

void main() {
  #include <logdepthbuf_fragment>

  vec2 uv = vUv * uMainTexRepeat + uMainTexOffset;
  vec4 tex = (uUseMainTex > 0.5) ? texture2D(uMainTex, uv) : vec4(1.0);
  vec3 albedo = applyHsvg(tex.rgb, uMainTexHsvg) * uColor;
  float alpha = tex.a * uColorA;

  // Main 2nd layer
  if (uUseMain2nd > 0.5) {
    vec2 uv2 = vUv * uMain2ndRepeat + uMain2ndOffset;
    vec4 t2 = texture2D(uMain2ndTex, uv2);
    t2.rgb *= uMain2ndColor;
    t2.a *= uMain2ndColorA;
    albedo = blendLayer(albedo, t2, max(uMain2ndBlend, 1.0), uMain2ndBlendMode);
    alpha = max(alpha, t2.a * max(uMain2ndBlend, 0.0) * 0.25);
  }

  // lilToon applies _AlphaMask to the material alpha even for opaque materials; the
  // opaque pass simply does not use that alpha for a discard. Preserve that behavior
  // so mask-authored assets keep their intended data, but only Cutout/Transparent
  // modes below turn alpha into a pixel discard.
  bool alphaMaskAffectsAlpha = (uUseAlphaMap > 0.5);
  if (alphaMaskAffectsAlpha) {
    vec4 amTx = texture2D(uAlphaMap, uv);
    float am = max(amTx.r, amTx.a);
    float masked = clamp(am * uAlphaMaskScale + uAlphaMaskValue, 0.0, 1.0);
    // lilToon: 1=replace, 2=multiply, 3=add, 4=subtract.
    if (uAlphaMaskMode > 3.5) {
      alpha = clamp(alpha - masked, 0.0, 1.0);
    } else if (uAlphaMaskMode > 2.5) {
      alpha = clamp(alpha + masked, 0.0, 1.0);
    } else if (uAlphaMaskMode > 1.5) {
      alpha *= masked;
    } else if (uAlphaMaskMode > 0.5) {
      alpha = masked;
    }
    // mode 0 + mask present: still multiply lightly for hair atlases
    else {
      alpha *= masked;
    }
  }

  float outA = 1.0;
  // Cutout only in Cutout/Transparent modes. Opaque materials keep their complete
  // authored silhouette even if they carry an _AlphaMask texture.
  bool doCut = (uTransparentMode > 0.5);
  if (doCut) {
    float cut = uCutoff;
    if (uTransparentMode < 0.5) {
      // mask-based cutout (hair): use low threshold so soft edges remain
      cut = clamp(uCutoff, 0.001, 0.2);
    } else if (uTransparentMode < 1.5) {
      cut = clamp(uCutoff, 0.001, 0.99);
    } else {
      cut = max(clamp(uCutoff, 0.001, 0.99), 0.02);
    }
    if (alpha < cut) discard;
  } else {
    alpha = 1.0;
  }

  vec3 N = normalize(vNormalW);
  if (uUseBumpMap > 0.5) {
    N = perturbNormalDeriv(N, vViewDirW, uv, uBumpMap, uBumpScale);
  }
  vec3 V = normalize(vViewDirW);
  // Double-sided: flip normal when viewing backfaces
  if (dot(N, V) < 0.0) N = -N;

  vec3 L = normalize(uLightDir);

  // Half-Lambert, softened by a fill-light term so the shadow terminator isn't a hard
  // single-light edge (matches the key+fill pair used by the real Unity capture).
  float ndlKey = dot(N, L) * 0.5 + 0.5;
  float ndlFill = dot(N, normalize(uFillLightDir)) * 0.5 + 0.5;
  float ndl = clamp(max(ndlKey, ndlFill * uFillStrength), 0.0, 1.0);

  float sh1 = lilTooning(ndl, uShadowBorder, uShadowBlur);
  float sh2 = lilTooning(ndl, uShadow2ndBorder, uShadow2ndBlur);
  float sh3 = lilTooning(ndl, uShadow3rdBorder, uShadow3rdBlur);

  vec3 sh1Col = uShadowColor;
  if (uUseShadowColorTex > 0.5) sh1Col *= texture2D(uShadowColorTex, uv).rgb;
  vec3 sh2Col = uShadow2ndColor;
  if (uUseShadow2ndColorTex > 0.5) sh2Col *= texture2D(uShadow2ndColorTex, uv).rgb;
  vec3 sh3Col = uShadow3rdColor;
  if (uUseShadow3rdColorTex > 0.5) sh3Col *= texture2D(uShadow3rdColorTex, uv).rgb;

  // Gentle toon shade — keep atlas detail readable (heavy bands look like "bad textures").
  float s1 = sh1 * uShadowStrength * clamp(uShadowColorA, 0.0, 1.0) * 0.65;
  float s2 = sh2 * uShadowStrength * clamp(uShadow2ndColorA, 0.0, 1.0) * 0.45;
  float s3 = (uShadow3rdColorA > 0.001) ? (sh3 * uShadowStrength * clamp(uShadow3rdColorA, 0.0, 1.0) * 0.35) : 0.0;
  vec3 col = albedo;
  col = mix(col, albedo * sh1Col, s1);
  col = mix(col, albedo * sh2Col, s2);
  col = mix(col, albedo * sh3Col, s3);

  // Light multiplier ranges [uLightMinLimit .. 1.0], driven directly by the shadow amount —
  // matching real lilToon's own _LightMinLimit behavior (fully lit side = 1.0, fully shadowed
  // side = the material's own LightMinLimit). A previous revision hardcoded a 0.55 floor here
  // "as a safety minimum", which silently overrode every material's real LightMinLimit (e.g. a
  // black jacket authored with LightMinLimit=0.05 could never render darker than 55% brightness)
  // and produced a flat, washed-out "pastel/western cartoon" look instead of proper anime toon
  // shading — reported by the user comparing the three.js approximation against real materials.
  float shade = mix(1.0, clamp(uLightMinLimit, 0.0, 1.0), sh1);
  vec3 lit = col * max(uLightColor * shade, uAmbient * 0.5);
  lit = mix(lit, col, clamp(uAsUnlit, 0.0, 1.0));

  if (uUseAoMap > 0.5) {
    float ao = texture2D(uAoMap, uv).r;
    lit *= mix(1.0, ao, 0.6);
  }

  if (uUseBacklight > 0.5 && uBacklightColorA > 0.001) {
    float ndb = clamp(dot(N, -L) * 0.5 + 0.5, 0.0, 1.0);
    float bl = 1.0 - lilTooning(ndb, uBacklightBorder, max(uBacklightBlur, 1e-4));
    bl = pow(clamp(bl, 0.0, 1.0), max(uBacklightDirectivity * 0.25, 0.01));
    lit += uBacklightColor * bl * uBacklightColorA * 0.5;
  }

  // Rim — only when alpha is high enough to not halo cutout edges
  if (uUseRim > 0.5 && uRimColorA > 0.001 && alpha > 0.5) {
    float nv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - nv, max(uRimFresnelPower, 0.01));
    float rim = 1.0 - lilTooning(fres, uRimBorder, max(uRimBlur, 1e-4));
    rim *= mix(0.25, 0.85, ndl);
    vec3 rimC = uRimColor;
    if (uRimEnableLighting > 0.5) rimC *= uLightColor;
    lit += rimC * rim * uRimColorA * 0.45;
  }

  // MatCap: only when a real matcap texture is bound (never white-add without tex)
  if (uUseMatCap > 0.5 && uUseMatCapTex > 0.5) {
    vec3 vn = normalize(mat3(viewMatrix) * N);
    vec2 muv = vn.xy * 0.5 + 0.5;
    vec3 mc = texture2D(uMatCapTex, muv).rgb * uMatCapColor;
    float mb = uMatCapBlend * clamp(uMatCapColorA, 0.0, 1.0) * 0.5;
    if (uUseMatCapBlendMask > 0.5) mb *= texture2D(uMatCapBlendMask, uv).r;
    lit = mix(lit, lit * mc + mc * 0.15, clamp(mb, 0.0, 1.0));
  }

  if (uEmissionIntensity > 0.001) {
    vec3 em = uEmissionColor;
    if (uUseEmissionMap > 0.5) em *= texture2D(uEmissionMap, uv).rgb;
    lit += em * uEmissionIntensity;
  }

  // Soft clamp only — aggressive Reinhard was washing atlas colors into bands.
  lit = clamp(lit, 0.0, 1.25);

  gl_FragColor = vec4(lit, outA);
  // uMainTex/uMatCapTex/etc. are sRGB textures (hardware-decoded to linear on sample), and all
  // lighting math above runs in linear space — without this, gl_FragColor is written as raw
  // linear values with no re-encode, which renders too dark and skews color-channel contrast
  // (verified: on-screen pixel vs raw texture pixel showed the R/G and R/B gaps roughly doubled
  // versus what a plain multiply-only toon shade could produce, matching a missing sRGB encode).
  #include <colorspace_fragment>
}
`;

function rgba(arr, fallback = [1, 1, 1, 1]) {
  if (!Array.isArray(arr) || arr.length < 3) return fallback.slice();
  return [
    Number.isFinite(+arr[0]) ? +arr[0] : fallback[0],
    Number.isFinite(+arr[1]) ? +arr[1] : fallback[1],
    Number.isFinite(+arr[2]) ? +arr[2] : fallback[2],
    Number.isFinite(+arr[3]) ? +arr[3] : (fallback[3] != null ? fallback[3] : 1),
  ];
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function makeDummyTex(r, g, b, a = 255) {
  const data = new Uint8Array([r, g, b, a]);
  const t = new THREE.DataTexture(data, 1, 1);
  t.needsUpdate = true;
  t.userData = { isDummy: true };
  return t;
}

function setTexUniform(uniforms, mapKey, useKey, tex, dummyFactory) {
  if (tex) {
    uniforms[mapKey].value = tex;
    uniforms[useKey].value = 1;
  } else {
    const d = dummyFactory();
    uniforms[mapKey].value = d;
    uniforms[useKey].value = 0;
    return d;
  }
  return null;
}

/**
 * @param {object} desc resolved material from unity_material_parser
 * @param {object} maps texture maps
 * @returns {THREE.ShaderMaterial}
 */
export function createLilToonMaterial(desc, maps = {}) {
  const color = rgba(desc.color, [1, 1, 1, 1]);
  const sh1 = rgba(desc.shadowColor, [0.7, 0.7, 0.8, 1]);
  const sh2 = rgba(desc.shadow2ndColor, [0.5, 0.5, 0.6, 1]);
  const sh3 = rgba(desc.shadow3rdColor, [0, 0, 0, 0]);
  const borderCol = rgba(desc.shadowBorderColor, [0, 0, 0, 1]);
  const rim = rgba(desc.rimColor, [1, 1, 1, 0]);
  const bl = rgba(desc.backlightColor, [0.85, 0.8, 0.7, 0]);
  const mc = rgba(desc.matCapColor, [1, 1, 1, 1]);
  // _EmissionColor is frequently present (and non-black) even when the material has
  // emission toggled OFF via _UseEmission — a real .mat observed in testing had
  // _EmissionColor=(1,1,1) with _UseEmission=0, which (without this gate) blew the whole
  // surface out to white via the additive `lit += em * emIntensity` term below.
  const emissionEnabled = num(desc.useEmission, 0) > 0.5;
  const em = emissionEnabled ? rgba(desc.emissionColor, [0, 0, 0, 1]) : [0, 0, 0, 1];
  const m2 = rgba(desc.main2ndColor, [1, 1, 1, 1]);
  const hsvg = rgba(desc.mainTexHsvg, [0, 1, 1, 1]);
  const emIntensity = Math.max(em[0], em[1], em[2], 0);

  const tMode = num(desc.transparentMode, 0);
  const cutoff = num(desc.cutoff, 0.5);
  // Prefer cutout (stable) over true transparency for preview — avoids sorting chaos on hair.
  const isTransparent = tMode >= 2.5;
  // Opaque lilToon materials may carry a real alpha mask, but only Cutout/Transparent
  // passes use alpha testing. Keep the map bound for every mode and gate discard by
  // _TransparentMode in the shader.
  const needsAlphaTest = tMode >= 1;

  const dummies = [];
  const uniforms = {
    uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
    uColorA: { value: color[3] },
    uMainTex: { value: null },
    uUseMainTex: { value: 0 },
    uMainTexRepeat: {
      value: new THREE.Vector2(
        Array.isArray(desc.mainTexScale) ? num(desc.mainTexScale[0], 1) : 1,
        Array.isArray(desc.mainTexScale) ? num(desc.mainTexScale[1], 1) : 1
      ),
    },
    uMainTexOffset: {
      value: new THREE.Vector2(
        Array.isArray(desc.mainTexOffset) ? num(desc.mainTexOffset[0], 0) : 0,
        Array.isArray(desc.mainTexOffset) ? num(desc.mainTexOffset[1], 0) : 0
      ),
    },
    uMainTexHsvg: { value: new THREE.Vector4(hsvg[0], hsvg[1], hsvg[2], hsvg[3]) },

    uMain2ndTex: { value: null },
    uUseMain2nd: { value: 0 },
    uMain2ndColor: { value: new THREE.Color(m2[0], m2[1], m2[2]) },
    uMain2ndColorA: { value: m2[3] },
    uMain2ndRepeat: {
      value: new THREE.Vector2(
        Array.isArray(desc.main2ndTexScale) ? num(desc.main2ndTexScale[0], 1) : 1,
        Array.isArray(desc.main2ndTexScale) ? num(desc.main2ndTexScale[1], 1) : 1
      ),
    },
    uMain2ndOffset: {
      value: new THREE.Vector2(
        Array.isArray(desc.main2ndTexOffset) ? num(desc.main2ndTexOffset[0], 0) : 0,
        Array.isArray(desc.main2ndTexOffset) ? num(desc.main2ndTexOffset[1], 0) : 0
      ),
    },
    uMain2ndBlend: { value: num(desc.main2ndBlend, 1) },
    uMain2ndBlendMode: { value: num(desc.main2ndBlendMode, 0) },

    uAlphaMap: { value: null },
    uUseAlphaMap: { value: 0 },
    uAlphaMaskMode: { value: num(desc.alphaMaskMode, 1) },
    uAlphaMaskScale: { value: num(desc.alphaMaskScale, 1) },
    uAlphaMaskValue: { value: num(desc.alphaMaskValue, 0) },
    uCutoff: { value: cutoff },
    uTransparentMode: { value: tMode },

    uBumpMap: { value: null },
    uUseBumpMap: { value: 0 },
    uBumpScale: { value: num(desc.bumpScale, 1) },

    uShadowColor: { value: new THREE.Color(sh1[0], sh1[1], sh1[2]) },
    uShadowColorA: { value: sh1[3] },
    uShadow2ndColor: { value: new THREE.Color(sh2[0], sh2[1], sh2[2]) },
    uShadow2ndColorA: { value: sh2[3] },
    uShadow3rdColor: { value: new THREE.Color(sh3[0], sh3[1], sh3[2]) },
    uShadow3rdColorA: { value: sh3[3] },
    uShadowBorderColor: { value: new THREE.Color(borderCol[0], borderCol[1], borderCol[2]) },
    uShadowBorder: { value: num(desc.shadowBorder, 0.5) },
    uShadowBlur: { value: num(desc.shadowBlur, 0.1) },
    uShadow2ndBorder: { value: num(desc.shadow2ndBorder, 0.3) },
    uShadow2ndBlur: { value: num(desc.shadow2ndBlur, 0.1) },
    uShadow3rdBorder: { value: num(desc.shadow3rdBorder, 0.15) },
    uShadow3rdBlur: { value: num(desc.shadow3rdBlur, 0.1) },
    uShadowStrength: { value: Math.min(num(desc.shadowStrength, 0.85), 1) },
    uShadowColorTex: { value: null },
    uUseShadowColorTex: { value: 0 },
    uShadow2ndColorTex: { value: null },
    uUseShadow2ndColorTex: { value: 0 },
    uShadow3rdColorTex: { value: null },
    uUseShadow3rdColorTex: { value: 0 },

    uLightMinLimit: { value: num(desc.lightMinLimit, 0.2) },
    uAsUnlit: { value: num(desc.asUnlit, 0) },
    uLightDir: { value: new THREE.Vector3(0.45, 0.85, 0.4).normalize() },
    uLightColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    uAmbient: { value: 0.42 },
    uFillLightDir: { value: new THREE.Vector3(-0.45, -0.3, -0.4).normalize() },
    uFillStrength: { value: 0.55 },

    uRimColor: { value: new THREE.Color(rim[0], rim[1], rim[2]) },
    uRimColorA: { value: rim[3] },
    uRimBorder: { value: num(desc.rimBorder, 0.5) },
    uRimBlur: { value: num(desc.rimBlur, 0.05) },
    uRimFresnelPower: { value: num(desc.rimFresnelPower, 3) },
    // Only enable rim when mat explicitly turned it on (avoid default wash)
    uUseRim: { value: num(desc.useRim, 0) > 0.5 ? 1 : 0 },
    uRimEnableLighting: { value: num(desc.rimEnableLighting, 1) },

    uBacklightColor: { value: new THREE.Color(bl[0], bl[1], bl[2]) },
    uBacklightColorA: { value: bl[3] },
    // lilToon's backlight is mask-, normal-, and pass-dependent. Our single-pass
    // approximation was adding it as a broad white rear halo, which washed out the
    // back of full avatars (especially hair). Keep the material data, but do not
    // enable this incomplete approximation in the normal preview path.
    uUseBacklight: { value: 0 },
    uBacklightBorder: { value: num(desc.backlightBorder, 0.35) },
    uBacklightBlur: { value: num(desc.backlightBlur, 0.05) },
    uBacklightDirectivity: { value: num(desc.backlightDirectivity, 5) },

    uMatCapColor: { value: new THREE.Color(mc[0], mc[1], mc[2]) },
    uMatCapColorA: { value: mc[3] },
    // MatCap only when a real texture exists — mask-alone + white dummy looked "blown out"
    uUseMatCap: {
      value: (num(desc.useMatCap, 0) > 0.5 && maps.matCap) ? 1 : 0,
    },
    uMatCapBlend: { value: num(desc.matCapBlend, 1) },
    uMatCapTex: { value: null },
    uUseMatCapTex: { value: 0 },
    uMatCapBlendMask: { value: null },
    uUseMatCapBlendMask: { value: 0 },

    uEmissionColor: { value: new THREE.Color(em[0], em[1], em[2]) },
    uEmissionIntensity: { value: emIntensity > 0.001 ? Math.min(emIntensity * 2, 3) : 0 },
    uEmissionMap: { value: null },
    uUseEmissionMap: { value: 0 },

    uAoMap: { value: null },
    uUseAoMap: { value: 0 },
  };

  const pushD = (d) => { if (d) dummies.push(d); };
  pushD(setTexUniform(uniforms, 'uMainTex', 'uUseMainTex', maps.main || null, () => makeDummyTex(255, 255, 255)));
  // Main2nd only if enabled in mat AND texture present
  const useM2 = num(desc.useMain2nd, 0) > 0.5 && maps.main2nd;
  pushD(setTexUniform(uniforms, 'uMain2ndTex', 'uUseMain2nd', useM2 ? maps.main2nd : null, () => makeDummyTex(255, 255, 255)));
  if (!useM2) uniforms.uUseMain2nd.value = 0;

  pushD(setTexUniform(uniforms, 'uAlphaMap', 'uUseAlphaMap', maps.alpha || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uBumpMap', 'uUseBumpMap', maps.normal || null, () => makeDummyTex(128, 128, 255)));
  pushD(setTexUniform(uniforms, 'uShadowColorTex', 'uUseShadowColorTex', maps.shadow1 || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uShadow2ndColorTex', 'uUseShadow2ndColorTex', maps.shadow2 || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uShadow3rdColorTex', 'uUseShadow3rdColorTex', maps.shadow3 || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uMatCapTex', 'uUseMatCapTex', maps.matCap || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uMatCapBlendMask', 'uUseMatCapBlendMask', maps.matCapMask || null, () => makeDummyTex(255, 255, 255)));
  pushD(setTexUniform(uniforms, 'uEmissionMap', 'uUseEmissionMap', maps.emission || null, () => makeDummyTex(0, 0, 0)));
  pushD(setTexUniform(uniforms, 'uAoMap', 'uUseAoMap', maps.ao || null, () => makeDummyTex(255, 255, 255)));

  // If matcap enabled but no tex, still allow flat color add (rare)
  if (uniforms.uUseMatCap.value > 0.5 && !maps.matCap && !maps.matCapMask) {
    // MatCap without tex often means "use white sphere" — keep path with white dummy
    uniforms.uUseMatCapTex.value = 0;
  }

  const mat = new THREE.ShaderMaterial({
    name: desc.name || 'LilToonApprox',
    uniforms,
    vertexShader: LILTOON_VERTEX,
    fragmentShader: LILTOON_FRAGMENT,
    side: (() => {
      const c = Number(desc.cull);
      if (c === 0) return THREE.DoubleSide;
      if (c === 1) return THREE.BackSide;
      return THREE.FrontSide;
    })(),
    transparent: isTransparent,
    depthWrite: true,
    // three.js alphaTest is extra discard — only for true cutout/mask mats
    alphaTest: needsAlphaTest
      ? Math.min(Math.max(Number.isFinite(cutoff) && cutoff > 0 ? Math.min(cutoff, 0.2) : 0.02, 0.001), 0.5)
      : 0,
    lights: false,
    fog: false,
    extensions: { derivatives: true },
  });

  mat.skinning = true;
  mat.userData.isLilToonApprox = true;
  mat.userData.approxFrom = 'liltoon';
  mat.userData.outlineColor = desc.outlineColor;
  mat.userData.outlineWidth = desc.outlineWidth;
  mat.userData.dummyTextures = dummies;

  return mat;
}

export function syncLilToonLightUniforms(root, lightDir, opts = {}) {
  if (!root) return;
  const dir = lightDir?.isVector3
    ? lightDir.clone().normalize()
    : new THREE.Vector3(0.4, 0.8, 0.5).normalize();
  root.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m?.userData?.isLilToonApprox || !m.uniforms?.uLightDir) continue;
      m.uniforms.uLightDir.value.copy(dir);
      if (opts.lightColor && m.uniforms.uLightColor) {
        m.uniforms.uLightColor.value.copy(opts.lightColor);
      }
      if (opts.ambient != null && m.uniforms.uAmbient) {
        m.uniforms.uAmbient.value = opts.ambient;
      }
      if (opts.fillLightDir?.isVector3 && m.uniforms.uFillLightDir) {
        m.uniforms.uFillLightDir.value.copy(opts.fillLightDir).normalize();
      }
      if (opts.fillStrength != null && m.uniforms.uFillStrength) {
        m.uniforms.uFillStrength.value = opts.fillStrength;
      }
    }
  });
}

export function disposeLilToonMaterial(mat) {
  if (!mat?.userData?.isLilToonApprox) return;
  for (const t of mat.userData.dummyTextures || []) {
    t?.dispose?.();
  }
}
