'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectAppEdition } = require('../lib/app_edition');

describe('app edition', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-edition-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('defaults to standard', () => {
    expect(detectAppEdition({ fs, path, env: {}, resourcesPath: root })).toBe('standard');
  });

  test('reads owner edition from packaged manifest', () => {
    fs.writeFileSync(path.join(root, 'edition.json'), JSON.stringify({ edition: 'owner' }));
    expect(detectAppEdition({ fs, path, env: {}, resourcesPath: root })).toBe('owner');
  });

  test('environment override wins', () => {
    fs.writeFileSync(path.join(root, 'edition.json'), JSON.stringify({ edition: 'standard' }));
    expect(detectAppEdition({ fs, path, env: { AVATOOL_EDITION: 'owner' }, resourcesPath: root })).toBe('owner');
  });

  test('owner builder uses a separate app id and includes only the owner client module', () => {
    const config = require('../owner-build/electron-builder.owner');
    const standardFiles = require('../package.json').build.files;
    expect(config.appId).toBe('xyz.necco.avatool.owner');
    expect(config.productName).toBe('Avatool Owner');
    expect(config.directories.output).toBe('release-owner');
    expect(standardFiles).toContain('!lib/owner_vault/**');
    expect(config.files).not.toContain('!lib/owner_vault/**');
    expect(standardFiles).toContain('!owner/**');
    expect(config.files).not.toContain('!owner/**');
    expect(config.files).toContain('!owner-server/**');
  });
});
