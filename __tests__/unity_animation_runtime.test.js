const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runtimePath = path.join(__dirname, '..', 'renderer', 'render_unity_animation_runtime.js');

function readRuntimeMath() {
  const runner = String.raw`
    import fs from 'node:fs';
    const source = fs.readFileSync(process.argv[1], 'utf8')
      .replace(/^import \* as THREE from .*;$/m, 'const THREE = { MathUtils: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) } };')
      .replace('export function createUnityAnimationRuntime', 'function createUnityAnimationRuntime')
      + '\nexport { muscleBinding, muscleDegrees, sampleTime };';
    const runtime = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const names = [
      'Left Forearm Stretch',
      'Right Forearm Stretch',
      'Left Lower Leg Stretch',
      'Right Lower Leg Stretch',
      'Left Arm Down-Up',
      'Right Arm Front-Back',
      'Left Upper Leg Front-Back',
      'LeftHand.Index.1 Stretched',
    ];
    const bindings = Object.fromEntries(names.map((name) => [name, runtime.muscleBinding(name)]));
    const degrees = Object.fromEntries(names.map((name) => [name, {
      straight: runtime.muscleDegrees(bindings[name], 1),
      middle: runtime.muscleDegrees(bindings[name], 0),
      folded: runtime.muscleDegrees(bindings[name], -1),
    }]));
    const loopClip = { startTime: 0, stopTime: 1, loopTime: true };
    process.stdout.write(JSON.stringify({
      bindings,
      degrees,
      clipDefaultLoopEnd: runtime.sampleTime(loopClip, 1, false),
      uiLoopDisabledEnd: runtime.sampleTime(loopClip, 1, false, false),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', runner, runtimePath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || `runtime probe exited ${result.status}`);
  return JSON.parse(result.stdout);
}

describe('Unity Humanoid animation runtime', () => {
  test('treats Forearm and Lower Leg Stretch as +1-neutral joint flexion', () => {
    const result = readRuntimeMath();
    expect(result.bindings['Left Forearm Stretch']).toMatchObject({
      bone: 'leftLowerArm', axis: 'y', neutralValue: 1, sign: -1,
    });
    expect(result.bindings['Right Forearm Stretch']).toMatchObject({
      bone: 'rightLowerArm', axis: 'y', neutralValue: 1, sign: 1,
    });
    expect(result.bindings['Left Lower Leg Stretch']).toMatchObject({
      bone: 'leftLowerLeg', axis: 'x', localAxis: true, neutralValue: 1, sign: -1,
    });
    expect(result.bindings['Right Lower Leg Stretch']).toMatchObject({
      bone: 'rightLowerLeg', axis: 'x', localAxis: true, neutralValue: 1, sign: -1,
    });
    expect(result.degrees['Left Forearm Stretch']).toEqual({ straight: 0, middle: 80, folded: 160 });
    expect(result.degrees['Right Forearm Stretch']).toEqual({ straight: 0, middle: -80, folded: -160 });
    expect(result.degrees['Left Lower Leg Stretch']).toEqual({ straight: 0, middle: 80, folded: 160 });
    expect(result.degrees['Right Lower Leg Stretch']).toEqual({ straight: 0, middle: 80, folded: 160 });
  });

  test('subtracts Unity humanoid reference-pose muscle values before rotating bones', () => {
    const result = readRuntimeMath();
    expect(result.bindings['Left Arm Down-Up']).toMatchObject({ neutralValue: 0.4 });
    expect(result.bindings['Right Arm Front-Back']).toMatchObject({ neutralValue: 0.3, sign: 1 });
    expect(result.bindings['Left Upper Leg Front-Back']).toMatchObject({ neutralValue: 0.6 });
    expect(result.bindings['LeftHand.Index.1 Stretched']).toMatchObject({ neutralValue: 0.67 });
  });

  test('allows the UI Loop checkbox to override a looping clip at its endpoint', () => {
    const result = readRuntimeMath();
    expect(result.clipDefaultLoopEnd).toBe(0);
    expect(result.uiLoopDisabledEnd).toBe(1);
  });

  test('samples manual playback at display refresh cadence and forwards the UI loop state', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'render_model_preview.js'), 'utf8');
    expect(source).toContain("time: start + Math.max(0, time), loop");
    expect(source).toContain("now - animationPlaybackLastAt >= (1000 / 60)");
  });

  test('resolves exact baked poses by Humanoid identity and spatial anatomy', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    expect(source).toContain('function resolveHumanBones(humanBoneName)');
    expect(source).toContain("const targetX = side === 'left'");
    expect(source).toContain('return { apply, reset, dispose, resolveHumanBones }');
  });
});
