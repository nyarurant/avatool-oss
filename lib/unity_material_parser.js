'use strict';

/**
 * Lightweight Unity .mat (YAML) parser for model-preview approximation.
 * Targets lilToon / Poiyomi / Standard-ish property sets without a full YAML dependency.
 *
 * Goal: extract as many preview-relevant props as practical — fidelity is approximate.
 */

const MAIN_TEX_PROPS = ['_MainTex', '_BaseMap', '_BaseColorMap', '_BaseColorTexture'];
const MAIN2_TEX_PROPS = ['_Main2ndTex'];
const NORMAL_TEX_PROPS = ['_BumpMap', '_NormalMap'];
const ALPHA_TEX_PROPS = ['_AlphaMask', '_CutoffMask'];
const EMISSION_TEX_PROPS = ['_EmissionMap', '_EmissionMap2'];
const OUTLINE_TEX_PROPS = ['_OutlineTex', '_OutlineTexture'];
const SHADOW1_TEX_PROPS = ['_ShadowColorTex', '_Shadow1stColorTex'];
const SHADOW2_TEX_PROPS = ['_Shadow2ndColorTex'];
const SHADOW3_TEX_PROPS = ['_Shadow3rdColorTex'];
const MATCAP_TEX_PROPS = ['_MatCapTex', '_MatCap'];
const MATCAP_MASK_PROPS = ['_MatCapBlendMask'];
const AO_TEX_PROPS = ['_AOMap', '_OcclusionMap'];

const COLOR_PROPS_MAIN = ['_Color', '_MainColor', '_BaseColor', '_ColorThemeR'];
const COLOR_PROPS_MAIN2 = ['_Main2ndColor', '_Color2nd'];
const COLOR_PROPS_OUTLINE = ['_OutlineColor', '_LineColor'];
const COLOR_PROPS_EMISSION = ['_EmissionColor', '_EmissionColorThemeR'];
const COLOR_PROPS_SHADOW1 = ['_ShadowColor', '_Shadow1stColor'];
const COLOR_PROPS_SHADOW2 = ['_Shadow2ndColor'];
const COLOR_PROPS_SHADOW3 = ['_Shadow3rdColor'];
const COLOR_PROPS_RIM = ['_RimColor'];
const COLOR_PROPS_BACKLIGHT = ['_BacklightColor'];
const COLOR_PROPS_MATCAP = ['_MatCapColor'];
const COLOR_PROPS_SHADOW_BORDER = ['_ShadowBorderColor'];
const COLOR_PROPS_HSVG = ['_MainTexHSVG'];

const FLOAT_OUTLINE_WIDTH = ['_OutlineWidth', '_LineWidth', '_OutlineWidthMultiplier'];
const FLOAT_CUTOFF = ['_Cutoff', '_AlphaClipValue', '_CutoffMax'];
const FLOAT_CULL = ['_Cull', '_CullMode'];
const FLOAT_TRANSPARENT = ['_TransparentMode', '_Mode', '_Surface'];

function parseYamlScalar(value) {
  const raw = String(value).trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(?:["\\ntr0]|u[0-9a-fA-F]{4})/g, (escape) => {
      const code = escape[1];
      if (code === 'u') return String.fromCharCode(Number.parseInt(escape.slice(2), 16));
      if (code === '"') return '"';
      if (code === '\\') return '\\';
      if (code === 'n') return '\n';
      if (code === 't') return '\t';
      if (code === 'r') return '\r';
      return '\0';
    });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function scalar(body, key, fallback = '') {
  const match = String(body || '').match(new RegExp('^[ \\t]*' + key + ':[ \\t]*(.*)$', 'm'));
  return match ? parseYamlScalar(match[1]) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractNamedColor(text, propNames) {
  for (const prop of propNames) {
    const re = new RegExp(
      `- ${escapeRegExp(prop)}:\\s*\\{r:\\s*([-\\d.eE+]+),\\s*g:\\s*([-\\d.eE+]+),\\s*b:\\s*([-\\d.eE+]+),\\s*a:\\s*([-\\d.eE+]+)\\}`
    );
    const m = text.match(re);
    if (!m) continue;
    return [
      toFiniteNumber(m[1], 1),
      toFiniteNumber(m[2], 1),
      toFiniteNumber(m[3], 1),
      toFiniteNumber(m[4], 1),
    ];
  }
  return null;
}

function extractNamedFloat(text, propNames) {
  for (const prop of propNames) {
    const re = new RegExp(`- ${escapeRegExp(prop)}:\\s*([-\\d.eE+]+)\\s*$`, 'm');
    const m = text.match(re);
    if (!m) continue;
    return toFiniteNumber(m[1], null);
  }
  return null;
}

function extractTextureGuid(text, propNames) {
  for (const prop of propNames) {
    const re = new RegExp(
      `- ${escapeRegExp(prop)}:[\\s\\S]*?m_Texture:\\s*\\{([^}]+)\\}`
    );
    const m = text.match(re);
    if (!m) continue;
    if (/\bfileID:\s*0\b/.test(m[1]) && !/guid:/.test(m[1])) return null;
    const g = m[1].match(/guid:\s*([a-f0-9]{32})/i);
    if (g) return g[1].toLowerCase();
  }
  return null;
}

function extractTextureScaleOffset(text, propNames) {
  for (const prop of propNames) {
    const re = new RegExp(
      `- ${escapeRegExp(prop)}:[\\s\\S]*?m_Scale:\\s*\\{x:\\s*([-\\d.eE+]+),\\s*y:\\s*([-\\d.eE+]+)\\}[\\s\\S]*?m_Offset:\\s*\\{x:\\s*([-\\d.eE+]+),\\s*y:\\s*([-\\d.eE+]+)\\}`
    );
    const m = text.match(re);
    if (!m) continue;
    return {
      scale: [toFiniteNumber(m[1], 1), toFiniteNumber(m[2], 1)],
      offset: [toFiniteNumber(m[3], 0), toFiniteNumber(m[4], 0)],
    };
  }
  return { scale: [1, 1], offset: [0, 0] };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectShaderFamily(text) {
  const t = String(text || '');
  if (
    /_MainTexHSVG:|_lilShadowColor:|_OutlineLitColor:|_UseClippingCanceller:|_Shadow2ndColor:|_ShadowBorder:/.test(t)
  ) {
    return 'liltoon';
  }
  if (
    /_ThemeColor0:|_LightingCap:|_EnableOutlines:|_POI_/.test(t) ||
    /m_ShaderKeywords:.*\bPOI/i.test(t)
  ) {
    return 'poiyomi';
  }
  if (/_MainTex:|_BaseMap:|_Color:/.test(t)) return 'standardish';
  return 'unknown';
}

/**
 * @param {string} yamlText raw .mat file contents
 * @param {{ relPath?: string }} [opts]
 * @returns {object|null}
 */
function parseUnityMaterial(yamlText, opts = {}) {
  const text = String(yamlText || '');
  if (!text.includes('Material:') && !text.includes('m_SavedProperties:')) return null;

  const nameFromYaml = scalar(text, 'm_Name', '');
  const nameFromPath = opts.relPath
    ? String(opts.relPath)
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.mat$/i, '')
        .replace(/\.asset$/i, '')
    : '';
  const name = String(nameFromYaml || nameFromPath || '').trim();
  if (!name) return null;
  // Reject non-material YAML that slipped through (e.g. VRCExpressionsMenu .asset)
  if (!/Material:|m_SavedProperties:|m_Shader:/.test(text)) return null;

  const shaderGuidMatch = text.match(/m_Shader:\s*\{[^}]*guid:\s*([a-f0-9]{32})/i);
  const mainTexGuid = extractTextureGuid(text, MAIN_TEX_PROPS);
  const mainTexUv = extractTextureScaleOffset(text, MAIN_TEX_PROPS);
  const main2Uv = extractTextureScaleOffset(text, MAIN2_TEX_PROPS);

  const useRim = extractNamedFloat(text, ['_UseRim']);
  const asUnlit = extractNamedFloat(text, ['_AsUnlit']);
  const useMatCap = extractNamedFloat(text, ['_UseMatCap']);
  const useMain2nd = extractNamedFloat(text, ['_UseMain2ndTex']);
  const useBacklight = extractNamedFloat(text, ['_UseBacklight']);
  // _EmissionColor is often present (and non-black) even when emission itself is toggled
  // off via _UseEmission — must gate on the toggle, not just "is the color non-zero".
  const useEmission = extractNamedFloat(text, ['_UseEmission']);

  return {
    name,
    relPath: opts.relPath || null,
    shaderGuid: shaderGuidMatch ? shaderGuidMatch[1].toLowerCase() : null,
    shaderFamily: detectShaderFamily(text),
    color: extractNamedColor(text, COLOR_PROPS_MAIN) || [1, 1, 1, 1],
    outlineColor: extractNamedColor(text, COLOR_PROPS_OUTLINE),
    emissionColor: extractNamedColor(text, COLOR_PROPS_EMISSION),
    useEmission: useEmission == null ? null : useEmission,
    outlineWidth: extractNamedFloat(text, FLOAT_OUTLINE_WIDTH),
    cutoff: extractNamedFloat(text, FLOAT_CUTOFF),
    cull: extractNamedFloat(text, FLOAT_CULL),
    transparentMode: extractNamedFloat(text, FLOAT_TRANSPARENT),
    mainTexGuid,
    mainTexScale: mainTexUv.scale,
    mainTexOffset: mainTexUv.offset,
    normalMapGuid: extractTextureGuid(text, NORMAL_TEX_PROPS),
    alphaMaskGuid: extractTextureGuid(text, ALPHA_TEX_PROPS),
    emissionMapGuid: extractTextureGuid(text, EMISSION_TEX_PROPS),
    outlineTexGuid: extractTextureGuid(text, OUTLINE_TEX_PROPS),

    // lilToon toon lighting
    shadowColor: extractNamedColor(text, COLOR_PROPS_SHADOW1),
    shadow2ndColor: extractNamedColor(text, COLOR_PROPS_SHADOW2),
    shadow3rdColor: extractNamedColor(text, COLOR_PROPS_SHADOW3),
    shadowBorderColor: extractNamedColor(text, COLOR_PROPS_SHADOW_BORDER),
    shadowBorder: extractNamedFloat(text, ['_ShadowBorder', '_Shadow1stBorder']),
    shadowBlur: extractNamedFloat(text, ['_ShadowBlur', '_Shadow1stBlur']),
    shadow2ndBorder: extractNamedFloat(text, ['_Shadow2ndBorder']),
    shadow2ndBlur: extractNamedFloat(text, ['_Shadow2ndBlur']),
    shadow3rdBorder: extractNamedFloat(text, ['_Shadow3rdBorder']),
    shadow3rdBlur: extractNamedFloat(text, ['_Shadow3rdBlur']),
    shadowStrength: extractNamedFloat(text, ['_ShadowStrength']),
    shadowMainStrength: extractNamedFloat(text, ['_ShadowMainStrength']),
    shadowEnvStrength: extractNamedFloat(text, ['_ShadowEnvStrength']),
    shadowColorTexGuid: extractTextureGuid(text, SHADOW1_TEX_PROPS),
    shadow2ndColorTexGuid: extractTextureGuid(text, SHADOW2_TEX_PROPS),
    shadow3rdColorTexGuid: extractTextureGuid(text, SHADOW3_TEX_PROPS),
    lightMinLimit: extractNamedFloat(text, ['_LightMinLimit']),
    asUnlit: asUnlit == null ? null : asUnlit,

    // rim / backlight
    rimColor: extractNamedColor(text, COLOR_PROPS_RIM),
    rimBorder: extractNamedFloat(text, ['_RimBorder']),
    rimBlur: extractNamedFloat(text, ['_RimBlur']),
    rimFresnelPower: extractNamedFloat(text, ['_RimFresnelPower']),
    useRim: useRim == null ? null : useRim,
    rimEnableLighting: extractNamedFloat(text, ['_RimEnableLighting']),
    backlightColor: extractNamedColor(text, COLOR_PROPS_BACKLIGHT),
    useBacklight: useBacklight == null ? null : useBacklight,
    backlightBorder: extractNamedFloat(text, ['_BacklightBorder']),
    backlightBlur: extractNamedFloat(text, ['_BacklightBlur']),
    backlightDirectivity: extractNamedFloat(text, ['_BacklightDirectivity']),

    // matcap
    matCapColor: extractNamedColor(text, COLOR_PROPS_MATCAP),
    useMatCap: useMatCap == null ? null : useMatCap,
    matCapBlend: extractNamedFloat(text, ['_MatCapBlend']),
    matCapTexGuid: extractTextureGuid(text, MATCAP_TEX_PROPS),
    matCapBlendMaskGuid: extractTextureGuid(text, MATCAP_MASK_PROPS),
    matCapNormalStrength: extractNamedFloat(text, ['_MatCapNormalStrength']),

    // main 2nd layer
    useMain2nd: useMain2nd == null ? null : useMain2nd,
    main2ndColor: extractNamedColor(text, COLOR_PROPS_MAIN2),
    main2ndTexGuid: extractTextureGuid(text, MAIN2_TEX_PROPS),
    main2ndTexScale: main2Uv.scale,
    main2ndTexOffset: main2Uv.offset,
    main2ndBlend: extractNamedFloat(text, ['_Main2ndBlend', '_Main2ndTexAngle']),
    main2ndBlendMode: extractNamedFloat(text, ['_Main2ndTex_BlendMode', '_Main2ndBlendMode']),
    main2ndEnableLighting: extractNamedFloat(text, ['_Main2ndEnableLighting']),

    // misc
    mainTexHsvg: extractNamedColor(text, COLOR_PROPS_HSVG),
    alphaMaskMode: extractNamedFloat(text, ['_AlphaMaskMode']),
    alphaMaskScale: extractNamedFloat(text, ['_AlphaMaskScale']),
    alphaMaskValue: extractNamedFloat(text, ['_AlphaMaskValue']),
    bumpScale: extractNamedFloat(text, ['_BumpScale']),
    aoMapGuid: extractTextureGuid(text, AO_TEX_PROPS),
    outlineEnableLighting: extractNamedFloat(text, ['_OutlineEnableLighting']),
  };
}

/**
 * Resolve GUID texture refs against a guid -> relPath map (paths relative to Assets/).
 * @param {object} mat parseUnityMaterial result
 * @param {Record<string, string>|Map<string,string>} guidMap
 */
function resolveMaterialTexturePaths(mat, guidMap) {
  if (!mat) return null;
  const lookup = (guid) => {
    if (!guid) return null;
    const key = String(guid).toLowerCase();
    if (guidMap instanceof Map) return guidMap.get(key) || null;
    return guidMap[key] || null;
  };

  return {
    name: mat.name,
    relPath: mat.relPath,
    shaderGuid: mat.shaderGuid,
    shaderFamily: mat.shaderFamily,
    color: mat.color,
    outlineColor: mat.outlineColor,
    emissionColor: mat.emissionColor,
    outlineWidth: mat.outlineWidth,
    cutoff: mat.cutoff,
    cull: mat.cull,
    transparentMode: mat.transparentMode,
    mainTexRelPath: lookup(mat.mainTexGuid),
    mainTexScale: mat.mainTexScale,
    mainTexOffset: mat.mainTexOffset,
    normalMapRelPath: lookup(mat.normalMapGuid),
    alphaMaskRelPath: lookup(mat.alphaMaskGuid),
    emissionMapRelPath: lookup(mat.emissionMapGuid),
    outlineTexRelPath: lookup(mat.outlineTexGuid),

    shadowColor: mat.shadowColor,
    shadow2ndColor: mat.shadow2ndColor,
    shadow3rdColor: mat.shadow3rdColor,
    shadowBorderColor: mat.shadowBorderColor,
    shadowBorder: mat.shadowBorder,
    shadowBlur: mat.shadowBlur,
    shadow2ndBorder: mat.shadow2ndBorder,
    shadow2ndBlur: mat.shadow2ndBlur,
    shadow3rdBorder: mat.shadow3rdBorder,
    shadow3rdBlur: mat.shadow3rdBlur,
    shadowStrength: mat.shadowStrength,
    shadowMainStrength: mat.shadowMainStrength,
    shadowEnvStrength: mat.shadowEnvStrength,
    shadowColorTexRelPath: lookup(mat.shadowColorTexGuid),
    shadow2ndColorTexRelPath: lookup(mat.shadow2ndColorTexGuid),
    shadow3rdColorTexRelPath: lookup(mat.shadow3rdColorTexGuid),
    lightMinLimit: mat.lightMinLimit,
    asUnlit: mat.asUnlit,

    rimColor: mat.rimColor,
    rimBorder: mat.rimBorder,
    rimBlur: mat.rimBlur,
    rimFresnelPower: mat.rimFresnelPower,
    useRim: mat.useRim,
    rimEnableLighting: mat.rimEnableLighting,
    backlightColor: mat.backlightColor,
    useBacklight: mat.useBacklight,
    backlightBorder: mat.backlightBorder,
    backlightBlur: mat.backlightBlur,
    backlightDirectivity: mat.backlightDirectivity,

    matCapColor: mat.matCapColor,
    useMatCap: mat.useMatCap,
    matCapBlend: mat.matCapBlend,
    matCapTexRelPath: lookup(mat.matCapTexGuid),
    matCapBlendMaskRelPath: lookup(mat.matCapBlendMaskGuid),
    matCapNormalStrength: mat.matCapNormalStrength,

    useMain2nd: mat.useMain2nd,
    main2ndColor: mat.main2ndColor,
    main2ndTexRelPath: lookup(mat.main2ndTexGuid),
    main2ndTexScale: mat.main2ndTexScale,
    main2ndTexOffset: mat.main2ndTexOffset,
    main2ndBlend: mat.main2ndBlend,
    main2ndBlendMode: mat.main2ndBlendMode,
    main2ndEnableLighting: mat.main2ndEnableLighting,

    mainTexHsvg: mat.mainTexHsvg,
    alphaMaskMode: mat.alphaMaskMode,
    alphaMaskScale: mat.alphaMaskScale,
    alphaMaskValue: mat.alphaMaskValue,
    bumpScale: mat.bumpScale,
    aoMapRelPath: lookup(mat.aoMapGuid),
    outlineEnableLighting: mat.outlineEnableLighting,
  };
}

function parseGuidFromMeta(metaText) {
  const m = String(metaText || '').match(/guid:\s*([a-f0-9]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

module.exports = {
  parseUnityMaterial,
  resolveMaterialTexturePaths,
  parseGuidFromMeta,
  detectShaderFamily,
  MAIN_TEX_PROPS,
};
