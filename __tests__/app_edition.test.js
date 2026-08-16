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
});
