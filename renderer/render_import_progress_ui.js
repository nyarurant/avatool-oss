(function attachRenderImportProgressUi(global) {
  function createRenderImportProgressUi(deps) {
    const domRefs = deps?.domRefs || {};
    const state = deps?.state || {};

    function setImportPhase(phase, text) {
      const indicator = domRefs.importPhaseIndicator;
      if (!indicator) return;
      if (!phase) {
        indicator.classList.add('hidden');
        return;
      }
      indicator.classList.remove('hidden');
      if (domRefs.importPhaseText) domRefs.importPhaseText.textContent = text || '';
      const isDone = phase === 'done';
      const isError = phase === 'error';
      if (domRefs.importPhaseDot) {
        domRefs.importPhaseDot.style.background = isDone ? '#10b981' : isError ? '#ef4444' : '#3b82f6';
        domRefs.importPhaseDot.style.animationPlayState = (isDone || isError) ? 'paused' : 'running';
      }
      if (domRefs.importPhaseText) {
        domRefs.importPhaseText.style.color = isDone ? '#34d399' : isError ? '#f87171' : '';
      }
      indicator.style.borderColor = isDone
        ? 'rgba(16,185,129,0.2)'
        : isError
          ? 'rgba(239,68,68,0.2)'
          : 'rgba(59,130,246,0.15)';
      indicator.style.background = isDone
        ? 'rgba(16,185,129,0.05)'
        : isError
          ? 'rgba(239,68,68,0.05)'
          : 'rgba(59,130,246,0.05)';
    }

    function setImportProgress(percent, text = '') {
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      if (domRefs.importProgressWrap) domRefs.importProgressWrap.classList.remove('hidden');
      if (domRefs.importProgressBar) domRefs.importProgressBar.style.width = `${p}%`;
      if (domRefs.importProgressText) domRefs.importProgressText.textContent = text || `${Math.round(p)}%`;
    }

    function resetImportProgress() {
      if (domRefs.importProgressBar) domRefs.importProgressBar.style.width = '0%';
      if (domRefs.importProgressText) domRefs.importProgressText.textContent = '0%';
      if (domRefs.importProgressWrap) domRefs.importProgressWrap.classList.add('hidden');
      setImportPhase(null);
    }

    function setImportAcknowledgeMode(enabled) {
      const on = Boolean(enabled);
      if (domRefs.importCloseBtn) {
        domRefs.importCloseBtn.textContent = on ? 'OK' : '閉じる';
        domRefs.importCloseBtn.classList.toggle('btn-primary', on);
      }
      if (on && domRefs.importBusyIndicator) {
        domRefs.importBusyIndicator.classList.add('hidden');
      }
      if (domRefs.importExecuteBtn) {
        domRefs.importExecuteBtn.disabled = on || !state.importModal?.selectedProject;
      }
      if (domRefs.importDryRunBtn) {
        domRefs.importDryRunBtn.disabled = on || !state.importModal?.selectedProject;
      }
    }

    function setImportActionButtonsBusy(busy) {
      const on = Boolean(busy);
      if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.classList.toggle('hidden', on);
      if (domRefs.importDryRunBtn) domRefs.importDryRunBtn.classList.toggle('hidden', on);
      if (domRefs.importBusyIndicator) domRefs.importBusyIndicator.classList.toggle('hidden', !on);
    }

    function setImportCloseDisabled(disabled) {
      if (domRefs.importCloseBtn) {
        const on = Boolean(disabled);
        domRefs.importCloseBtn.disabled = on;
        domRefs.importCloseBtn.style.opacity = on ? '0.4' : '';
      }
    }

    return {
      setImportProgress,
      resetImportProgress,
      setImportAcknowledgeMode,
      setImportActionButtonsBusy,
      setImportCloseDisabled,
      setImportPhase,
    };
  }

  global.AvatoolRenderImportProgressUi = {
    createRenderImportProgressUi,
  };
})(window);
