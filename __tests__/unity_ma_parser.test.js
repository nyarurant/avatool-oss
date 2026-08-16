'use strict';

const { parseModularAvatarComponents } = require('../lib/unity_ma_parser');

function mono(fileId, guid, body) {
  return `--- !u!114 &${fileId}\nMonoBehaviour:\n  m_GameObject: {fileID: ${fileId + 1}}\n  m_Script: {fileID: 11500000, guid: ${guid}, type: 3}\n${body}`;
}

describe('unity_ma_parser', () => {
  test('parses Merge Armature target and bone-name mapping', () => {
    const yaml = mono(10, '2df373bf91cf30b4bbd495e11cb1a2ec', `  mergeTarget:\n    referencePath: Armature/Hips\n  prefix: Outfit_\n  suffix: _bone\n  mangleNames: 0\n`);
    expect(parseModularAvatarComponents(yaml, { relPath: 'Dress.prefab' })).toEqual([
      expect.objectContaining({
        type: 'mergeArmature',
        prefabRelPath: 'Dress.prefab',
        mergeTargetPath: 'Armature/Hips',
        prefix: 'Outfit_',
        suffix: '_bone',
        mangleNames: false,
      }),
    ]);
  });

  test('does not consume the next YAML key when prefix and suffix are empty', () => {
    const yaml = mono(11, '2df373bf91cf30b4bbd495e11cb1a2ec', `  mergeTarget:\n    referencePath: Armature\n  prefix: \n  suffix: \n  legacyLocked: 0\n`);
    const [component] = parseModularAvatarComponents(yaml);
    expect(component.prefix).toBe('');
    expect(component.suffix).toBe('');
  });

  test('decodes double-quoted YAML escapes in Modular Avatar scalar fields', () => {
    const yaml = mono(12, '2df373bf91cf30b4bbd495e11cb1a2ec', [
      '  mergeTarget:',
      '    referencePath: Armature',
      '  prefix: "\\u3007\\u3007"',
      '  suffix: "quote\\\"slash\\\\end"',
      '  mangleNames: 1',
      '',
    ].join('\n'));
    const [component] = parseModularAvatarComponents(yaml);
    expect(component.prefix).toBe('〇〇');
    expect(component.suffix).toBe('quote"slash\\end');
  });

  test('parses Shape Changer operations used to hide covered body shapes', () => {
    const yaml = mono(20, '2db441f589c3407bb6fb5f02ff8ab541', `  m_shapes:\n  - Object:\n      referencePath: Body\n    ShapeName: bra_off\n    ChangeType: 1\n    Value: 100\n  m_threshold: 0.01\n`);
    const [component] = parseModularAvatarComponents(yaml);
    expect(component.type).toBe('shapeChanger');
    expect(component.shapes).toEqual([{ objectPath: 'Body', shapeName: 'bra_off', changeType: 1, value: 100 }]);
  });

  test('ignores unrelated MonoBehaviours', () => {
    const yaml = mono(30, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '  value: 1\n');
    expect(parseModularAvatarComponents(yaml)).toEqual([]);
  });
});
