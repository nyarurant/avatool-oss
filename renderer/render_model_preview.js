(function attachRenderModelPreview(global) {
  function createRenderModelPreview(deps) {
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((s) => String(s ?? ''));
    const showTransientMessage = deps?.showTransientMessage;
    const logger = deps?.logger || global.console;

    if (!boothAPI) {
      throw new Error('createRenderModelPreview requires boothAPI.');
    }

    let overlayEl = null;
    let viewerHandle = null;
    let openToken = 0;
    let keyDownHandler = null;

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
      if (viewerHandle) {
        try { viewerHandle.dispose(); } catch (e) { logger?.warn?.('model preview dispose failed', e); }
        viewerHandle = null;
      }
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
            <div class="text-[10px] text-zinc-500 mt-0.5">実際の見た目とは異なる場合があります（Poiyomi等のカスタムシェーダーは再現されません）</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <select id="model-preview-mesh-select" class="hidden rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-200"></select>
            <button id="model-preview-close" type="button" class="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-zinc-200 hover:bg-white/[0.08]">閉じる</button>
          </div>
        </div>
        <div id="model-preview-body" class="relative flex-1 min-h-0">
          <canvas id="model-preview-canvas" class="absolute inset-0 w-full h-full"></canvas>
          <div id="model-preview-status" class="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-400"></div>
        </div>
      `;
      overlay.querySelector('#model-preview-close')?.addEventListener('click', closeModelPreview);
      keyDownHandler = (e) => {
        if (e.key === 'Escape') closeModelPreview();
      };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModelPreview();
      });
      document.addEventListener('keydown', keyDownHandler);
      return overlay;
    }

    function setStatus(message, tone = 'info') {
      const statusEl = overlayEl?.querySelector('#model-preview-status');
      const canvasEl = overlayEl?.querySelector('#model-preview-canvas');
      if (!statusEl) return;
      if (!message) {
        statusEl.classList.add('hidden');
        canvasEl?.classList.remove('hidden');
        return;
      }
      canvasEl?.classList.add('hidden');
      statusEl.classList.remove('hidden');
      statusEl.className = `absolute inset-0 flex items-center justify-center text-[12px] px-6 text-center ${tone === 'error' ? 'text-red-400' : 'text-zinc-400'}`;
      statusEl.textContent = message;
    }

    const ERROR_MESSAGES = {
      package_not_found: 'パッケージファイルが見つかりませんでした。',
      no_mesh_found: 'このパッケージには表示可能な3Dモデル（.fbx/.obj）が見つかりませんでした。',
      __extracted_not_found: '展開フォルダがありません。先にダウンロードと展開を完了してください。',
      file_not_found: '対象ファイルが見つかりませんでした。',
      unsupported_file_type: 'このファイル形式は3Dプレビューに対応していません。',
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

    async function loadMeshIntoViewer(asset, prep, mesh, token) {
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
        if (token !== openToken) return;
        const handle = await global.AvatoolThreeBridge.createViewer(canvasEl, {
          readFile,
          meshRelPath: mesh.relPath,
          ext: mesh.ext,
          textures: prep.textures || [],
        });
        if (token !== openToken) {
          handle.dispose();
          return;
        }
        viewerHandle = handle;
        setStatus('');
      } catch (e) {
        logger?.error?.('model preview render failed', e);
        setStatus('モデルの読み込みに失敗しました。', 'error');
      }
    }

    async function openModelPreview(asset, entry) {
      closeModelPreview();
      const token = ++openToken;

      overlayEl = buildOverlaySkeleton(asset?.title || entry?.name || 'モデルプレビュー');
      document.body.appendChild(overlayEl);
      setStatus('展開しています...');

      try {
        const prep = await boothAPI.prepareModelPreview(asset.itemId, asset.title || '', entry.relPath);
        if (token !== openToken) return;
        if (prep?.error) {
          setStatus(mapError(prep.error), 'error');
          return;
        }
        const meshes = Array.isArray(prep.meshes) ? prep.meshes : [];
        if (!meshes.length) {
          setStatus(mapError('no_mesh_found'), 'error');
          return;
        }

        const selectEl = overlayEl.querySelector('#model-preview-mesh-select');
        if (meshes.length > 1 && selectEl) {
          selectEl.classList.remove('hidden');
          selectEl.innerHTML = meshes
            .map((m, i) => `<option value="${i}">${esc(m.relPath)}</option>`)
            .join('');
          selectEl.addEventListener('change', () => {
            const idx = Number(selectEl.value || 0);
            loadMeshIntoViewer(asset, prep, meshes[idx], token).catch((e) => logger?.error?.(e));
          });
        }

        await loadMeshIntoViewer(asset, prep, meshes[0], token);
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
