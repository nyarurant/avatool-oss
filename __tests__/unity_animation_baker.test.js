'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureBakeScript, readBake, runExclusiveForProject } = require('../lib/unity_animation_baker');

describe('Unity animation pose baker', () => {
  let project;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-animation-bake-test-'));
  });

  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  test('installs the editor baker and samples Humanoid bone deltas', () => {
    expect(ensureBakeScript(project)).toEqual({ ok: true });
    const destination = path.join(project, 'Assets', 'Avatool', 'Editor', 'AvatoolAnimationBake.cs');
    const source = fs.readFileSync(destination, 'utf8');
    expect(source).toContain('AnimationMode.SampleAnimationClip');
    expect(source).toContain('Quaternion.Inverse(bone.restRotation) * bone.transform.localRotation');
    expect(source).toContain('humanBone = row.Value.ToString()');
    expect(source).toContain('ImportPackageImmediately');
  });

  test('accepts only non-empty frame payloads with bone arrays', () => {
    const output = path.join(project, 'pose.json');
    fs.writeFileSync(output, JSON.stringify({
      sampleRate: 60,
      frames: [{ time: 0, bones: [{ path: 'Armature/Hips', humanBone: 'Hips' }] }],
    }));
    expect(readBake(output)).toMatchObject({ sampleRate: 60 });
    fs.writeFileSync(output, JSON.stringify({ sampleRate: 60, frames: [] }));
    expect(readBake(output)).toBeNull();
  });

  test('wires the exact bake through IPC, preload, and the preview runtime', () => {
    const root = path.join(__dirname, '..');
    const ipc = fs.readFileSync(path.join(root, 'lib', 'ipc_handlers.js'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    const preview = fs.readFileSync(path.join(root, 'renderer', 'render_model_preview.js'), 'utf8');
    expect(ipc).toContain("handleIpc('bake-unity-animation-preview'");
    expect(preload).toContain("ipcRenderer.invoke('bake-unity-animation-preview', payload)");
    expect(preview).toContain('viewerHandle.applyExternalBonePoses?.(frames[frameIndex])');
    expect(preview).toContain('exactUnityPose: true');
    expect(fs.readFileSync(path.join(root, 'lib', 'unity_animation_baker.js'), 'utf8'))
      .toContain('await waitForProjectUnlock(projectPath)');
  });

  // Different clips hash to different inFlight keys but share one Unity project
  // per package, so they must not launch two Editors against it at once.
  test('serializes bakes that target the same dedicated Unity project', async () => {
    const order = [];
    let concurrent = 0;
    let peak = 0;
    const task = (label) => async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      order.push(`start:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${label}`);
      concurrent -= 1;
      return label;
    };
    const results = await Promise.all([
      runExclusiveForProject('/project/a', task('first')),
      runExclusiveForProject('/project/a', task('second')),
    ]);
    expect(results).toEqual(['first', 'second']);
    expect(peak).toBe(1);
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  test('a failed bake does not block the next one on the same project', async () => {
    await expect(runExclusiveForProject('/project/b', async () => {
      throw new Error('bake_failed');
    })).rejects.toThrow('bake_failed');
    await expect(runExclusiveForProject('/project/b', async () => 'recovered')).resolves.toBe('recovered');
  });

  test('different projects are not serialized against each other', async () => {
    let concurrent = 0;
    let peak = 0;
    const task = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent -= 1;
    };
    await Promise.all([
      runExclusiveForProject('/project/c', task),
      runExclusiveForProject('/project/d', task),
    ]);
    expect(peak).toBe(2);
  });
});
