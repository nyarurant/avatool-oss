(function attachRenderOverlays(global) {
  function createRenderOverlays(deps) {
    const state = deps?.state;
    const esc = deps?.esc || ((value) => String(value || ''));
    const toItemIdKey = deps?.toItemIdKey || ((value) => String(value || ''));
    const getAssetByItemId = deps?.getAssetByItemId;
    const enqueueAssets = deps?.enqueueAssets;

    if (!state || typeof getAssetByItemId !== 'function' || typeof enqueueAssets !== 'function') {
      throw new Error('createRenderOverlays requires state and asset enqueue helpers.');
    }

    function showConfirmModal(options = {}) {
      const title = String(options.title || '確認');
      const message = String(options.message || 'この操作を実行しますか？');
      const confirmText = String(options.confirmText || '実行');
      const cancelText = String(options.cancelText || 'キャンセル');
      const confirmClass = options.danger
        ? 'border-red-600 text-red-200 hover:bg-red-700/20'
        : 'btn-primary';

      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-md bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
            <div class="text-sm font-bold text-zinc-100 mb-2">${esc(title)}</div>
            <div class="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">${esc(message)}</div>
            <div class="mt-4 flex justify-end gap-2">
              <button data-role="cancel" class="btn-action whitespace-nowrap">${esc(cancelText)}</button>
              <button data-role="confirm" class="btn-action whitespace-nowrap ${confirmClass}">${esc(confirmText)}</button>
            </div>
          </div>
        `;

        const close = (value) => {
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve(Boolean(value));
        };

        const onKeyDown = (event) => {
          if (event.key === 'Escape') close(false);
          if (event.key === 'Enter') close(true);
        };

        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close(false);
        });
        overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close(false));
        overlay.querySelector('[data-role="confirm"]')?.addEventListener('click', () => close(true));
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function showDownloadScopeModal(options = {}) {
      const allCount = Math.max(0, Number(options.allCount || 0));
      const undownloadedCount = Math.max(0, Number(options.undownloadedCount || 0));
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[121] bg-black/70 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-xl bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
            <div class="flex items-start justify-between gap-3 mb-3">
              <div>
                <div class="text-sm font-bold text-zinc-100">ダウンロード対象を選択</div>
                <div class="text-[10px] text-zinc-400 mt-0.5">実行モードを1つ選択してください</div>
              </div>
              <div class="text-[10px] text-zinc-500 font-mono-custom shrink-0">SELECT MODE</div>
            </div>
            <div class="rounded-lg px-3 py-2 text-[10px] mb-3" style="background:#0e0e12;border:1px solid rgba(255,255,255,0.05);color:#a1a1aa;">
              推奨: 「未DLのみ」で必要な分だけ取得すると処理が軽くなります。
            </div>
            <div class="text-[10px] text-zinc-400 mb-3">
              未DL: <span class="text-zinc-200 font-mono-custom">${undownloadedCount}</span> 件 /
              全体: <span class="text-zinc-200 font-mono-custom">${allCount}</span> 件
            </div>
            <div class="space-y-2">
              <button data-action-mode="undownloaded" class="w-full text-left rounded-lg px-3 py-2.5 transition focus-visible:outline-none" style="background:#111115;border:1px solid rgba(255,255,255,0.06);">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[12px] font-bold text-zinc-300 tracking-wide">未DLのみ（推奨）</span>
                  <span class="text-[10px] text-zinc-400 font-mono-custom">1</span>
                </div>
                <div class="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">まだダウンロードしていないアイテムだけ取得します。</div>
              </button>
              <button data-action-mode="all" class="w-full text-left rounded-lg px-3 py-2.5 transition focus-visible:outline-none" style="background:#111115;border:1px solid rgba(255,255,255,0.06);">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[12px] font-bold text-zinc-300 tracking-wide">全アイテム</span>
                  <span class="text-[10px] text-zinc-400 font-mono-custom">2</span>
                </div>
                <div class="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">ダウンロード済みを含むすべてのアイテムを対象にします。</div>
              </button>
            </div>
            <div class="mt-3 text-[10px] text-zinc-500 font-mono-custom">
              Shortcut: [1] 未DLのみ / [2] 全アイテム / [Enter] 未DLのみ / [Ctrl+Enter] 全アイテム / [Esc] キャンセル
            </div>
            <div class="mt-3 flex justify-end gap-2 border-t border-white/10 pt-3">
              <button data-role="cancel" class="btn-action whitespace-nowrap">キャンセル</button>
            </div>
          </div>
        `;

        const close = (mode) => {
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve(mode || '');
        };

        const onKeyDown = (event) => {
          if (event.key === 'Escape') close('');
          if (event.key === 'Enter') {
            if (event.ctrlKey) close('all');
            else close('undownloaded');
          }
          if (event.key === '1') close('undownloaded');
          if (event.key === '2') close('all');
        };

        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close('');
        });
        overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close(''));
        overlay.querySelectorAll('[data-action-mode]').forEach((button) => {
          const mode = String(button.getAttribute('data-action-mode') || '');
          button.addEventListener('mouseenter', () => { button.style.background = '#17171c'; });
          button.addEventListener('mouseleave', () => { button.style.background = '#111115'; });
          button.addEventListener('click', () => close(mode));
        });
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function showUpdateActionModal() {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[122] bg-black/70 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-xl bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
            <div class="flex items-start justify-between gap-3 mb-3">
              <div>
                <div class="text-sm font-bold text-zinc-100">更新アクション</div>
                <div class="text-[10px] text-zinc-400 mt-0.5">実行内容を1つ選択してください</div>
              </div>
              <div class="text-[10px] text-zinc-500 font-mono-custom shrink-0">SELECT MODE</div>
            </div>
            <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] text-emerald-200 mb-3">
              推奨: 「両方（同期 + 更新確認）」を使うと状態差分を避けやすくなります。
            </div>
            <div class="space-y-2">
              <button data-action-mode="both" class="group w-full text-left border border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/15 hover:border-emerald-400/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded-lg px-3 py-2.5 transition">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[12px] font-bold text-emerald-200 tracking-wide">両方（推奨）</span>
                  <span class="text-[10px] text-emerald-300 font-mono-custom border border-emerald-400/40 rounded px-1.5 py-0.5">3</span>
                </div>
                <div class="text-[10px] text-zinc-300 mt-1.5 leading-relaxed">同期を実行してから更新確認を行います。通常はこのモードでOKです。</div>
              </button>
              <button data-action-mode="sync" class="group w-full text-left border border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10 hover:border-cyan-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/55 rounded-lg px-3 py-2.5 transition">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[12px] font-bold text-cyan-200 tracking-wide">同期する</span>
                  <span class="text-[10px] text-cyan-300 font-mono-custom border border-cyan-400/35 rounded px-1.5 py-0.5">2</span>
                </div>
                <div class="text-[10px] text-zinc-300 mt-1.5 leading-relaxed">ライブラリ情報のみ最新化します。更新確認は行いません。</div>
              </button>
              <button data-action-mode="check" class="group w-full text-left border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/55 rounded-lg px-3 py-2.5 transition">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-[12px] font-bold text-amber-200 tracking-wide">更新確認だけ</span>
                  <span class="text-[10px] text-amber-300 font-mono-custom border border-amber-400/35 rounded px-1.5 py-0.5">1</span>
                </div>
                <div class="text-[10px] text-zinc-300 mt-1.5 leading-relaxed">現在の情報を使って更新有無だけ確認します。</div>
              </button>
            </div>
            <div class="mt-3 text-[10px] text-zinc-500 font-mono-custom">
              Shortcut: [1] 更新確認 / [2] 同期 / [3] 両方 / [Enter] 両方 / [Esc] キャンセル
            </div>
            <div class="mt-3 flex justify-end gap-2 border-t border-white/10 pt-3">
              <button data-role="cancel" class="btn-action whitespace-nowrap">キャンセル</button>
            </div>
          </div>
        `;

        const close = (mode) => {
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve(mode || '');
        };

        const onKeyDown = (event) => {
          if (event.key === 'Escape') close('');
          if (event.key === 'Enter') close('both');
          if (event.key === '1') close('check');
          if (event.key === '2') close('sync');
          if (event.key === '3') close('both');
        };

        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close('');
        });
        overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close(''));
        overlay.querySelector('[data-action-mode="check"]')?.addEventListener('click', () => close('check'));
        overlay.querySelector('[data-action-mode="sync"]')?.addEventListener('click', () => close('sync'));
        overlay.querySelector('[data-action-mode="both"]')?.addEventListener('click', () => close('both'));
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function showUpdateNotification(updates) {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/80 z-[90] flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-[#0a0a0a] border border-[#222] rounded p-5">
          <h2 class="text-sm font-bold text-amber-300 mb-3">${updates.length}件の更新を検出</h2>
          <div class="space-y-2 mb-4">
            ${updates.map((update) => `
              <div class="border border-[#222] bg-[#111] p-2">
                <div class="text-[11px] text-white">${esc(update.itemName || '無題')}</div>
                <div class="text-[9px] text-gray-500 font-mono-custom">ID: ${esc(String(update.itemId || ''))} | ${esc(new Date(update.detectedAt).toLocaleString('ja-JP'))}</div>
                <div class="text-[9px] text-zinc-400 font-mono-custom">追加 ${Number(update.addedCount || 0)} / 削除 ${Number(update.removedCount || 0)}</div>
              </div>
            `).join('')}
          </div>
          <div class="flex justify-end gap-2">
            <button id="updates-close" class="btn-action whitespace-nowrap">閉じる</button>
            <button id="updates-download" class="btn-action btn-primary whitespace-nowrap">更新分をダウンロード</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#updates-close')?.addEventListener('click', () => overlay.remove());
      overlay.querySelector('#updates-download')?.addEventListener('click', async () => {
        const targets = (updates || [])
          .map((update) => {
            const id = toItemIdKey(update.itemId);
            const found = getAssetByItemId(id);
            if (found && update?.newHash) {
              state.expectedUpdateHashByItemId.set(id, String(update.newHash));
            }
            return found;
          })
          .filter(Boolean);
        await enqueueAssets(targets, { forceRedownload: true });
        overlay.remove();
      });
    }

    function showVersionHistory(asset) {
      const history = Array.isArray(asset.versionHistory) ? [...asset.versionHistory] : [];
      history.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
      const getFileSet = (entry) => new Set((entry?.downloadLinks || []).map((downloadLink) => `${downloadLink.downloadableId || ''}:${downloadLink.fileName || ''}`));
      const getDisplayName = (key) => {
        const idx = key.indexOf(':');
        const fileName = idx >= 0 ? key.slice(idx + 1) : key;
        return fileName || key;
      };
      const summarizeNames = (keys) => {
        const names = keys.slice(0, 5).map((key) => esc(getDisplayName(key)));
        if (keys.length > 5) names.push(`+${keys.length - 5}件`);
        return names.join(', ') || '-';
      };
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/80 z-[90] flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="w-full max-w-3xl max-h-[80vh] overflow-y-auto bg-[#0a0a0a] border border-[#222] rounded p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-white">バージョン履歴</h2>
            <button id="history-close" class="ui-component">閉じる</button>
          </div>
          <div class="text-[10px] text-gray-500 mb-3 font-mono-custom">${esc(asset.title || '無題')} (${esc(String(asset.itemId || ''))})</div>
          <div class="space-y-2">
            ${history.map((entry, idx) => `
              ${(() => {
                const newerSet = getFileSet(entry);
                const older = history[idx + 1] || null;
                const olderSet = getFileSet(older);
                const added = [...newerSet].filter((key) => !olderSet.has(key));
                const removed = [...olderSet].filter((key) => !newerSet.has(key));
                return `
              <div class="border border-[#222] bg-[#111] p-2">
                <div class="text-[10px] text-white font-mono-custom">${idx === 0 ? '最新' : `${history.length - idx}版`}</div>
                <div class="text-[9px] text-gray-400 font-mono-custom">${esc(new Date(entry.detectedAt).toLocaleString('ja-JP'))}</div>
                <div class="text-[9px] text-gray-600 font-mono-custom break-all mt-1">hash: ${esc(entry.filesHash || '-')}</div>
                <div class="text-[9px] text-gray-600 font-mono-custom">files: ${(entry.downloadLinks || []).length}</div>
                ${older ? `<div class="text-[9px] text-emerald-400 font-mono-custom mt-1">追加 (${added.length}): ${summarizeNames(added)}</div>` : ''}
                ${older ? `<div class="text-[9px] text-rose-400 font-mono-custom">削除 (${removed.length}): ${summarizeNames(removed)}</div>` : ''}
              </div>
                `;
              })()}
            `).join('')}
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#history-close')?.addEventListener('click', () => overlay.remove());
    }

    return {
      showConfirmModal,
      showDownloadScopeModal,
      showUpdateActionModal,
      showUpdateNotification,
      showVersionHistory,
    };
  }

  global.AvatoolRenderOverlays = {
    createRenderOverlays,
  };
})(window);
