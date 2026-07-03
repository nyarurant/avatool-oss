(function attachRenderAppUpdateUi(global) {
  function createRenderAppUpdateUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const esc = deps?.esc;
    const isSuppressedNotificationMessage = deps?.isSuppressedNotificationMessage;
    const isImportantTransientNotification = deps?.isImportantTransientNotification;
    const upsertNotificationItem = deps?.upsertNotificationItem;
    const appUpdateRemindKey = deps?.appUpdateRemindKey || 'appUpdateRemindV1';
    const doc = deps?.document || global.document;
    const win = deps?.window || global;

    function showTransientMessage(message, tone = 'info', durationMs = 4500) {
      const text = String(message || '').trim();
      if (!text) return;
      let el = state.transientMessage.el;
      if (!el || !el.isConnected) {
        el = doc.createElement('div');
        state.transientMessage.el = el;
        doc.body.appendChild(el);
      }
      const toneClass = tone === 'error' ? 'border-red-500/60 text-red-200' : 'border-emerald-500/60 text-emerald-200';
      el.className = `fixed bottom-5 right-5 z-[100] border bg-black/90 px-3 py-2 text-[10px] font-mono-custom rounded ${toneClass}`;
      el.textContent = text;
      const now = Date.now();
      const suppressToCenter = isSuppressedNotificationMessage(text);
      const recentSame = (state.notifications || []).find((n) => (
        n?.type === 'transient'
        && String(n?.message || '') === text
        && (now - new Date(String(n?.createdAt || 0)).getTime()) <= 5000
      ));
      const importantForCenter = isImportantTransientNotification(text, tone);
      if (!suppressToCenter && importantForCenter && !recentSame) {
        upsertNotificationItem({
          id: `transient-${now}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'transient',
          title: tone === 'error' ? 'エラー' : (tone === 'warn' ? '警告' : '通知'),
          message: text,
          payload: { tone: String(tone || 'info') },
          unread: true,
        });
      }
      if (state.transientMessage.timerId) {
        clearTimeout(state.transientMessage.timerId);
        state.transientMessage.timerId = null;
      }
      const wait = Number.isFinite(Number(durationMs)) ? Math.max(1200, Number(durationMs)) : 4500;
      state.transientMessage.timerId = setTimeout(() => {
        if (state.transientMessage.el?.isConnected) state.transientMessage.el.remove();
        state.transientMessage.el = null;
        state.transientMessage.timerId = null;
      }, wait);
    }

    function setAppUpdateStatusUI(message, tone = 'info') {
      if (!domRefs.settingAppUpdateStatus) return;
      domRefs.settingAppUpdateStatus.textContent = String(message || '');
      if (tone === 'error') {
        domRefs.settingAppUpdateStatus.className = 'text-[10px] text-red-400 min-h-[18px]';
      } else if (tone === 'warn') {
        domRefs.settingAppUpdateStatus.className = 'text-[10px] text-amber-300 min-h-[18px]';
      } else if (tone === 'success') {
        domRefs.settingAppUpdateStatus.className = 'text-[10px] text-emerald-400 min-h-[18px]';
      } else {
        domRefs.settingAppUpdateStatus.className = 'text-[10px] text-zinc-500 min-h-[18px]';
      }
    }

    function setAppUpdateProgressUI(percent, visible = true, textOverride = '') {
      const wrap = domRefs.settingAppUpdateProgressWrap;
      const bar = domRefs.settingAppUpdateProgressBar;
      const text = domRefs.settingAppUpdateProgressText;
      const fWrap = domRefs.appUpdateProgressFloat;
      const fBar = domRefs.appUpdateProgressFloatBar;
      const fText = domRefs.appUpdateProgressFloatText;
      const p = Math.max(0, Math.min(100, Number(percent || 0)));
      const label = String(textOverride || '').trim() || `${Math.round(p)}%`;
      if (wrap && bar && text) {
        wrap.classList.toggle('hidden', !visible);
        bar.style.width = `${p}%`;
        text.textContent = label;
      }
      if (fWrap && fBar && fText) {
        fWrap.classList.toggle('hidden', !visible);
        fBar.style.width = `${p}%`;
        fText.textContent = label;
      }
    }

    function readAppUpdateRemindState() {
      try {
        const raw = localStorage.getItem(appUpdateRemindKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
          version: String(parsed.version || ''),
          remindAt: Number(parsed.remindAt || 0),
        };
      } catch {
        return null;
      }
    }

    function writeAppUpdateRemindState(version, remindAt) {
      try {
        localStorage.setItem(appUpdateRemindKey, JSON.stringify({
          version: String(version || ''),
          remindAt: Number(remindAt || 0),
        }));
      } catch {
        // ignore
      }
    }

    function isAppUpdateReminderActive(version) {
      const remindState = readAppUpdateRemindState();
      if (!remindState) return false;
      if (String(remindState.version || '') !== String(version || '')) return false;
      return Number(remindState.remindAt || 0) > Date.now();
    }

    function normalizeAppUpdateNoteLines(releaseNotes) {
      const raw = String(releaseNotes || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r/g, '')
        .trim();
      if (!raw) return [];
      const lines = raw.split('\n').map((v) => String(v || '').trim()).filter(Boolean);
      const chunks = lines.flatMap((line) => line.split('。').map((v, i, arr) => {
        const t = String(v || '').trim();
        if (!t) return '';
        return i < arr.length - 1 ? `${t}。` : t;
      }));
      return chunks
        .map((v) => String(v || '').trim())
        .map((v) => v.replace(/^[-*•・●◦]+\s*/, ''))
        .map((v) => v.replace(/^\d+[.)]\s*/, ''))
        .map((v) => v.trim())
        .filter(Boolean);
    }

    function showAppUpdateDownloadedModal(message, version = '', releaseNotes = '') {
      const existing = doc.getElementById('app-update-done-overlay');
      if (existing) existing.remove();
      const noteLines = normalizeAppUpdateNoteLines(releaseNotes);
      const normalizedVersion = String(version || '').trim();
      const primaryMessage = String(message || '').trim() || '更新のダウンロードが完了しました。再起動で適用されます。';
      const notesHtml = noteLines.length
        ? `<div class="mb-4">
          <div class="text-[11px] text-zinc-400 mb-1">更新内容</div>
          <div class="max-h-44 overflow-auto rounded border border-white/10 bg-black/30 px-2 py-2">
            <ul class="space-y-1 text-[11px] text-zinc-200 break-words">
              ${noteLines.map((line) => `<li>${esc(line)}</li>`).join('')}
            </ul>
          </div>
        </div>`
        : `<div class="mb-4">
          <div class="text-[11px] text-zinc-400 mb-1">更新内容</div>
          <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-500">-</div>
        </div>`;
      const overlay = doc.createElement('div');
      overlay.id = 'app-update-done-overlay';
      overlay.className = 'fixed inset-0 z-[115] bg-black/80 flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="w-full max-w-md bg-[#0a0a0a] border border-[#222] rounded p-5">
          <h2 class="text-sm font-bold text-emerald-300 mb-2">アップデート準備完了</h2>
          <div class="mb-4 space-y-3">
            <div>
              <div class="text-[11px] text-zinc-400 mb-1">完了メッセージ</div>
              <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-200">${esc(primaryMessage)}</div>
            </div>
            <div>
              <div class="text-[11px] text-zinc-400 mb-1">version</div>
              <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-200 font-mono-custom">${esc(normalizedVersion || '-')}</div>
            </div>
          </div>
          ${notesHtml}
          <div class="flex justify-end gap-2">
            <button id="app-update-remind-later" class="btn-action whitespace-nowrap">12時間後に通知</button>
            <button id="app-update-install-now" class="btn-action btn-primary whitespace-nowrap">更新する</button>
          </div>
        </div>
      `;
      doc.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#app-update-remind-later')?.addEventListener('click', () => {
        const remindAt = Date.now() + (12 * 60 * 60 * 1000);
        writeAppUpdateRemindState(version, remindAt);
        setAppUpdateStatusUI('更新通知を12時間後に延期しました。', 'info');
        close();
      });
      overlay.querySelector('#app-update-install-now')?.addEventListener('click', async () => {
        if (!win.boothAPI?.installAppUpdateNow) {
          setAppUpdateStatusUI('更新適用APIが利用できません。', 'error');
          return;
        }
        setAppUpdateStatusUI('更新を適用しています。アプリを再起動します...', 'info');
        try {
          await win.boothAPI.installAppUpdateNow();
        } catch (e) {
          setAppUpdateStatusUI(`更新適用に失敗: ${e?.message || e}`, 'error');
        }
        close();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    return {
      showTransientMessage,
      setAppUpdateStatusUI,
      setAppUpdateProgressUI,
      readAppUpdateRemindState,
      writeAppUpdateRemindState,
      isAppUpdateReminderActive,
      normalizeAppUpdateNoteLines,
      showAppUpdateDownloadedModal,
    };
  }

  global.AvatoolRenderAppUpdateUi = {
    createRenderAppUpdateUi,
  };
})(window);
