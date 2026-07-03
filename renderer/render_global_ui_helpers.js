(function attachRenderGlobalUiHelpers(global) {
  function createRenderGlobalUiHelpers(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const isElementShown = deps?.isElementShown;
    const stopShortcutCapture = deps?.stopShortcutCapture;
    const clearSelectionMode = deps?.clearSelectionMode;
    const closeManualAddModal = deps?.closeManualAddModal;
    const closeWishlistAddModal = deps?.closeWishlistAddModal;
    const closePackageSelectionModal = deps?.closePackageSelectionModal;
    const closeImportModal = deps?.closeImportModal;
    const closePreviewModal = deps?.closePreviewModal;
    const closeProjectItemsModal = deps?.closeProjectItemsModal;
    const closeAutoBootstrapModal = deps?.closeAutoBootstrapModal;
    const setAvatarFilterPanelOpen = (...args) => deps?.setAvatarFilterPanelOpen(...args);
    const renderGrid = (...args) => deps?.renderGrid(...args);
    const doc = deps?.document || global.document;

    function clickIfEnabled(el) {
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }

    function focusSearchInput(selectAll = true) {
      if (!domRefs.searchInput) return false;
      domRefs.searchInput.focus();
      if (selectAll && typeof domRefs.searchInput.select === 'function') {
        domRefs.searchInput.select();
      }
      return true;
    }

    function isConfirmModalOpen() {
      const btn = doc.querySelector('[data-role="confirm"]');
      return Boolean(btn && btn.closest('.fixed'));
    }

    function closeTopOverlayOrMode() {
      const shortcutsGuideClose = doc.querySelector('#shortcuts-guide-close');
      if (shortcutsGuideClose) {
        shortcutsGuideClose.click();
        return true;
      }
      const confirmCancel = doc.querySelector('[data-role="cancel"]');
      if (confirmCancel && confirmCancel.closest('.fixed')) {
        confirmCancel.click();
        return true;
      }
      const notifyClose = doc.querySelector('#notify-center-close');
      if (notifyClose) {
        notifyClose.click();
        return true;
      }
      const updatesClose = doc.querySelector('#updates-close');
      if (updatesClose) {
        updatesClose.click();
        return true;
      }
      const historyClose = doc.querySelector('#history-close');
      if (historyClose) {
        historyClose.click();
        return true;
      }
      if (isElementShown(domRefs.manualAddModal)) {
        closeManualAddModal();
        return true;
      }
      if (isElementShown(domRefs.wishlistAddModal)) {
        closeWishlistAddModal();
        return true;
      }
      if (isElementShown(domRefs.pkgSelectModal)) {
        closePackageSelectionModal();
        return true;
      }
      if (isElementShown(domRefs.importModal)) {
        return closeImportModal();
      }
      if (isElementShown(domRefs.previewOverlay)) {
        closePreviewModal();
        return true;
      }
      if (isElementShown(domRefs.projectItemsModal)) {
        closeProjectItemsModal();
        return true;
      }
      if (isElementShown(domRefs.autoBootstrapModal)) {
        closeAutoBootstrapModal();
        return true;
      }
      if (isElementShown(domRefs.settingsModal)) {
        stopShortcutCapture();
        domRefs.settingsModal.classList.add('hidden');
        domRefs.settingsModal.classList.remove('flex');
        return true;
      }
      if (state.avatarFilterPanelOpen) {
        setAvatarFilterPanelOpen(false);
        return true;
      }
      if (state.selectionMode) {
        clearSelectionMode();
        renderGrid();
        return true;
      }
      return false;
    }

    return {
      clickIfEnabled,
      focusSearchInput,
      isConfirmModalOpen,
      closeTopOverlayOrMode,
    };
  }

  global.AvatoolRenderGlobalUiHelpers = {
    createRenderGlobalUiHelpers,
  };
})(window);
