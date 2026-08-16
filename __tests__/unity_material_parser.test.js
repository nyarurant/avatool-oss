'use strict';

const {
  parseUnityMaterial,
  resolveMaterialTexturePaths,
  parseGuidFromMeta,
  detectShaderFamily,
} = require('../lib/unity_material_parser');

const LILTOON_MAT = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  m_Name: Brown
  m_Shader: {fileID: 4800000, guid: 51b2dee0ab07bd84d8147601ff89e511, type: 3}
  m_ShaderKeywords: 
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _AlphaMask:
        m_Texture: {fileID: 2800000, guid: fe3eab327ced5f1438b632ee5295b037, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _BaseMap:
        m_Texture: {fileID: 2800000, guid: 64f95c98792e0c74eb4ee2f44bd9c1e3, type: 3}
        m_Scale: {x: 2, y: 3}
        m_Offset: {x: 0.1, y: 0.2}
    - _BumpMap:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: 64f95c98792e0c74eb4ee2f44bd9c1e3, type: 3}
        m_Scale: {x: 2, y: 3}
        m_Offset: {x: 0.1, y: 0.2}
    - _OutlineWidthMask:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - _AsUnlit: 0
    - _Cull: 0
    - _Cutoff: 0.001
    - _LightMinLimit: 0.2
    - _OutlineWidth: 0.05
    - _RimBlur: 0.05
    - _RimBorder: 0.772
    - _RimFresnelPower: 1
    - _ShadowBlur: 0.17
    - _ShadowBorder: 0.46
    - _Shadow2ndBlur: 0.7
    - _Shadow2ndBorder: 0.228
    - _ShadowStrength: 0.736
    - _TransparentMode: 0
    - _UseRim: 1
    m_Colors:
    - _Color: {r: 1, g: 0.5, b: 0.25, a: 1}
    - _EmissionColor: {r: 0, g: 0, b: 0, a: 1}
    - _MainTexHSVG: {r: 0, g: 1, b: 1, a: 1}
    - _OutlineColor: {r: 0.65882355, g: 0.5058824, b: 0.5121266, a: 1}
    - _OutlineLitColor: {r: 1, g: 0.19999996, b: 0, a: 0}
    - _RimColor: {r: 0.5764706, g: 0.5181959, b: 0.4862745, a: 1}
    - _ShadowColor: {r: 0.5566038, g: 0.43937922, b: 0.4016999, a: 1}
    - _Shadow2ndColor: {r: 0.8862745, g: 0.7821242, b: 0.77254903, a: 0.64}
    - _Shadow3rdColor: {r: 0, g: 0, b: 0, a: 0}
    - _MatCapColor: {r: 1, g: 1, b: 1, a: 1}
    - _BacklightColor: {r: 0.85, g: 0.8, b: 0.7, a: 1}
    - _UseMatCap: 1
    - _MatCapBlend: 1
    - _UseBacklight: 0
    - _UseMain2ndTex: 0
    - _Main2ndEnableLighting: 1
`;

const POIYOMI_MAT = `%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: Body
  m_Shader: {fileID: 4800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
  m_ShaderKeywords: _POI_OUTLINE
  m_SavedProperties:
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - _LineWidth: 0.02
    - _EnableOutlines: 1
    m_Colors:
    - _Color: {r: 0.9, g: 0.8, b: 0.7, a: 1}
    - _OutlineColor: {r: 0, g: 0, b: 0, a: 1}
    - _ThemeColor0: {r: 1, g: 1, b: 1, a: 1}
`;

describe('unity_material_parser', () => {
  test('parseGuidFromMeta extracts 32-char guid', () => {
    const meta = 'fileFormatVersion: 2\nguid: 0c8af2dda80581640b2d9694b870d410\nTextureImporter:\n';
    expect(parseGuidFromMeta(meta)).toBe('0c8af2dda80581640b2d9694b870d410');
  });

  test('detectShaderFamily classifies liltoon / poiyomi', () => {
    expect(detectShaderFamily(LILTOON_MAT)).toBe('liltoon');
    expect(detectShaderFamily(POIYOMI_MAT)).toBe('poiyomi');
    expect(detectShaderFamily('m_Name: x\n- _MainTex:\n')).toBe('standardish');
  });

  test('parseUnityMaterial extracts lilToon main color, tex, outline, cull', () => {
    const mat = parseUnityMaterial(LILTOON_MAT, { relPath: 'ANKA/M/Brown.mat' });
    expect(mat).toBeTruthy();
    expect(mat.name).toBe('Brown');
    expect(mat.shaderFamily).toBe('liltoon');
    expect(mat.color).toEqual([1, 0.5, 0.25, 1]);
    expect(mat.outlineColor[0]).toBeCloseTo(0.65882355);
    expect(mat.outlineWidth).toBeCloseTo(0.05);
    // Must not pick up _OutlineWidthMask as outline width
    expect(mat.outlineWidth).not.toBe(0);
    expect(mat.cutoff).toBeCloseTo(0.001);
    expect(mat.cull).toBe(0);
    expect(mat.mainTexGuid).toBe('64f95c98792e0c74eb4ee2f44bd9c1e3');
    expect(mat.alphaMaskGuid).toBe('fe3eab327ced5f1438b632ee5295b037');
    expect(mat.normalMapGuid).toBeNull();
    expect(mat.mainTexScale).toEqual([2, 3]);
    expect(mat.mainTexOffset[0]).toBeCloseTo(0.1);
    // lilToon toon lighting props
    expect(mat.shadowColor[0]).toBeCloseTo(0.5566038);
    expect(mat.shadow2ndColor[3]).toBeCloseTo(0.64);
    expect(mat.shadowBorder).toBeCloseTo(0.46);
    expect(mat.shadowBlur).toBeCloseTo(0.17);
    expect(mat.shadow2ndBorder).toBeCloseTo(0.228);
    expect(mat.shadowStrength).toBeCloseTo(0.736);
    expect(mat.lightMinLimit).toBeCloseTo(0.2);
    expect(mat.useRim).toBe(1);
    expect(mat.rimBorder).toBeCloseTo(0.772);
    expect(mat.rimColor[0]).toBeCloseTo(0.5764706);
    expect(mat.useMatCap).toBe(1);
    expect(mat.matCapBlend).toBe(1);
    expect(mat.useBacklight).toBe(0);
    expect(mat.shadow3rdColor[3]).toBe(0);
    expect(mat.useMain2nd).toBe(0);
  });

  test('parseUnityMaterial extracts poiyomi-ish props including _LineWidth', () => {
    const mat = parseUnityMaterial(POIYOMI_MAT);
    expect(mat.name).toBe('Body');
    expect(mat.shaderFamily).toBe('poiyomi');
    expect(mat.outlineWidth).toBeCloseTo(0.02);
    expect(mat.mainTexGuid).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  test('parseUnityMaterial decodes double-quoted YAML escapes and preserves single-quoted backslashes', () => {
    const escaped = parseUnityMaterial([
      'Material:',
      '  m_Name: "\\u3007\\u3007\\n\\\"mat\\\""',
      '  m_SavedProperties:',
    ].join('\n'));
    expect(escaped.name).toBe('〇〇\n"mat"');

    const singleQuoted = parseUnityMaterial([
      'Material:',
      "  m_Name: 'literal\\nname'",
      '  m_SavedProperties:',
    ].join('\n'));
    expect(singleQuoted.name).toBe('literal\\nname');
  });

  test('resolveMaterialTexturePaths maps guids to rel paths and keeps liltoon fields', () => {
    const mat = parseUnityMaterial(LILTOON_MAT, { relPath: 'M/Brown.mat' });
    const resolved = resolveMaterialTexturePaths(mat, {
      '64f95c98792e0c74eb4ee2f44bd9c1e3': 'T/Brown.png',
      fe3eab327ced5f1438b632ee5295b037: 'T/o/alpha.png',
    });
    expect(resolved.mainTexRelPath).toBe('T/Brown.png');
    expect(resolved.alphaMaskRelPath).toBe('T/o/alpha.png');
    expect(resolved.normalMapRelPath).toBeNull();
    expect(resolved.name).toBe('Brown');
    expect(resolved.shadowBorder).toBeCloseTo(0.46);
    expect(resolved.shadowColor[1]).toBeCloseTo(0.43937922);
    expect(resolved.useRim).toBe(1);
  });

  test('resolveMaterialTexturePaths works with Map', () => {
    const mat = parseUnityMaterial(LILTOON_MAT);
    const map = new Map([['64f95c98792e0c74eb4ee2f44bd9c1e3', 'tex.png']]);
    const resolved = resolveMaterialTexturePaths(mat, map);
    expect(resolved.mainTexRelPath).toBe('tex.png');
  });

  test('parseUnityMaterial returns null for empty / non-material text', () => {
    expect(parseUnityMaterial('')).toBeNull();
    expect(parseUnityMaterial('not a material')).toBeNull();
  });

  test('parseUnityMaterial falls back to filename when m_Name missing', () => {
    const text = `Material:\n  m_SavedProperties:\n    m_Colors:\n    - _Color: {r: 1, g: 1, b: 1, a: 1}\n    m_TexEnvs:\n    - _MainTex:\n        m_Texture: {fileID: 0}\n`;
    const mat = parseUnityMaterial(text, { relPath: 'Foo/Bar.mat' });
    expect(mat.name).toBe('Bar');
  });
});
