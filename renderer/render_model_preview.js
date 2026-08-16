(function attachRenderModelPreview(global) {
  function createRenderModelPreview(deps) {
    const state = deps?.state;
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((s) => String(s ?? ''));
    const showTransientMessage = deps?.showTransientMessage;
    const logger = deps?.logger || global.console;
    const openItemPickerModal = deps?.openItemPickerModal;
    const closeItemPickerModal = deps?.closeItemPickerModal;

    if (!boothAPI) {
      throw new Error('createRenderModelPreview requires boothAPI.');
    }

    let overlayEl = null;
    let viewerHandle = null;
    let openToken = 0;
    let viewerLoadSeq = 0;
    let keyDownHandler = null;
    let physBoneSessionId = '';
    let physBoneStatsTitle = '';
    let physBoneFrameUnsubscribe = null;
    let physBoneStateUnsubscribe = null;
    let currentAvatarAsset = null;
    let currentPackageEntry = null;
    let wornOutfitAsset = null;
    let currentPreviewPrep = null;
    let currentPrefabViews = [];
    let currentPrefabRelPath = null;
    const vrcDataCache = new Map();
    let expressionRuntime = null;
    let expressionMenuStack = [];
    let expressionAnimationRaf = null;
    let expressionAnimationStartedAt = 0;
    let expressionAnimationLastAt = 0;
    let expressionAnimationEnabled = false;
    let expressionEvaluateRaf = null;
    let contactParameterValues = {};
    let avatarFaceStats = null;
    let humanoidStats = null;
    let animationClips = [];
    let animationPlaybackRaf = null;
    let animationPlaybackEnabled = false;
    let animationPlaybackStartedAt = 0;
    let animationPlaybackOffset = 0;
    let animationPlaybackLastAt = 0;
    let animationPlaybackStats = null;
    const animationBakeCache = new Map();
    const animationGenericClipCache = new WeakMap();
    let animationBakeToken = 0;

    function ensureThreeBridgeReady() {
      if (global.AvatoolThreeBridge && global.AvatoolThreeBridgeReadyPromise) {
        return global.AvatoolThreeBridgeReadyPromise;
      }
      const readyPromise = new Promise((resolve) => {
        global.addEventListener('avatool-three-bridge-ready', () => resolve(), { once: true });
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('three_bridge_timeout')), 10000);
      });
      return Promise.race([readyPromise, timeoutPromise]);
    }

    function closeModelPreview() {
      openToken += 1;
      viewerLoadSeq += 1;
      stopUnityPhysBone(true);
      if (viewerHandle) {
        try { viewerHandle.dispose(); } catch (e) { logger?.warn?.('model preview dispose failed', e); }
        viewerHandle = null;
      }
      try { closeItemPickerModal?.(); } catch { /* picker not open */ }
      currentAvatarAsset = null;
      currentPackageEntry = null;
      wornOutfitAsset = null;
      currentPreviewPrep = null;
      currentPrefabViews = [];
      currentPrefabRelPath = null;
      vrcDataCache.clear();
      expressionRuntime = null;
      expressionMenuStack = [];
      if (expressionAnimationRaf !== null) cancelAnimationFrame(expressionAnimationRaf);
      expressionAnimationRaf = null;
      expressionAnimationEnabled = false;
      if (expressionEvaluateRaf !== null) cancelAnimationFrame(expressionEvaluateRaf);
      expressionEvaluateRaf = null;
      contactParameterValues = {};
      avatarFaceStats = null;
      humanoidStats = null;
      animationClips = [];
      animationBakeToken += 1;
      animationBakeCache.clear();
      stopAnimationPlayback();
      physBoneFrameUnsubscribe?.();
      physBoneFrameUnsubscribe = null;
      physBoneStateUnsubscribe?.();
      physBoneStateUnsubscribe = null;
      if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
      }
      if (keyDownHandler) {
        document.removeEventListener('keydown', keyDownHandler);
        keyDownHandler = null;
      }
    }

    function buildOverlaySkeleton(title) {
      const overlay = document.createElement('div');
      overlay.id = 'model-preview-overlay';
      overlay.className = 'fixed inset-0 z-[95] bg-black/90 flex flex-col';
      overlay.innerHTML = `
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-bold text-zinc-100 truncate">${esc(title)}</span>
              <span class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">beta</span>
            </div>
            <div class="text-[10px] text-zinc-500 mt-0.5">three.jsリアルタイム表示 ／ DLL解析ベースの軽量PhysBone互換Solver</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div id="model-preview-prefab-wrap" class="hidden flex items-center gap-1.5 min-w-0">
              <span class="text-[10px] text-zinc-500 shrink-0">Prefab</span>
              <input id="model-preview-prefab-search" type="search" class="hidden w-28 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600" placeholder="絞り込み" aria-label="Prefabを絞り込み">
              <select id="model-preview-prefab-select" class="max-w-[16rem] rounded-lg border border-amber-400/25 bg-amber-400/5 px-2 py-1 text-[11px] text-zinc-100" title="Prefab を選択（色分け・バリエーション）"></select>
            </div>
            <button id="model-preview-physbone" type="button" class="hidden rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold text-emerald-100 hover:bg-emerald-400/25 disabled:cursor-wait disabled:opacity-60" title="軽量PhysBone互換Solverへ疑似風を与える（Unity起動不要）">PhysBone＋疑似風</button>
            <button id="model-preview-expressions" type="button" class="hidden rounded-lg border border-sky-400/40 bg-sky-400/15 px-2.5 py-1 text-[10px] font-bold text-sky-100 hover:bg-sky-400/25" title="VRChat Expression Menuを操作">Expressions</button>
            <button id="model-preview-animations" type="button" class="hidden rounded-lg border border-violet-400/40 bg-violet-400/15 px-2.5 py-1 text-[10px] font-bold text-violet-100 hover:bg-violet-400/25" title="Unityを起動せずAnimationClipを再生">Animations</button>
            <div id="model-preview-mat-wrap" class="hidden flex items-center gap-1.5 min-w-0">
              <span id="model-preview-mat-label" class="text-[10px] text-zinc-500 shrink-0">カラー</span>
              <select id="model-preview-material-select" class="max-w-[14rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-200" title="色・マテリアル（テクスチャ違い）"></select>
            </div>
            <select id="model-preview-mesh-select" class="hidden max-w-[14rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-200" title="メッシュ (FBX)"></select>
            <div id="model-preview-outfit-wrap" class="hidden items-center gap-1.5 min-w-0">
              <button id="model-preview-wear-outfit" type="button" class="max-w-[12rem] truncate rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold text-zinc-200 hover:bg-white/[0.08]" title="別のダウンロード済みアイテムを重ねて表示（簡易・ボーン名が一致する部分のみフィットします）">＋ 服を着せる</button>
              <button id="model-preview-remove-outfit" type="button" class="hidden rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.08]" title="服を外す">✕</button>
            </div>
            <button id="model-preview-close" type="button" class="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-zinc-200 hover:bg-white/[0.08]">閉じる</button>
          </div>
        </div>
        <div id="model-preview-body" class="relative flex-1 min-h-0">
          <canvas id="model-preview-canvas" class="absolute inset-0 w-full h-full"></canvas>
          <div id="model-preview-status" class="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-400"></div>
          <div id="model-preview-vrc-info" class="hidden absolute bottom-3 left-3 max-w-[75%] rounded-lg border border-sky-400/20 bg-black/65 px-2.5 py-1.5 text-[10px] text-sky-100 backdrop-blur-sm"></div>
          <aside id="model-preview-expression-panel" class="hidden absolute top-3 right-3 z-10 w-72 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-sky-400/25 bg-zinc-950/90 p-3 text-zinc-100 shadow-2xl backdrop-blur-md">
            <div class="flex items-center gap-2 border-b border-white/10 pb-2">
              <button id="model-preview-expression-back" type="button" class="hidden rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10">←</button>
              <div id="model-preview-expression-title" class="min-w-0 flex-1 truncate text-[12px] font-bold">Expressions</div>
              <button id="model-preview-expression-play" type="button" class="rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/10" title="時間Animationを再生（通常は操作時だけ評価）">▶</button>
              <button id="model-preview-expression-close" type="button" class="rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-white/10">✕</button>
            </div>
            <div id="model-preview-expression-status" class="py-3 text-[11px] text-zinc-400"></div>
            <div id="model-preview-expression-controls" class="grid gap-2 pt-3"></div>
            <div id="model-preview-expression-state" class="mt-3 border-t border-white/10 pt-2 text-[9px] text-zinc-500"></div>
          </aside>
          <aside id="model-preview-animation-panel" class="hidden absolute top-3 right-3 z-10 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-violet-400/25 bg-zinc-950/90 p-3 text-zinc-100 shadow-2xl backdrop-blur-md">
            <div class="flex items-center gap-2 border-b border-white/10 pb-2">
              <div class="min-w-0 flex-1 truncate text-[12px] font-bold">AnimationClip</div>
              <button id="model-preview-animation-close" type="button" class="rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-white/10">✕</button>
            </div>
            <div id="model-preview-animation-status" class="py-3 text-[11px] text-zinc-400">AnimationClipを読み込んでいます…</div>
            <div id="model-preview-animation-controls" class="hidden grid gap-3 pt-1">
              <input id="model-preview-animation-search" type="search" class="w-full rounded-lg border border-white/10 bg-black/35 px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600" placeholder="クリップ名を絞り込み">
              <select id="model-preview-animation-select" size="8" class="w-full rounded-lg border border-white/10 bg-black/35 px-2 py-1 text-[10px] text-zinc-200"></select>
              <div class="flex items-center gap-2">
                <button id="model-preview-animation-play" type="button" class="rounded-lg border border-violet-400/35 bg-violet-400/10 px-3 py-1.5 text-[11px] font-bold text-violet-100 hover:bg-violet-400/20">▶ 再生</button>
                <button id="model-preview-animation-reset" type="button" class="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10">リセット</button>
                <label class="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-400"><input id="model-preview-animation-loop" type="checkbox" class="accent-violet-400">Loop</label>
                <select id="model-preview-animation-speed" class="rounded-md border border-white/10 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
              </div>
              <input id="model-preview-animation-seek" type="range" min="0" max="1000" value="0" step="1" class="w-full accent-violet-400">
              <div id="model-preview-animation-detail" class="text-[9px] leading-relaxed text-zinc-500"></div>
            </div>
          </aside>
        </div>
      `;
      overlay.querySelector('#model-preview-close')?.addEventListener('click', closeModelPreview);
      overlay.querySelector('#model-preview-wear-outfit')?.addEventListener('click', () => openOutfitPicker());
      overlay.querySelector('#model-preview-remove-outfit')?.addEventListener('click', () => removeOutfitItem());
      overlay.querySelector('#model-preview-expressions')?.addEventListener('click', () => toggleExpressionPanel());
      overlay.querySelector('#model-preview-animations')?.addEventListener('click', () => toggleAnimationPanel());
      overlay.querySelector('#model-preview-physbone')?.addEventListener('click', () => toggleUnityPhysBone());
      overlay.querySelector('#model-preview-expression-close')?.addEventListener('click', () => closeExpressionPanel());
      overlay.querySelector('#model-preview-animation-close')?.addEventListener('click', () => closeAnimationPanel());
      overlay.querySelector('#model-preview-animation-play')?.addEventListener('click', () => toggleAnimationPlayback());
      overlay.querySelector('#model-preview-animation-reset')?.addEventListener('click', () => resetAnimationPlayback());
      overlay.querySelector('#model-preview-animation-search')?.addEventListener('input', () => renderAnimationClipOptions());
      overlay.querySelector('#model-preview-animation-select')?.addEventListener('change', () => selectAnimationClip());
      overlay.querySelector('#model-preview-animation-seek')?.addEventListener('input', () => seekAnimationClip());
      overlay.querySelector('#model-preview-animation-seek')?.addEventListener('change', () => viewerHandle?.frameCurrentObject?.(true));
      overlay.querySelector('#model-preview-expression-play')?.addEventListener('click', () => {
        expressionAnimationEnabled = !expressionAnimationEnabled;
        syncExpressionAnimationButton();
        if (expressionAnimationEnabled) startExpressionAnimation();
        else stopExpressionAnimation();
      });
      overlay.querySelector('#model-preview-expression-back')?.addEventListener('click', () => {
        if (expressionMenuStack.length > 1) expressionMenuStack.pop();
        renderExpressionMenu();
      });
      keyDownHandler = (e) => {
        if (e.key === 'Escape') closeModelPreview();
      };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModelPreview();
      });
      document.addEventListener('keydown', keyDownHandler);
      if (typeof boothAPI.onUnityPhysBoneFrame === 'function') {
        physBoneFrameUnsubscribe = boothAPI.onUnityPhysBoneFrame((frame) => {
          if (!physBoneSessionId || frame?.sessionId !== physBoneSessionId || !viewerHandle) return;
          const result = viewerHandle.applyExternalBonePoses?.(frame);
          const button = overlayEl?.querySelector('#model-preview-physbone');
          if (button && result?.applied >= 0) {
            const title = `Unity公式PhysBone: ${result.applied} poses / ${result.transformed || 0} bones（未解決 ${result.unresolved || 0}）`;
            if (title !== physBoneStatsTitle) {
              physBoneStatsTitle = title;
              button.title = title;
            }
          }
        });
      }
      if (typeof boothAPI.onUnityPhysBoneState === 'function') {
        physBoneStateUnsubscribe = boothAPI.onUnityPhysBoneState((next) => {
          if (!physBoneSessionId || (next?.sessionId && next.sessionId !== physBoneSessionId)) return;
          if (next?.state === 'error') {
            physBoneSessionId = '';
            physBoneStatsTitle = '';
            syncPhysBoneButton();
            showTransientMessage?.(`PhysBone実行に失敗しました（${next.error || `Unity code ${next.code}`}）`, 'error');
          } else if (next?.state === 'stopped') {
            physBoneSessionId = '';
            physBoneStatsTitle = '';
            viewerHandle?.resetExternalBonePoses?.();
            syncPhysBoneButton();
          }
        });
      }
      return overlay;
    }

    function syncPhysBoneButton(starting = false) {
      const button = overlayEl?.querySelector('#model-preview-physbone');
      if (!button) return;
      button.disabled = starting;
      button.textContent = starting ? 'PhysBone読込中…' : physBoneSessionId ? '疑似風停止' : 'PhysBone＋疑似風';
      button.classList.toggle('bg-emerald-400/30', Boolean(physBoneSessionId));
      if (!starting && !physBoneSessionId && !physBoneStatsTitle) {
        button.title = '軽量PhysBone互換Solverへ疑似風を与える（Unity起動不要）';
      }
    }

    function selectedPrefabView() {
      const select = overlayEl?.querySelector('#model-preview-prefab-select');
      const index = select ? Number(select.value || 0) : 0;
      return currentPrefabViews[index] || currentPrefabViews[0] || null;
    }

    function prefabScopesForView(view = selectedPrefabView()) {
      const scopes = [
        view?.prefabRelPath || currentPrefabRelPath || '',
        ...(Array.isArray(view?.sourcePrefabRelPaths) ? view.sourcePrefabRelPaths : []),
      ].map((value) => String(value || '').replace(/\\/g, '/')).filter(Boolean);
      return [...new Set(scopes)];
    }

    function readCurrentVrcData(prefabRelPaths = prefabScopesForView()) {
      if (!currentAvatarAsset || !currentPreviewPrep) return Promise.resolve({ components: [] });
      const scopes = (Array.isArray(prefabRelPaths) ? prefabRelPaths : [prefabRelPaths])
        .map((value) => String(value || '').replace(/\\/g, '/'))
        .filter(Boolean);
      if (!scopes.length) scopes.push('');
      const key = `${currentPreviewPrep.root || ''}\n${scopes.join('\n')}`;
      if (!vrcDataCache.has(key)) {
        const request = Promise.all(scopes.map((scope) => boothAPI.readModelPreviewVrcData(
          currentAvatarAsset.itemId,
          currentAvatarAsset.title || '',
          currentPreviewPrep.root,
          scope
        ))).then((results) => {
          const components = [];
          const seen = new Set();
          for (const result of results) {
            for (const row of (Array.isArray(result?.components) ? result.components : [])) {
              const componentKey = [
                row?.type,
                row?.prefabRelPath,
                row?.componentFileId,
                row?.gameObjectFileId,
                row?.assetRelPath,
                row?.name,
              ].map((value) => String(value || '')).join('|');
              if (seen.has(componentKey)) continue;
              seen.add(componentKey);
              components.push(row);
            }
          }
          const firstError = results.find((result) => result?.error)?.error;
          const fbxMapError = results.find((result) => result?.fbxMapError)?.fbxMapError || '';
          if (fbxMapError) vrcDataCache.delete(key);
          return {
            ...(results[0] || {}),
            ...(firstError ? { error: firstError } : {}),
            components,
            fbxMapError,
          };
        }).catch((error) => {
          vrcDataCache.delete(key);
          throw error;
        });
        vrcDataCache.set(key, request);
      }
      return vrcDataCache.get(key);
    }

    async function stopUnityPhysBone(silent = false) {
      const sessionId = physBoneSessionId;
      physBoneSessionId = '';
      physBoneStatsTitle = '';
      viewerHandle?.resetExternalBonePoses?.();
      viewerHandle?.stopLocalPhysBones?.();
      syncPhysBoneButton();
      if (!sessionId || sessionId === 'local' || typeof boothAPI.stopUnityPhysBonePreview !== 'function') {
        if (sessionId && !silent) showTransientMessage?.('PhysBoneを停止しました', 'info');
        return;
      }
      try {
        await boothAPI.stopUnityPhysBonePreview(sessionId);
        if (!silent) showTransientMessage?.('PhysBoneを停止しました', 'info');
      } catch (e) {
        logger?.warn?.('PhysBone stop failed', e);
      }
    }

    async function toggleUnityPhysBone() {
      if (physBoneSessionId) {
        await stopUnityPhysBone();
        return;
      }
      const unavailable = [];
      if (!currentAvatarAsset) unavailable.push('avatar');
      if (!currentPreviewPrep) unavailable.push('package');
      if (!viewerHandle) unavailable.push('viewer');
      if (typeof boothAPI.readModelPreviewVrcData !== 'function') unavailable.push('vrc-data');
      if (typeof viewerHandle?.startLocalPhysBones !== 'function') unavailable.push('solver');
      if (unavailable.length) {
        const reason = `PhysBoneを開始できません（準備未完了: ${unavailable.join(', ')}）`;
        const button = overlayEl?.querySelector('#model-preview-physbone');
        if (button) button.title = reason;
        showTransientMessage?.(reason, 'error');
        return;
      }
      const view = selectedPrefabView();
      syncPhysBoneButton(true);
      try {
        const data = await readCurrentVrcData(prefabScopesForView(view));
        if (data?.error) throw new Error(data.error);
        if (data?.fbxMapError) {
          const mapErrorMessages = {
            fbx_model_meta_not_found: '元のFBXインポート設定を取得できませんでした',
            fbx_object_map_incomplete: 'FBXのボーン参照をすべて解決できませんでした',
            unity_editor_not_found: '初回のFBX解析に必要なUnity Editorが見つかりません',
          };
          throw new Error(mapErrorMessages[data.fbxMapError] || data.fbxMapError);
        }
        const result = viewerHandle.startLocalPhysBones(data?.components || []);
        if (result?.error) {
          throw new Error(result.error);
        }
        if (!result?.ok || !result.boneCount) throw new Error('表示モデルに対応するPhysBoneチェーンが見つかりません');
        physBoneSessionId = 'local';
        physBoneStatsTitle = `軽量PhysBone互換Solver: ${result.boneCount} bones / ${result.chainCount} chains（Unity不要）`;
        syncPhysBoneButton();
        const button = overlayEl?.querySelector('#model-preview-physbone');
        if (button) button.title = physBoneStatsTitle;
        showTransientMessage?.(`軽量PhysBoneを開始しました（${result.boneCount} bones）`, 'info');
      } catch (e) {
        physBoneSessionId = '';
        syncPhysBoneButton();
        showTransientMessage?.(`PhysBoneを開始できませんでした（${e.message}）`, 'error');
      }
    }

    function setStatus(message, tone = 'info') {
      const statusEl = overlayEl?.querySelector('#model-preview-status');
      const canvasEl = overlayEl?.querySelector('#model-preview-canvas');
      if (!statusEl) return;
      if (!message) {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
        canvasEl?.classList.remove('hidden');
        return;
      }
      canvasEl?.classList.add('hidden');
      statusEl.classList.remove('hidden');
      statusEl.className = `absolute inset-0 flex items-center justify-center text-[12px] px-6 text-center ${tone === 'error' ? 'text-red-400' : 'text-zinc-400'}`;
      statusEl.textContent = message;
    }

    function showVrcComponentSummary(summaryOrComponents, prefabRelPaths = null) {
      const info = overlayEl?.querySelector('#model-preview-vrc-info');
      if (!info) return;
      const counts = new Map();
      if (Array.isArray(summaryOrComponents)) {
        for (const row of summaryOrComponents) counts.set(row?.type, (counts.get(row?.type) || 0) + 1);
      } else {
        const summary = summaryOrComponents && typeof summaryOrComponents === 'object'
          ? summaryOrComponents
          : {};
        let selectedCounts = summary.counts || {};
        const scopes = (Array.isArray(prefabRelPaths) ? prefabRelPaths : [prefabRelPaths])
          .map((value) => String(value || '').replace(/\\/g, '/').toLowerCase())
          .filter(Boolean);
        if (scopes.length && summary.byPrefab && typeof summary.byPrefab === 'object') {
          selectedCounts = { ...(summary.unscopedCounts || {}) };
          for (const wanted of scopes) {
            const matchingKey = Object.keys(summary.byPrefab).find(
              (key) => String(key).replace(/\\/g, '/').toLowerCase() === wanted
            );
            for (const [type, count] of Object.entries(matchingKey ? summary.byPrefab[matchingKey] : {})) {
              selectedCounts[type] = (Number(selectedCounts[type]) || 0) + (Number(count) || 0);
            }
          }
        }
        for (const [type, count] of Object.entries(selectedCounts)) {
          if (Number(count) > 0) counts.set(type, Number(count));
        }
      }
      const labels = [
        ['avatarDescriptor', 'Avatar Descriptor'],
        ['physBone', 'PhysBone'],
        ['physBoneCollider', 'Collider'],
        ['contactSender', 'Contact Sender'],
        ['contactReceiver', 'Contact Receiver'],
        ['parentConstraint', 'Parent Constraint'],
        ['positionConstraint', 'Position Constraint'],
        ['rotationConstraint', 'Rotation Constraint'],
        ['scaleConstraint', 'Scale Constraint'],
        ['aimConstraint', 'Aim Constraint'],
        ['lookAtConstraint', 'LookAt Constraint'],
        ['expressionMenu', 'Expression Menu'],
        ['expressionParameters', 'Expression Parameters'],
        ['animatorController', 'Animator Controller'],
        ['animationClip', 'Animation Clip'],
      ].filter(([type]) => counts.get(type)).map(([type, label]) => `${label} ${counts.get(type)}`);
      const expressionBtn = overlayEl?.querySelector('#model-preview-expressions');
      expressionBtn?.classList.toggle('hidden', !counts.get('avatarDescriptor'));
      const animationBtn = overlayEl?.querySelector('#model-preview-animations');
      animationBtn?.classList.toggle('hidden', !counts.get('animationClip'));
      if (overlayEl) overlayEl.dataset.physBoneCount = String(counts.get('physBone') || 0);
      if (!labels.length) {
        info.textContent = '';
        info.classList.add('hidden');
        return;
      }
      info.textContent = `VRCSDK解析: ${labels.join(' / ')}`;
      info.title = 'Prefab内のVRCSDK 3.10系コンポーネントを解析した結果です。';
      info.classList.remove('hidden');
    }

    function closeExpressionPanel(reset = false) {
      overlayEl?.querySelector('#model-preview-expression-panel')?.classList.add('hidden');
      expressionAnimationEnabled = false;
      stopExpressionAnimation();
      if (expressionEvaluateRaf !== null) cancelAnimationFrame(expressionEvaluateRaf);
      expressionEvaluateRaf = null;
      if (reset) {
        expressionRuntime = null;
        expressionMenuStack = [];
        viewerHandle?.resetVrcAnimationFrame?.();
      }
    }

    function selectedAnimationClip() {
      const select = overlayEl?.querySelector('#model-preview-animation-select');
      const index = Number(select?.value);
      return Number.isInteger(index) ? animationClips[index] || null : null;
    }

    function animationDuration(clip = selectedAnimationClip()) {
      return Math.max(0, (Number(clip?.stopTime) || 0) - (Number(clip?.startTime) || 0));
    }

    function animationBakeKey(clip = selectedAnimationClip(), view = selectedPrefabView()) {
      return [
        currentPackageEntry?.relPath || '',
        view?.prefabRelPath || currentPrefabRelPath || '',
        clip?.assetRelPath || '',
      ].join('\n').toLowerCase();
    }

    function genericOnlyAnimationClip(clip) {
      if (!clip || typeof clip !== 'object') return clip;
      if (animationGenericClipCache.has(clip)) return animationGenericClipCache.get(clip);
      const filtered = {
        ...clip,
        hasHumanoidMuscles: false,
        floatCurves: (Array.isArray(clip.floatCurves) ? clip.floatCurves : [])
          .filter((curve) => Number(curve?.classId) !== 95),
      };
      animationGenericClipCache.set(clip, filtered);
      return filtered;
    }

    function setAnimationBakeStatus(message, tone = 'info') {
      const status = overlayEl?.querySelector('#model-preview-animation-status');
      if (!status) return;
      status.textContent = message;
      status.classList.remove('hidden');
      status.classList.toggle('text-red-400', tone === 'error');
      status.classList.toggle('text-zinc-400', tone !== 'error');
    }

    function currentAnimationBake(clip = selectedAnimationClip()) {
      return animationBakeCache.get(animationBakeKey(clip)) || null;
    }

    async function ensureAnimationBake(clip = selectedAnimationClip()) {
      const view = selectedPrefabView();
      const key = animationBakeKey(clip, view);
      if (!clip || !key || !currentAvatarAsset || !currentPackageEntry || !view?.prefabRelPath) return null;
      const existing = animationBakeCache.get(key);
      if (existing?.state === 'ready' || existing?.state === 'failed') return existing;
      if (existing?.promise) return existing.promise;
      if (typeof boothAPI.bakeUnityAnimationPreview !== 'function') {
        const failed = { state: 'failed', error: 'bridge_missing' };
        animationBakeCache.set(key, failed);
        return failed;
      }

      const token = ++animationBakeToken;
      setAnimationBakeStatus('Unity基準のポーズへ高精度変換中…（初回のみ）');
      const request = boothAPI.bakeUnityAnimationPreview({
        itemId: currentAvatarAsset.itemId,
        title: currentAvatarAsset.title || '',
        relPath: currentPackageEntry.relPath,
        prefabPathContains: view.prefabRelPath,
        clipPathContains: clip.assetRelPath,
        fps: 60,
      }).then((result) => {
        const entry = result?.ok && Array.isArray(result.frames) && result.frames.length
          ? { state: 'ready', baked: result }
          : { state: 'failed', error: result?.error || 'animation_bake_failed' };
        animationBakeCache.set(key, entry);
        if (token === animationBakeToken && clip === selectedAnimationClip()) {
          if (entry.state === 'ready') {
            setAnimationBakeStatus(`Unity基準・${Math.round(Number(result.sampleRate) || 60)}fps（${result.cached ? 'キャッシュ' : '変換完了'}）`);
            applyAnimationClipAt(animationPlaybackOffset);
          } else {
            setAnimationBakeStatus(`軽量再生に切替（Unity変換: ${entry.error}）`, 'error');
          }
        }
        return entry;
      }).catch((error) => {
        const entry = { state: 'failed', error: error?.message || 'animation_bake_failed' };
        animationBakeCache.set(key, entry);
        if (token === animationBakeToken && clip === selectedAnimationClip()) {
          setAnimationBakeStatus(`軽量再生に切替（Unity変換: ${entry.error}）`, 'error');
        }
        return entry;
      });
      animationBakeCache.set(key, { state: 'loading', promise: request });
      return request;
    }

    function syncAnimationPlaybackUi(time = animationPlaybackOffset, stats = animationPlaybackStats) {
      const clip = selectedAnimationClip();
      const duration = animationDuration(clip);
      const seek = overlayEl?.querySelector('#model-preview-animation-seek');
      const play = overlayEl?.querySelector('#model-preview-animation-play');
      const detail = overlayEl?.querySelector('#model-preview-animation-detail');
      if (seek) seek.value = String(duration > 0 ? Math.round(Math.max(0, Math.min(1, time / duration)) * 1000) : 0);
      if (play) play.textContent = animationPlaybackEnabled ? '■ 停止' : '▶ 再生';
      if (!detail || !clip) return;
      const counts = [
        `時間 ${Math.max(0, time).toFixed(2)} / ${duration.toFixed(2)} 秒`,
        `Transform ${stats?.transformCount ?? clip.motionCurveCount ?? 0}`,
        `Muscle ${stats?.muscleCount ?? (clip.hasHumanoidMuscles ? 'あり' : 0)}`,
        `BlendShape・Material ${clip.floatCurves?.length || 0}`,
      ];
      if (stats?.unresolvedCount) counts.push(`未解決 ${stats.unresolvedCount}`);
      if (stats?.ignoredCurveCount) counts.push(`補助IK ${stats.ignoredCurveCount}`);
      detail.textContent = counts.join(' ／ ');
      detail.title = stats?.unresolvedAttributes?.length ? `未解決: ${stats.unresolvedAttributes.join(', ')}` : '';
    }

    function applyAnimationClipAt(time) {
      const clip = selectedAnimationClip();
      if (!clip || !viewerHandle) return null;
      const start = Number(clip.startTime) || 0;
      const loop = Boolean(overlayEl?.querySelector('#model-preview-animation-loop')?.checked);
      const bake = currentAnimationBake(clip);
      let stats;
      if (bake?.state === 'ready' && Array.isArray(bake.baked?.frames)) {
        const frames = bake.baked.frames;
        const sampleRate = Math.max(1, Number(bake.baked.sampleRate) || 60);
        const frameIndex = Math.max(0, Math.min(frames.length - 1, Math.round(Math.max(0, time) * sampleRate)));
        viewerHandle.resetExternalBonePoses?.();
        stats = viewerHandle.applyVrcAnimationClips?.([{
          clip: genericOnlyAnimationClip(clip),
          weight: 1,
          time: start + Math.max(0, time),
          loop,
        }]) || {};
        const poseStats = viewerHandle.applyExternalBonePoses?.(frames[frameIndex]) || {};
        stats = {
          ...stats,
          exactUnityPose: true,
          muscleCount: poseStats.applied || 0,
          unresolvedCount: (stats.unresolvedCount || 0) + (poseStats.unresolved || 0),
          ignoredCurveCount: 0,
        };
      } else {
        viewerHandle.resetExternalBonePoses?.();
        stats = viewerHandle.applyVrcAnimationClips?.([{ clip, weight: 1, time: start + Math.max(0, time), loop }]);
      }
      animationPlaybackStats = stats && !stats.error ? stats : null;
      const sampledTime = Math.max(0, time);
      if (!animationPlaybackEnabled) animationPlaybackOffset = sampledTime;
      syncAnimationPlaybackUi(sampledTime, stats);
      if (overlayEl && stats && !stats.error) {
        overlayEl.dataset.animationRuntime = `${stats.transformCount || 0}:${stats.muscleCount || 0}:${stats.unresolvedCount || 0}`;
      }
      return stats;
    }

    function stopAnimationPlayback() {
      if (animationPlaybackRaf !== null) cancelAnimationFrame(animationPlaybackRaf);
      animationPlaybackRaf = null;
      animationPlaybackEnabled = false;
      syncAnimationPlaybackUi();
    }

    function resetAnimationPlayback() {
      stopAnimationPlayback();
      animationPlaybackOffset = 0;
      animationPlaybackStats = null;
      viewerHandle?.resetVrcAnimationFrame?.();
      viewerHandle?.resetExternalBonePoses?.();
      viewerHandle?.frameCurrentObject?.();
      syncAnimationPlaybackUi(0);
      if (overlayEl) delete overlayEl.dataset.animationRuntime;
    }

    function animationFrame(now) {
      animationPlaybackRaf = null;
      const panel = overlayEl?.querySelector('#model-preview-animation-panel');
      if (!animationPlaybackEnabled || !overlayEl || panel?.classList.contains('hidden')) return;
      const clip = selectedAnimationClip();
      const duration = animationDuration(clip);
      const speed = Number(overlayEl.querySelector('#model-preview-animation-speed')?.value) || 1;
      let time = animationPlaybackOffset + ((now - animationPlaybackStartedAt) / 1000) * speed;
      const loop = overlayEl.querySelector('#model-preview-animation-loop')?.checked;
      if (duration > 0 && time >= duration) {
        if (loop) time %= duration;
        else {
          animationPlaybackOffset = duration;
          applyAnimationClipAt(duration);
          stopAnimationPlayback();
          return;
        }
      }
      if (now - animationPlaybackLastAt >= (1000 / 60)) {
        animationPlaybackLastAt = now;
        applyAnimationClipAt(time);
      }
      animationPlaybackRaf = requestAnimationFrame(animationFrame);
    }

    function toggleAnimationPlayback() {
      if (animationPlaybackEnabled) {
        const now = global.performance.now();
        const speed = Number(overlayEl?.querySelector('#model-preview-animation-speed')?.value) || 1;
        animationPlaybackOffset += ((now - animationPlaybackStartedAt) / 1000) * speed;
        const duration = animationDuration();
        if (duration > 0) {
          const loop = overlayEl?.querySelector('#model-preview-animation-loop')?.checked;
          animationPlaybackOffset = loop
            ? animationPlaybackOffset % duration
            : Math.min(duration, animationPlaybackOffset);
        }
        applyAnimationClipAt(animationPlaybackOffset);
        stopAnimationPlayback();
        return;
      }
      const duration = animationDuration();
      if (!(duration > 0)) {
        applyAnimationClipAt(0);
        return;
      }
      if (animationPlaybackOffset >= duration) animationPlaybackOffset = 0;
      animationPlaybackEnabled = true;
      animationPlaybackStartedAt = global.performance.now();
      animationPlaybackLastAt = 0;
      syncAnimationPlaybackUi();
      animationPlaybackRaf = requestAnimationFrame(animationFrame);
    }

    function seekAnimationClip() {
      const seek = overlayEl?.querySelector('#model-preview-animation-seek');
      const normalizedTime = (Number(seek?.value) || 0) / 1000;
      stopAnimationPlayback();
      applyAnimationClipAt(animationDuration() * normalizedTime);
    }

    function selectAnimationClip(options = {}) {
      animationBakeToken += 1;
      resetAnimationPlayback();
      const clip = selectedAnimationClip();
      const loop = overlayEl?.querySelector('#model-preview-animation-loop');
      if (loop) loop.checked = Boolean(clip?.loopTime);
      applyAnimationClipAt(0);
      viewerHandle?.frameCurrentObject?.(true);
      if (options.bake !== false) ensureAnimationBake(clip);
    }

    function renderAnimationClipOptions() {
      const select = overlayEl?.querySelector('#model-preview-animation-select');
      if (!select) return;
      const previous = Number(select.value);
      const query = String(overlayEl?.querySelector('#model-preview-animation-search')?.value || '').trim().toLowerCase();
      const fragment = document.createDocumentFragment();
      animationClips.forEach((clip, index) => {
        if (query && !`${clip.name || ''} ${clip.assetRelPath || ''}`.toLowerCase().includes(query)) return;
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = clip.name || clip.assetRelPath || `Clip ${index + 1}`;
        option.title = clip.assetRelPath || option.textContent;
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
      if ([...select.options].some((option) => Number(option.value) === previous)) select.value = String(previous);
      else if (select.options.length) select.selectedIndex = 0;
      selectAnimationClip({ bake: false });
    }

    function closeAnimationPanel(reset = true) {
      overlayEl?.querySelector('#model-preview-animation-panel')?.classList.add('hidden');
      stopAnimationPlayback();
      if (reset) resetAnimationPlayback();
    }

    async function toggleAnimationPanel() {
      const panel = overlayEl?.querySelector('#model-preview-animation-panel');
      const status = overlayEl?.querySelector('#model-preview-animation-status');
      const controls = overlayEl?.querySelector('#model-preview-animation-controls');
      if (!panel) return;
      if (!panel.classList.contains('hidden')) {
        closeAnimationPanel();
        return;
      }
      closeExpressionPanel(false);
      viewerHandle?.resetVrcAnimationFrame?.();
      panel.classList.remove('hidden');
      if (!animationClips.length) {
        const result = await readCurrentVrcData(prefabScopesForView());
        if (!overlayEl || panel.classList.contains('hidden')) return;
        if (result?.error) {
          if (status) status.textContent = `AnimationClipの読み込みに失敗しました（${result.error}）。`;
          return;
        }
        animationClips = (result.components || [])
          .filter((row) => row?.type === 'animationClip')
          .sort((a, b) => String(a.name || a.assetRelPath).localeCompare(String(b.name || b.assetRelPath), 'ja'));
      }
      if (status) {
        status.textContent = animationClips.length ? `${animationClips.length}件のAnimationClip` : 'AnimationClipが見つかりませんでした。';
        status.classList.remove('hidden');
      }
      controls?.classList.toggle('hidden', animationClips.length === 0);
      if (animationClips.length) renderAnimationClipOptions();
    }

    function applyExpressionResult(result, updateUi = true) {
      viewerHandle?.setAvatarTracking?.(result?.tracking || {});
      const stats = viewerHandle?.applyVrcAnimationClips?.(result?.samples || result?.clips || []);
      if (!updateUi) return;
      const stateEl = overlayEl?.querySelector('#model-preview-expression-state');
      if (!stateEl) return;
      const stateNames = (result?.states || []).map((row) => `${row.layer}: ${row.state}`).join(' / ');
      const applied = stats && !stats.error
        ? `表示 ${stats.visibilityCount} / Transform ${stats.transformCount || 0} / Muscle ${stats.muscleCount || 0} / BlendShape ${stats.blendShapeCount} / Material ${stats.materialCount || 0}`
        : '';
      const runtimeFlags = [
        result?.runtime?.locomotionDisabled ? 'Locomotion停止' : '',
        result?.runtime?.poseSpace ? 'Pose Space' : '',
        result?.runtime?.audioEvents?.length ? `Audio ${result.runtime.audioEvents.length}` : '',
      ].filter(Boolean).join(' / ');
      stateEl.textContent = [stateNames, runtimeFlags, applied].filter(Boolean).join(' · ');
    }

    function appendAvatarFaceControls(controlsEl) {
      if (!controlsEl || !avatarFaceStats?.enabled || !viewerHandle?.setAvatarFace) return;
      const current = viewerHandle.getAvatarFaceState?.() || {};
      const card = document.createElement('section');
      card.id = 'model-preview-avatar-face-controls';
      card.className = 'grid gap-2 rounded-lg border border-violet-400/20 bg-violet-400/[0.05] p-2.5';
      const heading = document.createElement('div');
      heading.className = 'flex items-center justify-between gap-2 text-[10px] font-bold text-violet-200';
      const trackingMode = current.tracking || {};
      heading.innerHTML = `<span>Eye Look・LipSync</span><span class="font-normal text-violet-300/60">Eye ${trackingMode.eyes === 2 ? 'Animation' : 'Tracking'} / Mouth ${trackingMode.mouth === 2 ? 'Animation' : 'Tracking'}</span>`;
      card.appendChild(heading);

      const autoLabel = document.createElement('label');
      autoLabel.className = 'flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[9px] text-zinc-300';
      autoLabel.innerHTML = '<span>自動Blink・Saccade</span>';
      const autoInput = document.createElement('input');
      autoInput.type = 'checkbox';
      autoInput.id = 'model-preview-avatar-face-auto';
      autoInput.checked = Boolean(current.auto);
      autoInput.className = 'accent-violet-400';
      autoInput.addEventListener('change', () => viewerHandle?.setAvatarFace?.({ auto: autoInput.checked }));
      autoLabel.appendChild(autoInput);
      card.appendChild(autoLabel);

      const applyFace = (values, evaluateParameters = false) => {
        if (evaluateParameters && expressionRuntime) {
          if (Object.hasOwn(values, 'viseme') && expressionRuntime.hasParameter('Viseme')) expressionRuntime.setParameter('Viseme', values.viseme);
          if (Object.hasOwn(values, 'visemeWeight') && expressionRuntime.hasParameter('Voice')) expressionRuntime.setParameter('Voice', values.visemeWeight);
          applyExpressionResult(expressionRuntime.evaluate(), false);
        }
        viewerHandle?.setAvatarFace?.(values);
      };
      const addRange = (label, key, min, max, step, value) => {
        const row = document.createElement('label');
        row.className = 'grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-[9px] text-zinc-400';
        const name = document.createElement('span');
        name.textContent = label;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(Number(value) || 0);
        input.className = 'w-full accent-violet-400';
        const output = document.createElement('span');
        output.className = 'text-right font-mono text-violet-300';
        output.textContent = Number(input.value).toFixed(2);
        input.addEventListener('input', () => {
          const next = Number(input.value);
          output.textContent = next.toFixed(2);
          applyFace({ [key]: next }, key === 'visemeWeight');
        });
        row.append(name, input, output);
        card.appendChild(row);
      };
      addRange('Look X', 'lookX', -1, 1, 0.01, current.lookX);
      addRange('Look Y', 'lookY', -1, 1, 0.01, current.lookY);
      addRange('Blink', 'blink', 0, 1, 0.01, current.blink);

      const mouth = document.createElement('div');
      mouth.className = 'grid grid-cols-[3.5rem_1fr] items-center gap-2 text-[9px] text-zinc-400';
      const mouthLabel = document.createElement('span');
      mouthLabel.textContent = 'Viseme';
      const select = document.createElement('select');
      select.id = 'model-preview-avatar-viseme';
      select.className = 'min-w-0 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200';
      const names = avatarFaceStats.visemeNames || [];
      select.innerHTML = names.map((name, index) => `<option value="${index}">${index}: ${esc(name)}</option>`).join('');
      select.value = String(Number(current.viseme) || 0);
      select.addEventListener('change', () => applyFace({ viseme: Number(select.value) }, true));
      mouth.append(mouthLabel, select);
      card.appendChild(mouth);
      addRange('Amount', 'visemeWeight', 0, 1, 0.01, current.visemeWeight);
      controlsEl.appendChild(card);
    }

    function appendHumanoidControls(controlsEl) {
      if (!controlsEl || !humanoidStats?.boneCount || !viewerHandle?.setHumanoidPose) return;
      const current = viewerHandle.getHumanoidState?.() || {};
      const card = document.createElement('section');
      card.id = 'model-preview-humanoid-controls';
      card.className = 'grid gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-2.5';
      const heading = document.createElement('div');
      heading.className = 'flex items-center justify-between text-[10px] font-bold text-emerald-200';
      heading.innerHTML = `<span>Humanoid・簡易IK</span><span class="font-normal text-emerald-300/60">Bones ${humanoidStats.boneCount} / IK ${humanoidStats.armChainCount + humanoidStats.legChainCount}</span>`;
      card.appendChild(heading);
      const addRange = (label, key, min, max) => {
        const row = document.createElement('label');
        row.className = 'grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-[9px] text-zinc-400';
        const name = document.createElement('span');
        name.textContent = label;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = '0.01';
        input.value = String(Number(current[key]) || 0);
        input.className = 'w-full accent-emerald-400';
        const output = document.createElement('span');
        output.className = 'text-right font-mono text-emerald-300';
        output.textContent = Number(input.value).toFixed(2);
        input.addEventListener('input', () => {
          const value = Number(input.value);
          output.textContent = value.toFixed(2);
          viewerHandle?.setHumanoidPose?.({ [key]: value });
        });
        row.append(name, input, output);
        card.appendChild(row);
      };
      addRange('Head Yaw', 'headYaw', -1, 1);
      addRange('Head Pitch', 'headPitch', -1, 1);
      addRange('Hand IK', 'handReach', 0, 1);
      addRange('Crouch', 'crouch', 0, 1);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'rounded-md border border-white/10 px-2 py-1 text-[9px] text-zinc-300 hover:bg-white/10';
      reset.textContent = 'Humanoid姿勢をリセット';
      reset.addEventListener('click', () => {
        viewerHandle?.resetHumanoidPose?.();
        renderExpressionMenu();
      });
      card.appendChild(reset);
      controlsEl.appendChild(card);
    }

    function syncExpressionAnimationButton() {
      const button = overlayEl?.querySelector('#model-preview-expression-play');
      if (!button) return;
      button.textContent = expressionAnimationEnabled ? '■' : '▶';
      button.title = expressionAnimationEnabled
        ? '時間Animationを停止'
        : '時間Animationを再生（通常は操作時だけ評価）';
      button.classList.toggle('text-sky-300', expressionAnimationEnabled);
      button.classList.toggle('text-zinc-400', !expressionAnimationEnabled);
    }

    function scheduleExpressionEvaluate() {
      if (expressionEvaluateRaf !== null || !expressionRuntime) return;
      expressionEvaluateRaf = requestAnimationFrame(() => {
        expressionEvaluateRaf = null;
        if (!expressionRuntime || !overlayEl) return;
        applyExpressionResult(expressionRuntime.evaluate());
      });
    }

    function stopExpressionAnimation() {
      if (expressionAnimationRaf !== null) cancelAnimationFrame(expressionAnimationRaf);
      expressionAnimationRaf = null;
      syncExpressionAnimationButton();
    }

    function startExpressionAnimation() {
      if (!expressionAnimationEnabled || expressionAnimationRaf !== null || !expressionRuntime) return;
      expressionAnimationStartedAt = global.performance.now();
      expressionAnimationLastAt = 0;
      const frame = (now) => {
        expressionAnimationRaf = null;
        if (!expressionAnimationEnabled || !expressionRuntime || !overlayEl || overlayEl.querySelector('#model-preview-expression-panel')?.classList.contains('hidden')) return;
        if (now - expressionAnimationLastAt >= 66) {
          expressionAnimationLastAt = now;
          applyExpressionResult(expressionRuntime.evaluate((now - expressionAnimationStartedAt) / 1000), false);
        }
        expressionAnimationRaf = requestAnimationFrame(frame);
      };
      syncExpressionAnimationButton();
      expressionAnimationRaf = requestAnimationFrame(frame);
    }

    function renderExpressionMenu() {
      const controlsEl = overlayEl?.querySelector('#model-preview-expression-controls');
      const statusEl = overlayEl?.querySelector('#model-preview-expression-status');
      const titleEl = overlayEl?.querySelector('#model-preview-expression-title');
      const backEl = overlayEl?.querySelector('#model-preview-expression-back');
      const menu = expressionMenuStack.at(-1);
      if (!controlsEl || !statusEl || !expressionRuntime) return;
      statusEl.classList.add('hidden');
      controlsEl.replaceChildren();
      applyExpressionResult(expressionRuntime.evaluate());
      if (titleEl) titleEl.textContent = menu?.name || 'Avatar Runtime';
      backEl?.classList.toggle('hidden', expressionMenuStack.length <= 1);
      appendAvatarFaceControls(controlsEl);
      appendHumanoidControls(controlsEl);

      const gestureInputs = [
        ['GestureLeft', 'GestureLeftWeight', '左手'],
        ['GestureRight', 'GestureRightWeight', '右手'],
      ].filter(([parameter]) => expressionRuntime.hasParameter(parameter));
      if (gestureInputs.length) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-2';
        const gestureNames = ['Idle', 'Fist', 'Open', 'Point', 'Peace', 'RockNRoll', 'Gun', 'ThumbsUp'];
        for (const [parameter, weightParameter, labelText] of gestureInputs) {
          const field = document.createElement('label');
          field.className = 'grid gap-1 text-[9px] text-zinc-500';
          field.textContent = labelText;
          const select = document.createElement('select');
          select.className = 'min-w-0 rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200';
          select.innerHTML = gestureNames.map((name, index) => `<option value="${index}">${name}</option>`).join('');
          select.value = String(Number(expressionRuntime.getParameter(parameter)) || 0);
          select.addEventListener('change', () => {
            const value = Number(select.value || 0);
            expressionRuntime.setParameter(parameter, value);
            if (expressionRuntime.hasParameter(weightParameter)) {
              expressionRuntime.setParameter(weightParameter, value === 0 ? 0 : 1);
            }
            applyExpressionResult(expressionRuntime.evaluate());
          });
          field.appendChild(select);
          inputWrap.appendChild(field);
        }
        controlsEl.appendChild(inputWrap);
      }

      for (const control of menu?.controls || []) {
        const type = Number(control.controlType);
        if ([
          expressionRuntime.CONTROL.RADIAL_PUPPET,
          expressionRuntime.CONTROL.TWO_AXIS_PUPPET,
          expressionRuntime.CONTROL.FOUR_AXIS_PUPPET,
        ].includes(type)) {
          const card = document.createElement('div');
          card.className = 'grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2.5 text-[10px] text-zinc-300';
          const heading = document.createElement('div');
          heading.className = 'flex items-center justify-between gap-2 font-bold';
          const puppetValue = document.createElement('span');
          puppetValue.className = 'font-mono text-[9px] text-sky-300';
          heading.append(document.createTextNode(control.name || 'Puppet'), puppetValue);
          card.appendChild(heading);
          const parameterNames = (control.subParameters || []).filter(Boolean);
          if (type === expressionRuntime.CONTROL.RADIAL_PUPPET) {
            const parameter = parameterNames[0] || control.parameter;
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.01';
            slider.value = String(Math.max(0, Math.min(1, Number(expressionRuntime.getParameter(parameter)) || 0)));
            slider.className = 'w-full accent-sky-400';
            const update = () => {
              const value = Number(slider.value);
              expressionRuntime.setParameter(parameter, value);
              puppetValue.textContent = value.toFixed(2);
              scheduleExpressionEvaluate();
              expressionAnimationStartedAt = global.performance.now();
            };
            slider.addEventListener('input', update);
            puppetValue.textContent = Number(slider.value).toFixed(2);
            card.appendChild(slider);
          } else {
            const isFourAxis = type === expressionRuntime.CONTROL.FOUR_AXIS_PUPPET;
            const xParameter = parameterNames[0];
            const yParameter = parameterNames[1];
            const pad = document.createElement('div');
            pad.className = 'relative h-32 w-full touch-none overflow-hidden rounded-lg border border-white/15 bg-black/30 cursor-crosshair';
            pad.innerHTML = '<div class="absolute left-1/2 top-0 h-full w-px bg-white/10"></div><div class="absolute left-0 top-1/2 h-px w-full bg-white/10"></div>';
            const knob = document.createElement('div');
            knob.className = 'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-sky-400 shadow-lg';
            pad.appendChild(knob);
            const setPoint = (x, y, apply = true) => {
              const px = Math.max(-1, Math.min(1, Number(x) || 0));
              const py = Math.max(-1, Math.min(1, Number(y) || 0));
              knob.style.left = `${(px + 1) * 50}%`;
              knob.style.top = `${(1 - py) * 50}%`;
              puppetValue.textContent = `${px.toFixed(2)}, ${py.toFixed(2)}`;
              if (isFourAxis) {
                const [up, right, down, left] = parameterNames;
                if (up) expressionRuntime.setParameter(up, Math.max(0, py));
                if (right) expressionRuntime.setParameter(right, Math.max(0, px));
                if (down) expressionRuntime.setParameter(down, Math.max(0, -py));
                if (left) expressionRuntime.setParameter(left, Math.max(0, -px));
              } else {
                if (xParameter) expressionRuntime.setParameter(xParameter, px);
                if (yParameter) expressionRuntime.setParameter(yParameter, py);
              }
              if (apply) {
                scheduleExpressionEvaluate();
                expressionAnimationStartedAt = global.performance.now();
              }
            };
            const updatePointer = (event) => {
              const rect = pad.getBoundingClientRect();
              setPoint(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
            };
            pad.addEventListener('pointerdown', (event) => {
              pad.setPointerCapture(event.pointerId);
              updatePointer(event);
            });
            pad.addEventListener('pointermove', (event) => {
              if (pad.hasPointerCapture(event.pointerId)) updatePointer(event);
            });
            const initialX = isFourAxis
              ? Number(expressionRuntime.getParameter(parameterNames[1])) - Number(expressionRuntime.getParameter(parameterNames[3]))
              : expressionRuntime.getParameter(xParameter);
            const initialY = isFourAxis
              ? Number(expressionRuntime.getParameter(parameterNames[0])) - Number(expressionRuntime.getParameter(parameterNames[2]))
              : expressionRuntime.getParameter(yParameter);
            setPoint(initialX, initialY, false);
            card.appendChild(pad);
          }
          controlsEl.appendChild(card);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[11px] text-zinc-200 hover:border-sky-400/35 hover:bg-sky-400/10';
        const label = document.createElement('span');
        label.className = 'truncate';
        label.textContent = control.name || control.parameter || 'Control';
        const marker = document.createElement('span');
        marker.className = 'shrink-0 text-[10px] text-zinc-500';
        button.append(label, marker);

        if (type === expressionRuntime.CONTROL.SUB_MENU) {
          marker.textContent = '›';
          button.addEventListener('click', () => {
            const child = expressionRuntime.menuByGuid(control.subMenu?.guid);
            if (!child) return;
            expressionMenuStack.push(child);
            renderExpressionMenu();
          });
        } else if (type === expressionRuntime.CONTROL.TOGGLE) {
          const refresh = () => {
            const active = Number(expressionRuntime.getParameter(control.parameter)) === Number(control.value ?? 1);
            marker.textContent = active ? 'ON' : 'OFF';
            marker.className = `shrink-0 text-[10px] font-bold ${active ? 'text-sky-300' : 'text-zinc-500'}`;
            button.setAttribute('aria-pressed', String(active));
          };
          refresh();
          button.addEventListener('click', () => {
            applyExpressionResult(expressionRuntime.applyControl(control));
            refresh();
          });
        } else if (type === expressionRuntime.CONTROL.BUTTON) {
          marker.textContent = 'HOLD';
          const release = () => applyExpressionResult(expressionRuntime.applyControl(control, false));
          button.addEventListener('pointerdown', () => applyExpressionResult(expressionRuntime.applyControl(control, true)));
          button.addEventListener('pointerup', release);
          button.addEventListener('pointercancel', release);
          button.addEventListener('pointerleave', (event) => {
            if (event.buttons) release();
          });
        } else {
          marker.textContent = `TYPE ${type}`;
          button.disabled = true;
        }
        controlsEl.appendChild(button);
      }
      syncExpressionAnimationButton();
    }

    async function toggleExpressionPanel() {
      const panel = overlayEl?.querySelector('#model-preview-expression-panel');
      const statusEl = overlayEl?.querySelector('#model-preview-expression-status');
      const controlsEl = overlayEl?.querySelector('#model-preview-expression-controls');
      if (!panel) return;
      if (!panel.classList.contains('hidden')) {
        closeExpressionPanel();
        return;
      }
      closeAnimationPanel();
      panel.classList.remove('hidden');
      if (expressionRuntime) {
        renderExpressionMenu();
        return;
      }
      if (!currentAvatarAsset || !currentPreviewPrep || !boothAPI.readModelPreviewVrcData) return;
      if (statusEl) {
        statusEl.textContent = 'VRC Expressionを読み込んでいます…';
        statusEl.classList.remove('hidden');
      }
      controlsEl?.replaceChildren();
      const res = await readCurrentVrcData(prefabScopesForView());
      if (!overlayEl || panel.classList.contains('hidden')) return;
      if (res?.error || !global.AvatoolVrcExpressionRuntime) {
        if (statusEl) statusEl.textContent = `Expressionの読み込みに失敗しました（${res?.error || 'runtime_missing'}）。`;
        return;
      }
      expressionRuntime = global.AvatoolVrcExpressionRuntime.createRuntime(res.components);
      for (const [name, value] of Object.entries(contactParameterValues)) {
        expressionRuntime.setParameter(name, value);
      }
      const rootMenu = expressionRuntime.rootMenu();
      expressionMenuStack = rootMenu ? [rootMenu] : [];
      renderExpressionMenu();
    }

    const ERROR_MESSAGES = {
      package_not_found: 'パッケージファイルが見つかりませんでした。',
      no_mesh_found: 'このパッケージには表示可能な3Dモデル（.fbx/.obj）が見つかりませんでした。',
      __extracted_not_found: '展開フォルダがありません。先にダウンロードと展開を完了してください。',
      file_not_found: '対象ファイルが見つかりませんでした。',
      unsupported_file_type: 'このファイル形式は3Dプレビューに対応していません。',
      extract_timeout: 'パッケージの展開がタイムアウトしました。ファイルサイズが非常に大きい可能性があります。',
    };

    function mapError(code) {
      const key = String(code || '');
      if (ERROR_MESSAGES[key]) return ERROR_MESSAGES[key];
      if (key.startsWith('tar_failed')) return `パッケージの展開に失敗しました（${key}）。`;
      return `読み込みに失敗しました（${key || '不明なエラー'}）。`;
    }

    function replaceCanvas() {
      // Creating a new THREE.WebGLRenderer on a <canvas> that just had its
      // context force-lost (previous viewer's dispose()) is unsafe — the new
      // context can come up already "lost". Always hand createViewer a fresh,
      // never-before-used canvas element instead of reusing the old one.
      const oldCanvas = overlayEl.querySelector('#model-preview-canvas');
      const newCanvas = document.createElement('canvas');
      newCanvas.id = 'model-preview-canvas';
      newCanvas.className = oldCanvas.className;
      oldCanvas.replaceWith(newCanvas);
      return newCanvas;
    }

    function getSelectedMaterialName() {
      const matSelect = overlayEl?.querySelector('#model-preview-material-select');
      const wrap = overlayEl?.querySelector('#model-preview-mat-wrap');
      if (!matSelect || (wrap && wrap.classList.contains('hidden'))) return null;
      // data-user-picked: only honor select when user changed it (or single forced)
      if (matSelect.dataset.userPicked !== '1' && matSelect.dataset.prefabDefault) {
        return matSelect.dataset.prefabDefault || null;
      }
      const v = String(matSelect.value || '').trim();
      return v || null;
    }

    function basenameTex(relPath) {
      if (!relPath) return '';
      return String(relPath).replace(/\\/g, '/').split('/').pop() || '';
    }

    /**
     * Color variants = multiple mats that mainly differ by main texture
     * (same package hair/outfit colors: Beige.png / Brown.png / …).
     */
    function isColorVariantSet(materials) {
      const list = Array.isArray(materials) ? materials : [];
      if (list.length < 2) return false;
      const withTex = list.filter((m) => m.mainTexRelPath);
      if (withTex.length < 2) return false;
      const texes = new Set(withTex.map((m) => basenameTex(m.mainTexRelPath).toLowerCase()));
      return texes.size >= 2;
    }

    function meshPathMatchesBinding(bindingMeshRelPath, meshRelPath) {
      const mesh = String(meshRelPath || '').replace(/\\/g, '/');
      const base = mesh.split('/').pop() || '';
      const mp = String(bindingMeshRelPath || '').replace(/\\/g, '/');
      if (!mp || !mesh) return false;
      return mp === mesh || mp.endsWith('/' + base) || mp.split('/').pop() === base;
    }

    function prefabFileLabel(prefabRelPath) {
      if (!prefabRelPath) return '';
      return String(prefabRelPath).replace(/\\/g, '/').split('/').pop().replace(/\.prefab$/i, '');
    }

    /**
     * 複数 Prefab で色分け（髪色など）されている場合のカラー候補。
     * 同じ FBX を指す Prefab 群から、参照 .mat をユニークに集める。
     */
    function collectPrefabColorOptions(bindings, meshRelPath, materials) {
      const list = Array.isArray(bindings) ? bindings : [];
      const mats = Array.isArray(materials) ? materials : [];
      const byName = new Map(mats.map((m) => [String(m.name || '').toLowerCase(), m]));
      const byPath = new Map(
        mats.map((m) => [String(m.relPath || '').replace(/\\/g, '/').toLowerCase(), m])
      );

      let matches = list.filter((b) => meshPathMatchesBinding(b.meshRelPath, meshRelPath));
      if (!matches.length && list.length >= 2) {
        // 全 Prefab が同じメッシュ（または1種類）だけを指すなら色分け候補とみなす
        const bases = new Set(
          list.map((b) => String(b.meshRelPath || '').replace(/\\/g, '/').split('/').pop()).filter(Boolean)
        );
        if (bases.size <= 1) matches = list.slice();
      }

      const options = [];
      const seen = new Set();
      for (const b of matches) {
        const names = b.materialNames || [];
        const paths = b.materialRelPaths || [];
        const n = Math.max(names.length, paths.length);
        for (let i = 0; i < n; i++) {
          const mat =
            (names[i] && byName.get(String(names[i]).toLowerCase())) ||
            (paths[i] && byPath.get(String(paths[i]).replace(/\\/g, '/').toLowerCase())) ||
            null;
          const materialName = mat?.name || names[i];
          if (!materialName) continue;
          const key = String(materialName).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          options.push({
            material: mat,
            materialName,
            prefabRelPath: b.prefabRelPath || null,
            prefabLabel: prefabFileLabel(b.prefabRelPath),
            goName: b.goName || null,
          });
        }
      }

      const prefabFiles = new Set(matches.map((b) => b.prefabRelPath).filter(Boolean));
      const multiPrefab = prefabFiles.size >= 2 && options.length >= 2;
      options.sort((a, b) =>
        String(a.prefabLabel || a.materialName).localeCompare(String(b.prefabLabel || b.materialName), 'ja')
      );

      return {
        multiPrefab,
        prefabCount: prefabFiles.size,
        defaultName: options[0]?.materialName || null,
        options,
        materials: options.map((o) => o.material).filter(Boolean),
      };
    }

    function pickPrefabPreferredMaterial(bindings, meshRelPath, materials) {
      const colorOpts = collectPrefabColorOptions(bindings, meshRelPath, materials);
      if (colorOpts.defaultName) return colorOpts.defaultName;

      const list = Array.isArray(bindings) ? bindings : [];
      const hit = list.find((b) => meshPathMatchesBinding(b.meshRelPath, meshRelPath))
        || (list.length === 1 ? list[0] : null);
      if (!hit) return null;
      const names = hit.materialNames || [];
      if (names[0]) return names[0];
      const paths = hit.materialRelPaths || [];
      if (paths[0] && Array.isArray(materials)) {
        const mat = materials.find((m) => String(m.relPath || '').replace(/\\/g, '/') === String(paths[0]).replace(/\\/g, '/'));
        if (mat?.name) return mat.name;
      }
      return null;
    }

    function sortMaterialsForSelect(materials, prefabDefaultName) {
      const list = (Array.isArray(materials) ? materials.slice() : []);
      list.sort((a, b) => {
        const an = String(a.name || '');
        const bn = String(b.name || '');
        if (prefabDefaultName) {
          if (an === prefabDefaultName) return -1;
          if (bn === prefabDefaultName) return 1;
        }
        return an.localeCompare(bn, 'ja');
      });
      return list;
    }

    /**
     * @param {object[]} materials all package materials
     * @param {string|null} prefabDefaultName
     * @param {{ multiPrefab?: boolean, options?: object[], materials?: object[] }|null} prefabColor
     */
    function populateMaterialSelect(materials, prefabDefaultName, prefabColor) {
      const matSelect = overlayEl?.querySelector('#model-preview-material-select');
      const wrap = overlayEl?.querySelector('#model-preview-mat-wrap');
      const labelEl = overlayEl?.querySelector('#model-preview-mat-label');
      if (!matSelect) return;

      // Prefer colors that Prefabs actually reference when multi-prefab color split.
      let list;
      let optionMeta = null; // materialName -> { prefabLabel }
      if (prefabColor?.multiPrefab && prefabColor.materials?.length >= 2) {
        list = prefabColor.materials.slice();
        optionMeta = new Map(
          (prefabColor.options || []).map((o) => [o.materialName, o])
        );
      } else {
        list = sortMaterialsForSelect(materials, prefabDefaultName);
      }

      matSelect.dataset.userPicked = '';
      matSelect.dataset.prefabDefault = prefabDefaultName || '';
      if (list.length <= 1) {
        wrap?.classList.add('hidden');
        matSelect.innerHTML = '';
        return;
      }
      wrap?.classList.remove('hidden');
      const colorish = isColorVariantSet(list) || Boolean(prefabColor?.multiPrefab);
      if (labelEl) {
        labelEl.textContent = prefabColor?.multiPrefab
          ? 'カラー (Prefab)'
          : colorish
            ? 'カラー'
            : 'マテリアル';
      }
      matSelect.title = prefabColor?.multiPrefab
        ? '複数 Prefab の色分け（同じメッシュ・別マテリアル）。Prefab 名でも識別できます'
        : colorish
          ? '色違い（各マテリアル＝別メインテクスチャ）。Prefab 既定に ★'
          : 'マテリアル切り替え';

      matSelect.innerHTML = list
        .map((m) => {
          const name = m.name || m.relPath || 'mat';
          const tex = basenameTex(m.mainTexRelPath);
          const isDef = prefabDefaultName && m.name === prefabDefaultName;
          const meta = optionMeta?.get(name);
          let label = name;
          if (meta?.prefabLabel && meta.prefabLabel.toLowerCase() !== String(name).toLowerCase()) {
            // e.g. "Beige — Hair_Beige"
            label = `${name} — ${meta.prefabLabel}`;
          } else if (tex && tex.replace(/\.png$/i, '').toLowerCase() !== String(name).toLowerCase()) {
            label = `${name} — ${tex}`;
          }
          if (isDef) label += ' ★';
          return `<option value="${esc(m.name)}"${isDef ? ' selected' : ''}>${esc(label)}</option>`;
        })
        .join('');
      if (prefabDefaultName && list.some((m) => m.name === prefabDefaultName)) {
        matSelect.value = prefabDefaultName;
      }
    }

    /**
     * Prefab 単位のビュー一覧を構築。
     * 各 Prefab → 参照メッシュ (FBX) + 割り当てマテリアル名。
     */
    function buildPrefabViews(prep) {
      const bindings = Array.isArray(prep.prefabBindings) ? prep.prefabBindings : [];
      const meshes = Array.isArray(prep.meshes) ? prep.meshes : [];
      const meshByNorm = new Map();
      const meshByBase = new Map();
      for (const m of meshes) {
        const norm = String(m.relPath || '').replace(/\\/g, '/');
        meshByNorm.set(norm, m);
        meshByBase.set(norm.split('/').pop(), m);
      }

      const resolveMesh = (b) => {
        const mp = String(b.meshRelPath || '').replace(/\\/g, '/');
        if (!mp) return null;
        return meshByNorm.get(mp) || meshByBase.get(mp.split('/').pop()) || null;
      };

      const byKey = new Map();
      for (const b of bindings) {
        const key = b.prefabRelPath
          || `__go_${b.goName || 'obj'}_${(b.materialNames || []).join('+')}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            key,
            prefabRelPath: b.prefabRelPath || null,
            prefabLabel: prefabFileLabel(b.prefabRelPath) || b.goName || 'Prefab',
            goName: b.goName || null,
            mesh: null,
            // Highest-priority renderer class chosen for `mesh` so far: a Prefab commonly
            // bundles the main body (SkinnedMeshRenderer, classId 137) alongside small
            // attached props (pen/eraser/butterfly, plain MeshRenderer, classId 23) under
            // the same prefabRelPath — always prefer the skinned body over an incidental prop.
            meshRendererClassId: null,
            meshes: [],
            materialNames: [],
            materialRelPaths: [],
            sourcePrefabRelPaths: [],
            // Number of renderer bindings folded into this view — a fully assembled avatar
            // Prefab is built from many renderers (body/hair/clothes/etc.), while a small
            // color-override or reference Prefab typically has just one or two. Used below
            // to rank complete avatars ahead of partial/helper Prefabs for the default pick.
            bindingCount: 0,
          });
        }
        const view = byKey.get(key);
        view.bindingCount += 1;
        const sourcePrefabRelPath = String(b.sourcePrefabRelPath || '').replace(/\\/g, '/');
        if (sourcePrefabRelPath && !view.sourcePrefabRelPaths.includes(sourcePrefabRelPath)) {
          view.sourcePrefabRelPaths.push(sourcePrefabRelPath);
        }
        for (const n of (b.materialNames || [])) {
          if (n && !view.materialNames.includes(n)) view.materialNames.push(n);
        }
        for (const p of (b.materialRelPaths || [])) {
          if (p && !view.materialRelPaths.includes(p)) view.materialRelPaths.push(p);
        }
        const candidateMesh = resolveMesh(b);
        if (candidateMesh) {
          if (!view.meshes.some((mesh) => String(mesh.relPath || '') === String(candidateMesh.relPath || ''))) {
            view.meshes.push(candidateMesh);
          }
          const better = !view.mesh
            || (view.meshRendererClassId !== '137' && b.rendererClassId === '137');
          if (better) {
            view.mesh = candidateMesh;
            view.meshRendererClassId = b.rendererClassId || null;
          }
        }
      }

      for (const view of byKey.values()) {
        if (!view.meshes.length && meshes.length === 1) view.meshes.push(meshes[0]);
        const primaryMeshScore = (mesh) => {
          const base = String(mesh?.relPath || '').replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
          let score = 0;
          if (/(?:body|sotai|base|avatar|face|素体)/i.test(base)) score += 100;
          if (/(?:cloth|costume|outfit|dress|wear|衣装)/i.test(base)) score -= 20;
          return score;
        };
        view.meshes.sort((a, b) => primaryMeshScore(b) - primaryMeshScore(a));
        view.mesh = view.meshes[0] || view.mesh || null;
      }

      // If even cross-file Prefab inheritance produced no binding, keep the extracted
      // Prefab paths available as a last-resort mesh fallback.
      if (!byKey.size && meshes.length) {
        for (const prefab of (Array.isArray(prep.prefabs) ? prep.prefabs : [])) {
          const relPath = String(prefab?.relPath || prefab || '').replace(/\\/g, '/');
          if (!relPath) continue;
          byKey.set(relPath, {
            key: relPath,
            prefabRelPath: relPath,
            prefabLabel: relPath.replace(/\.prefab$/i, ''),
            goName: null,
            mesh: meshes[0],
            meshes: [meshes[0]],
            meshRendererClassId: null,
            materialNames: [],
            materialRelPaths: [],
            sourcePrefabRelPaths: [],
            bindingCount: 0,
            unityOnlyFallback: true,
          });
        }
      }

      // Default selection is index 0 after this sort. A package can include small
      // color-override / reference Prefabs (e.g. a single face-material swap meant to be
      // applied on top of the real body, or an empty placeholder) alongside the actual
      // fully assembled avatar Prefab. Observed on a real item: both a 0-material bare
      // Prefab and a 2-material "face color only" Prefab sorted alphabetically ahead of the
      // 6-material/12-binding "(for dress-up)" Prefab that is the one users actually want to
      // see, producing a flat untextured (or barely textured) default view. Rank by
      // bindingCount (how many renderer parts were folded into this view — a full avatar is
      // assembled from many) first, so fuller Prefabs win the default slot; alphabetical
      // order only breaks ties within the same tier.
      return [...byKey.values()]
        .filter((v) => v.mesh)
        .sort((a, b) => {
          if (a.bindingCount !== b.bindingCount) return b.bindingCount - a.bindingCount;
          return String(a.prefabLabel).localeCompare(String(b.prefabLabel), 'ja');
        });
    }

    function resolveMeshExt(mesh) {
      if (mesh?.ext) return mesh.ext;
      const p = String(mesh?.relPath || '').toLowerCase();
      if (p.endsWith('.obj')) return '.obj';
      return '.fbx';
    }

    async function loadMeshIntoViewer(asset, prep, mesh, token, opts = {}) {
      const loadSeq = ++viewerLoadSeq;
      if (viewerHandle) {
        try { viewerHandle.dispose(); } catch { /* already torn down */ }
        viewerHandle = null;
      }
      setStatus('モデルを読み込んでいます...');
      const canvasEl = replaceCanvas();

      const readFile = async (relPath) => {
        const res = await boothAPI.readModelPreviewFile(asset.itemId, asset.title || '', prep.root, relPath);
        if (res?.error) {
          logger?.warn?.('readModelPreviewFile failed', relPath, res.error);
          return null;
        }
        return res?.data || null;
      };

      try {
        await ensureThreeBridgeReady();
        if (token !== openToken || loadSeq !== viewerLoadSeq) return;

        // Prefab 指定 > UI 選択 > Prefab 自動推定
        let preferredMaterialName = opts.preferredMaterialName || null;
        if (preferredMaterialName == null) {
          preferredMaterialName = getSelectedMaterialName();
        }
        if (!preferredMaterialName && Array.isArray(prep.prefabBindings) && prep.prefabBindings.length) {
          preferredMaterialName = pickPrefabPreferredMaterial(
            prep.prefabBindings,
            mesh.relPath,
            prep.materials
          );
        }

        // 単一 Prefab 表示時はその Prefab のバインディングだけを渡してスロット割当を固定
        let bindings = prep.prefabBindings || [];
        if (opts.prefabRelPath) {
          const filtered = bindings.filter(
            (b) => String(b.prefabRelPath || '') === String(opts.prefabRelPath)
          );
          if (filtered.length) bindings = filtered;
        }

        const handle = await global.AvatoolThreeBridge.createViewer(canvasEl, {
          readFile,
          meshRelPath: mesh.relPath,
          ext: resolveMeshExt(mesh),
          textures: prep.textures || [],
          materials: prep.materials || [],
          prefabBindings: bindings,
          preferredMaterialName,
        });
        if (token !== openToken || loadSeq !== viewerLoadSeq) {
          handle.dispose();
          return;
        }
        viewerHandle = handle;
        let compositeMeshCount = 0;
        for (const additionalMesh of (Array.isArray(opts.additionalMeshes) ? opts.additionalMeshes : [])) {
          if (token !== openToken || loadSeq !== viewerLoadSeq) {
            handle.dispose();
            if (viewerHandle === handle) viewerHandle = null;
            return;
          }
          try {
            const result = await handle.addCompositeLayer?.({
              readFile,
              meshRelPath: additionalMesh.relPath,
              ext: resolveMeshExt(additionalMesh),
              textures: prep.textures || [],
              materials: prep.materials || [],
              prefabBindings: bindings,
              maComponents: selectMaComponentsForOutfit(
                prep.maComponents,
                opts.prefabRelPath,
                additionalMesh.relPath
              ),
              preferredMaterialName: null,
            });
            if (result?.ok) compositeMeshCount += 1;
            else logger?.warn?.('model preview composite mesh skipped', additionalMesh.relPath, result?.error || 'unknown');
          } catch (error) {
            logger?.warn?.('model preview composite mesh failed', additionalMesh.relPath, error);
          }
        }
        if (overlayEl) overlayEl.dataset.compositeMeshCount = String(compositeMeshCount);
        wornOutfitAsset = null;
        updateOutfitControls();
        if (expressionRuntime) applyExpressionResult(expressionRuntime.evaluate());
        setStatus('');
        readCurrentVrcData(opts.prefabScopes || opts.prefabRelPath || currentPrefabRelPath).then((data) => {
          if (token !== openToken || loadSeq !== viewerLoadSeq || viewerHandle !== handle) return;
          avatarFaceStats = handle.startAvatarFace?.(data?.components || []) || null;
          if (overlayEl && avatarFaceStats?.enabled) {
            overlayEl.dataset.avatarFaceRuntime = `${avatarFaceStats.eyeBoneCount || 0}:${avatarFaceStats.visemeCount || 0}`;
          }
          humanoidStats = handle.startHumanoidRuntime?.() || null;
          if (overlayEl && humanoidStats?.boneCount) {
            overlayEl.dataset.humanoidRuntime = `${humanoidStats.boneCount}:${humanoidStats.armChainCount || 0}:${humanoidStats.legChainCount || 0}`;
          }
          const result = handle.startConstraints?.(data?.components || []);
          if (overlayEl && result?.constraintCount) {
            overlayEl.dataset.constraintRuntimeCount = String(result.constraintCount);
          }
          const contactResult = handle.startContacts?.(data?.components || [], (parameters) => {
            if (viewerHandle !== handle) return;
            contactParameterValues = { ...parameters };
            if (!expressionRuntime) return;
            for (const [name, value] of Object.entries(parameters)) expressionRuntime.setParameter(name, value);
            applyExpressionResult(expressionRuntime.evaluate());
          });
          if (overlayEl && contactResult?.receiverCount) {
            overlayEl.dataset.contactRuntimeCount = String(contactResult.receiverCount);
          }
        }).catch((e) => logger?.warn?.('constraint runtime setup failed', e));
      } catch (e) {
        if (token !== openToken || loadSeq !== viewerLoadSeq) return;
        logger?.error?.('model preview render failed', e);
        setStatus('モデルの読み込みに失敗しました。', 'error');
      }
    }

    function loadPrefabView(asset, prep, prefabView, token) {
      stopUnityPhysBone(true);
      if (!prefabView?.mesh) {
        setStatus('この Prefab に対応するメッシュが見つかりません。', 'error');
        return Promise.resolve();
      }
      const nextPrefab = String(prefabView.prefabRelPath || '');
      if (currentPrefabRelPath && currentPrefabRelPath !== nextPrefab) {
        closeExpressionPanel(true);
        closeAnimationPanel();
        animationClips = [];
      }
      currentPrefabRelPath = nextPrefab;
      // 複数マテリアルを持つ Prefab（全身アバター等）は preferred を押し付けない
      // → スロットごとの Prefab 割当を使う。単色（髪の色違い）だけ preferred で切替。
      const distinct = [...new Set((prefabView.materialNames || []).filter(Boolean))];
      const preferred =
        distinct.length <= 1
          ? (distinct[0]
            || pickPrefabPreferredMaterial(
              (prep.prefabBindings || []).filter(
                (b) => String(b.prefabRelPath || '') === String(prefabView.prefabRelPath || '')
              ),
              prefabView.mesh.relPath,
              prep.materials
            ))
          : null;
      const matSelect = overlayEl?.querySelector('#model-preview-material-select');
      if (matSelect && preferred) {
        matSelect.dataset.userPicked = '';
        matSelect.dataset.prefabDefault = preferred;
        if ([...matSelect.options].some((o) => o.value === preferred)) {
          matSelect.value = preferred;
        }
      }
      return loadMeshIntoViewer(asset, prep, prefabView.mesh, token, {
        preferredMaterialName: preferred,
        prefabRelPath: prefabView.prefabRelPath,
        prefabScopes: prefabScopesForView(prefabView),
        additionalMeshes: (prefabView.meshes || []).filter(
          (mesh) => String(mesh.relPath || '') !== String(prefabView.mesh.relPath || '')
        ),
      });
    }

    /**
     * 簡易「着せ替え」: 現在のアバターに別のダウンロード済みアイテムを重ねて表示する。
     * ボーン名が一致する部分だけを繋ぎ替える近似実装で、体型差の吸収はしない
     * （renderer/render_model_preview_three.js の attachOutfitToAvatar 参照）。
     */
    function updateOutfitControls() {
      const wrap = overlayEl?.querySelector('#model-preview-outfit-wrap');
      const wearBtn = overlayEl?.querySelector('#model-preview-wear-outfit');
      const removeBtn = overlayEl?.querySelector('#model-preview-remove-outfit');
      if (!wrap) return;
      wrap.classList.toggle('hidden', !viewerHandle);
      wrap.classList.toggle('flex', Boolean(viewerHandle));
      if (wearBtn) {
        wearBtn.textContent = wornOutfitAsset ? `👕 ${wornOutfitAsset.title || wornOutfitAsset.itemId}` : '＋ 服を着せる';
      }
      if (removeBtn) removeBtn.classList.toggle('hidden', !wornOutfitAsset);
    }

    // アイテム内のファイルツリーをユーザーに選ばせず「軽く」着せられるようにするための簡易ヒューリスティック。
    // 「マテリアルバリエーション集」等の名前を持つパッケージ（メッシュを含まないことが多く、
    // 実際にはメインの服パッケージより巨大になりがちな例が実在する）を除外したうえで、
    // .unitypackage を優先・ファイルサイズが大きいものを優先する順にランク付けする。
    // 上位候補から順に prepareModelPreview を試し、メッシュが見つかった最初の1件を採用する
    // （帽子等の付属アクセサリだけの小さいパッケージを誤って選ばないため、最終判定は実際に
    // 展開してメッシュの有無を見る）。
    function avatarAliasTokens(asset) {
      const source = [
        ...(Array.isArray(asset?.supportedAvatars) ? asset.supportedAvatars : []),
        ...(Array.isArray(asset?.nameVariants?.all) ? asset.nameVariants.all : []),
        asset?.itemName,
        asset?.title,
        asset?.name,
      ].filter(Boolean).join(' ');
      const tokens = source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}|[A-Za-z][A-Za-z0-9_-]{2,}/gu) || [];
      return [...new Set(tokens.map((token) => token.toLowerCase()))];
    }

    function rankWearableEntries(files) {
      const all = (Array.isArray(files) ? files : []).filter(
        (f) => f.kind === 'file' && /\.(unitypackage|fbx|obj)$/i.test(f.name || '')
      );
      const withoutMaterialPacks = all.filter((f) => !/material/i.test(f.name || ''));
      let candidates = withoutMaterialPacks.length ? withoutMaterialPacks : all;
      const currentTokens = currentAvatarAliasTokens();
      const otherAvatarTokens = new Set(
        (Array.isArray(state?.allAssets) ? state.allAssets : [])
          .filter((asset) => asset?.isAvatarItem && String(asset.itemId) !== String(currentAvatarAsset?.itemId || ''))
          .flatMap((asset) => avatarAliasTokens(asset))
      );
      const pathParts = (file) => String(file?.relPath || file?.name || '')
        .replace(/\\/g, '/').toLowerCase().split('/');
      const currentMatchScore = (file) => {
        const parts = pathParts(file);
        const base = String(file?.name || parts.at(-1) || '').toLowerCase();
        const parent = parts.at(-2) || '';
        let score = 0;
        for (const token of currentTokens) {
          if (base.includes(token)) score = Math.max(score, 100 + token.length);
          else if (parent.includes(token)) score = Math.max(score, 60 + token.length);
        }
        return score;
      };
      const explicitlyOtherAvatar = (file) => {
        const parts = pathParts(file);
        const baseAndParent = `${file?.name || ''} ${parts.at(-2) || ''}`.toLowerCase();
        return [...otherAvatarTokens].some((token) => token.length >= 3 && baseAndParent.includes(token));
      };
      const matching = candidates.filter((file) => currentMatchScore(file) > 0);
      if (matching.length) {
        candidates = matching;
      } else {
        const hasOtherSpecificPackage = candidates.some((file) => explicitlyOtherAvatar(file));
        let generic = candidates.filter((file) => !explicitlyOtherAvatar(file));
        if (hasOtherSpecificPackage) {
          generic = generic.filter((file) => !/(?:^|[_ .-])(acc|accessory|beret|hat|option)(?:[_ .-]|$)/i.test(file.name || ''));
        }
        if (generic.length) candidates = generic;
        else if (hasOtherSpecificPackage) return [];
      }
      candidates.sort((a, b) => {
        const avatarScore = currentMatchScore(b) - currentMatchScore(a);
        if (avatarScore) return avatarScore;
        const aPkg = /\.unitypackage$/i.test(a.name) ? 1 : 0;
        const bPkg = /\.unitypackage$/i.test(b.name) ? 1 : 0;
        if (aPkg !== bPkg) return bPkg - aPkg;
        return (b.size || 0) - (a.size || 0);
      });
      return candidates.slice(0, 4);
    }

    function selectMaComponentsForOutfit(components, prefabRelPath, meshRelPath) {
      const rows = Array.isArray(components) ? components : [];
      if (prefabRelPath) return rows.filter((row) => row.prefabRelPath === prefabRelPath);
      const groups = new Map();
      for (const row of rows) {
        if (!row?.prefabRelPath) continue;
        if (!groups.has(row.prefabRelPath)) groups.set(row.prefabRelPath, []);
        groups.get(row.prefabRelPath).push(row);
      }
      const normalizedMeshPath = String(meshRelPath || '').replace(/\\/g, '/').toLowerCase();
      const meshBase = normalizedMeshPath.split('/').pop() || '';
      const meshParent = normalizedMeshPath.split('/').slice(-2, -1)[0] || '';
      const meshBaseTokens = new Set(meshBase.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3));
      const meshParentTokens = new Set(meshParent.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3));
      const ranked = [...groups.entries()].map(([path, values]) => {
        const normalizedPath = String(path).replace(/\\/g, '/').toLowerCase();
        const prefabBase = normalizedPath.split('/').pop() || '';
        const prefabParent = normalizedPath.split('/').slice(-3, -2)[0] || '';
        const baseTokens = prefabBase.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3);
        const parentTokens = prefabParent.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3);
        const baseShared = baseTokens.filter((token) => meshBaseTokens.has(token)).length;
        const parentShared = parentTokens.filter((token) => meshBaseTokens.has(token) || meshParentTokens.has(token)).length;
        const avatarAliasMatch = currentAvatarAliasTokens().some((token) => normalizedPath.includes(token));
        const hasMerge = values.some((row) => row.type === 'mergeArmature');
        return { values, score: (avatarAliasMatch ? 500 : 0) + baseShared * 100 + parentShared * 20 + (hasMerge ? 3 : 0) };
      }).sort((a, b) => b.score - a.score);
      return ranked[0]?.values || [];
    }

    function currentAvatarAliasTokens() {
      return avatarAliasTokens(currentAvatarAsset);
    }

    function scoreMeshForCurrentAvatar(mesh) {
      const pathValue = String(mesh?.relPath || '').replace(/\\/g, '/').toLowerCase();
      const segments = pathValue.split('/');
      const base = segments.pop()?.replace(/\.(fbx|obj)$/i, '') || '';
      const nearParents = segments.slice(-2);
      let score = 0;
      for (const token of currentAvatarAliasTokens()) {
        if (base.includes(token)) score = Math.max(score, 100 + token.length);
        else if (nearParents.some((parent) => parent.includes(token))) score = Math.max(score, 50 + token.length);
      }
      return score;
    }

    async function wearOutfitItem(outfitAsset) {
      if (!viewerHandle || !outfitAsset?.itemId) return;
      const wearBtn = overlayEl?.querySelector('#model-preview-wear-outfit');
      if (wearBtn) { wearBtn.disabled = true; wearBtn.textContent = '読み込み中…'; }
      try {
        const filesRes = await boothAPI.listItemFiles(outfitAsset.itemId, outfitAsset.title || '');
        if (filesRes?.error) {
          showTransientMessage?.(mapError(filesRes.error), 'error');
          return;
        }
        const candidates = rankWearableEntries(filesRes.files);
        if (!candidates.length) {
          showTransientMessage?.('このアイテムには表示可能な3Dモデルが見つかりませんでした。', 'error');
          return;
        }
        let prep = null;
        for (const candidate of candidates) {
          const attempt = await boothAPI.prepareModelPreview(outfitAsset.itemId, outfitAsset.title || '', candidate.relPath);
          if (!attempt?.error && Array.isArray(attempt.meshes) && attempt.meshes.length) {
            prep = attempt;
            break;
          }
        }
        if (!prep) {
          showTransientMessage?.(mapError('no_mesh_found'), 'error');
          return;
        }
        const meshes = prep.meshes;
        const prefabViews = buildPrefabViews(prep);
        const selectedPrefabView = prefabViews
          .map((view, index) => ({ view, index, score: scoreMeshForCurrentAvatar(view.mesh) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.view || null;
        const mesh = selectedPrefabView?.mesh || meshes[0];
        const preferredMaterialName = selectedPrefabView?.materialNames?.[0]
          || pickPrefabPreferredMaterial(prep.prefabBindings || [], mesh.relPath, prep.materials || []);
        const readFile = async (relPath) => {
          const res = await boothAPI.readModelPreviewFile(outfitAsset.itemId, outfitAsset.title || '', prep.root, relPath);
          if (res?.error) {
            logger?.warn?.('readModelPreviewFile (outfit) failed', relPath, res.error);
            return null;
          }
          return res?.data || null;
        };
        const targetViewer = viewerHandle;
        const result = await targetViewer.wearOutfit({
          readFile,
          meshRelPath: mesh.relPath,
          ext: resolveMeshExt(mesh),
          textures: prep.textures || [],
          materials: prep.materials || [],
          prefabBindings: prep.prefabBindings || [],
          maComponents: selectMaComponentsForOutfit(
            prep.maComponents,
            selectedPrefabView?.prefabRelPath,
            mesh.relPath
          ),
          preferredMaterialName,
        });
        if (targetViewer !== viewerHandle || !overlayEl) return;
        if (result?.error) {
          const message = result.error === 'incompatible_outfit'
            ? 'この衣装は現在のアバターとボーン構造が一致しないため装着できません。'
            : '服の装着に失敗しました。';
          showTransientMessage?.(message, 'error');
          return;
        }
        wornOutfitAsset = outfitAsset;
        if (result && result.totalBones > 0 && result.matchedBones === 0) {
          showTransientMessage?.('ボーン名が一致しなかったため、位置がずれて表示されている可能性があります。', 'info');
        }
      } catch (e) {
        logger?.error?.('wear outfit failed', e);
        showTransientMessage?.('服の装着に失敗しました。', 'error');
      } finally {
        if (wearBtn) wearBtn.disabled = false;
        updateOutfitControls();
      }
    }

    function removeOutfitItem() {
      if (!viewerHandle) return;
      try { viewerHandle.removeOutfit(); } catch (e) { logger?.warn?.('remove outfit failed', e); }
      wornOutfitAsset = null;
      updateOutfitControls();
    }

    function openOutfitPicker() {
      if (!viewerHandle || typeof openItemPickerModal !== 'function') return;
      const filterUtils = global.AvatoolRenderAvatarFilter;
      const avatarNames = [
        ...(Array.isArray(currentAvatarAsset?.supportedAvatars) ? currentAvatarAsset.supportedAvatars : []),
        ...(Array.isArray(currentAvatarAsset?.supportedAvatarsInferred) ? currentAvatarAsset.supportedAvatarsInferred : []),
        currentAvatarAsset?.supportedAvatarAnalysis?.primaryAvatar,
        ...(Array.isArray(currentAvatarAsset?.nameVariants?.all) ? currentAvatarAsset.nameVariants.all : []),
        ...(Array.isArray(currentAvatarAsset?.nameVariants?.katakana) ? currentAvatarAsset.nameVariants.katakana : []),
        ...(Array.isArray(currentAvatarAsset?.nameVariants?.hiragana) ? currentAvatarAsset.nameVariants.hiragana : []),
        ...(Array.isArray(currentAvatarAsset?.nameVariants?.latin) ? currentAvatarAsset.nameVariants.latin : []),
      ].map((value) => String(value || '').trim()).filter(Boolean);
      const supportsCurrentAvatar = (asset) => {
        if (!avatarNames.length) return false;
        if (typeof filterUtils?.matchesAvatarFilter === 'function') {
          return avatarNames.some((name) => filterUtils.matchesAvatarFilter(asset, name));
        }
        const normalized = new Set(avatarNames.map((value) => value.toLowerCase().replace(/[\s_.・\-]+/g, '')));
        return [...(asset?.supportedAvatars || []), ...(asset?.supportedAvatarsInferred || [])]
          .some((value) => normalized.has(String(value || '').toLowerCase().replace(/[\s_.・\-]+/g, '')));
      };
      const items = (Array.isArray(state?.allAssets) ? state.allAssets : [])
        .filter((a) => a?.downloaded
          && !a?.isAvatarItem
          && String(a.itemId) !== String(currentAvatarAsset?.itemId || '')
          && supportsCurrentAvatar(a))
        .map((a) => ({
          key: String(a.itemId),
          itemId: a.itemId,
          itemTitle: a.title,
          previewUrl: a.preview?.[0] || '',
        }));
      openItemPickerModal({
        items,
        singleSelect: true,
        title: '対応衣装を着せる',
        subtitle: '現在のアバターへの対応が確認できたダウンロード済み衣装だけを表示しています',
        onApply: (selectedItems) => {
          const picked = selectedItems?.[0];
          if (!picked) return;
          wearOutfitItem({ itemId: picked.itemId, title: picked.itemTitle });
        },
      });
    }

    function populatePrefabSelect(prefabViews) {
      const wrap = overlayEl?.querySelector('#model-preview-prefab-wrap');
      const selectEl = overlayEl?.querySelector('#model-preview-prefab-select');
      const searchEl = overlayEl?.querySelector('#model-preview-prefab-search');
      if (!wrap || !selectEl) return;
      if (!prefabViews.length) {
        wrap.classList.add('hidden');
        selectEl.innerHTML = '';
        searchEl?.classList.add('hidden');
        return;
      }
      wrap.classList.remove('hidden');
      const renderOptions = (query = '') => {
        const needle = String(query || '').trim().toLowerCase();
        const rows = prefabViews
          .map((v, i) => ({ v, i }))
          .filter(({ v }) => !needle || String(v.prefabLabel || '').toLowerCase().includes(needle));
        selectEl.innerHTML = rows
          .map(({ v, i }) => {
          const matHint = v.materialNames[0] ? ` (${v.materialNames[0]})` : '';
          const meshHint = (v.meshes?.length || 0) > 1 ? ` +${v.meshes.length - 1} mesh` : '';
          const label = `${v.prefabLabel}${matHint}${meshHint}`;
          return `<option value="${i}">${esc(label)}</option>`;
          })
          .join('');
        selectEl.disabled = rows.length === 0;
        const physBoneBtn = overlayEl?.querySelector('#model-preview-physbone');
        if (physBoneBtn && !physBoneSessionId) physBoneBtn.disabled = rows.length === 0;
        return rows.length;
      };
      renderOptions('');
      if (searchEl) {
        searchEl.classList.toggle('hidden', prefabViews.length < 30);
        if (!searchEl.dataset.bound) {
          searchEl.dataset.bound = '1';
          searchEl.addEventListener('input', () => {
            const previous = selectEl.value;
            const count = renderOptions(searchEl.value);
            if (count > 0 && selectEl.value !== previous) {
              selectEl.dispatchEvent(new global.Event('change', { bubbles: true }));
            }
          });
        }
      }
    }

    async function openModelPreview(asset, entry) {
      closeModelPreview();
      const token = ++openToken;
      currentAvatarAsset = asset || null;
      currentPackageEntry = entry || null;

      overlayEl = buildOverlaySkeleton(asset?.title || entry?.name || 'モデルプレビュー');
      document.body.appendChild(overlayEl);
      setStatus('パッケージを展開しています…（初回は時間がかかることがあります。操作はそのままできます）');

      try {
        const prep = await boothAPI.prepareModelPreview(asset.itemId, asset.title || '', entry.relPath);
        if (token !== openToken) return;
        if (prep?.error) {
          setStatus(mapError(prep.error), 'error');
          return;
        }
        currentPreviewPrep = prep;
        const meshes = Array.isArray(prep.meshes) ? prep.meshes : [];
        if (!meshes.length) {
          setStatus(mapError('no_mesh_found'), 'error');
          return;
        }
        const prefabViews = buildPrefabViews(prep);
        currentPrefabViews = prefabViews;
        const usePrefabMode = prefabViews.length >= 1;
        showVrcComponentSummary(
          prep.vrcSummary || prep.vrcComponents,
          usePrefabMode ? prefabScopesForView(prefabViews[0]) : null
        );

        // Prefab モード: Prefab 選択が主。FBX 一覧は隠す（必要時のみ複数メッシュで表示）
        populatePrefabSelect(prefabViews);

        const firstMeshPath = usePrefabMode
          ? (prefabViews[0].mesh.relPath || '')
          : (meshes[0].relPath || '');
        const prefabColor = collectPrefabColorOptions(
          prep.prefabBindings || [],
          firstMeshPath,
          prep.materials || []
        );
        const defaultMat = usePrefabMode
          ? (prefabViews[0].materialNames[0] || prefabColor.defaultName)
          : (
            pickPrefabPreferredMaterial(prep.prefabBindings || [], firstMeshPath, prep.materials || [])
            || prefabColor.defaultName
          );

        // 複数 Prefab 色分けのときはカラー select を出さず Prefab 側に一本化
        if (usePrefabMode && prefabViews.length >= 2 && prefabColor.multiPrefab) {
          populateMaterialSelect([], null, null);
          const wrap = overlayEl.querySelector('#model-preview-mat-wrap');
          wrap?.classList.add('hidden');
        } else {
          populateMaterialSelect(prep.materials || [], defaultMat, prefabColor);
        }

        const prefabSelect = overlayEl.querySelector('#model-preview-prefab-select');
        if (prefabSelect && usePrefabMode && !prefabSelect.dataset.bound) {
          prefabSelect.dataset.bound = '1';
          prefabSelect.addEventListener('change', () => {
            const idx = Number(prefabSelect.value || 0);
            const view = prefabViews[idx];
            if (!view) return;
            animationBakeToken += 1;
            animationClips = [];
            resetAnimationPlayback();
            closeAnimationPanel(false);
            showVrcComponentSummary(prep.vrcSummary || prep.vrcComponents, prefabScopesForView(view));
            // Prefab 切替 = その色のマテリアルで再ロード
            loadPrefabView(asset, prep, view, token).catch((e) => logger?.error?.(e));
          });
        }

        const matSelect = overlayEl.querySelector('#model-preview-material-select');
        if (matSelect && !matSelect.dataset.bound) {
          matSelect.dataset.bound = '1';
          matSelect.addEventListener('change', () => {
            matSelect.dataset.userPicked = '1';
            const name = String(matSelect.value || '').trim() || null;
            if (viewerHandle?.setPreferredMaterial) {
              viewerHandle.setPreferredMaterial(name).catch((e) => logger?.error?.(e));
              return;
            }
            const meshSelect = overlayEl.querySelector('#model-preview-mesh-select');
            const prefabSel = overlayEl.querySelector('#model-preview-prefab-select');
            if (usePrefabMode && prefabSel && !overlayEl.querySelector('#model-preview-prefab-wrap')?.classList.contains('hidden')) {
              const view = prefabViews[Number(prefabSel.value || 0)];
              if (view) {
                loadMeshIntoViewer(asset, prep, view.mesh, token, {
                  preferredMaterialName: name,
                  prefabRelPath: view.prefabRelPath,
                }).catch((e) => logger?.error?.(e));
                return;
              }
            }
            const idx = meshSelect && !meshSelect.classList.contains('hidden')
              ? Number(meshSelect.value || 0)
              : 0;
            loadMeshIntoViewer(asset, prep, meshes[idx] || meshes[0], token, {
              preferredMaterialName: name,
            }).catch((e) => logger?.error?.(e));
          });
        }

        // Prefab が無い／1 Prefab で複数 FBX のときだけメッシュ一覧
        const selectEl = overlayEl.querySelector('#model-preview-mesh-select');
        if (!usePrefabMode && meshes.length > 1 && selectEl) {
          selectEl.classList.remove('hidden');
          selectEl.innerHTML = meshes
            .map((m, i) => `<option value="${i}">${esc(m.relPath)}</option>`)
            .join('');
          selectEl.addEventListener('change', () => {
            const idx = Number(selectEl.value || 0);
            loadMeshIntoViewer(asset, prep, meshes[idx], token).catch((e) => logger?.error?.(e));
          });
        } else if (selectEl) {
          selectEl.classList.add('hidden');
        }

        if (usePrefabMode) {
          await loadPrefabView(asset, prep, prefabViews[0], token);
        } else {
          currentPrefabRelPath = null;
          await loadMeshIntoViewer(asset, prep, meshes[0], token, {
            preferredMaterialName: defaultMat,
          });
        }

        // Do not expose the action until the three.js handle exists. Otherwise the
        // visible button can be clicked while model loading is still in progress.
        const physBoneBtn = overlayEl.querySelector('#model-preview-physbone');
        const isUnityPackage = String(entry?.relPath || entry?.name || '').toLowerCase().endsWith('.unitypackage');
        if (physBoneBtn && boothAPI.readModelPreviewVrcData && isUnityPackage
          && Number(overlayEl.dataset.physBoneCount || 0) > 0 && viewerHandle) {
          physBoneBtn.classList.remove('hidden');
          syncPhysBoneButton();
        }
      } catch (e) {
        if (token !== openToken) return;
        logger?.error?.('prepareModelPreview failed', e);
        setStatus('読み込みに失敗しました。', 'error');
        showTransientMessage?.('3Dプレビューの準備に失敗しました。', 'error');
      }
    }

    return { openModelPreview, closeModelPreview };
  }

  global.AvatoolRenderModelPreview = { createRenderModelPreview };
})(window);
