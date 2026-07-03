(function attachRenderModuleRegistry(global) {
  function createRenderModuleRegistry(deps) {
    const doc = deps?.document || global.document;
    const win = deps?.window || global;

    const rendererModules = {};
    const rendererModuleFailures = [];
    const rendererModuleFailureKeys = new Set();

    function requireRendererFactory(globalName, createName) {
      const mod = win[globalName];
      const factory = mod?.[createName];
      if (typeof factory !== 'function') {
        throw new Error(`${globalName}.${createName} is not loaded.`);
      }
      return factory;
    }

    function getRendererModuleErrorMessage(error) {
      const message = String(error?.message || error || 'unknown renderer module error').trim();
      return message || 'unknown renderer module error';
    }

    function recordRendererModuleFailure(moduleKey, stage, error) {
      const message = getRendererModuleErrorMessage(error);
      const key = `${moduleKey}:${stage}:${message}`;
      if (rendererModuleFailureKeys.has(key)) return;
      rendererModuleFailureKeys.add(key);
      rendererModuleFailures.push({
        moduleKey: String(moduleKey || 'unknown'),
        stage: String(stage || 'unknown'),
        message,
        stack: String(error?.stack || ''),
        timestamp: new Date().toISOString(),
      });
      console.error(`[renderer-module:${moduleKey}] ${stage} failed`, error);
    }

    function callRendererModule(moduleKey, methodName, args) {
      const api = rendererModules[moduleKey];
      const method = api?.[methodName];
      if (typeof method !== 'function') {
        recordRendererModuleFailure(moduleKey, methodName, new Error(`Renderer module not ready: ${moduleKey}.${methodName}`));
        return undefined;
      }
      try {
        return method(...args);
      } catch (error) {
        recordRendererModuleFailure(moduleKey, methodName, error);
        return undefined;
      }
    }

    function safeCreateRendererModule(moduleKey, factory) {
      try {
        const api = factory();
        rendererModules[moduleKey] = api || null;
        return api || null;
      } catch (error) {
        rendererModules[moduleKey] = null;
        recordRendererModuleFailure(moduleKey, 'create', error);
        return null;
      }
    }

    function safeBindRendererModule(moduleKey, methodName) {
      const api = rendererModules[moduleKey];
      const method = api?.[methodName];
      if (typeof method !== 'function') return false;
      try {
        method.call(api);
        return true;
      } catch (error) {
        recordRendererModuleFailure(moduleKey, methodName, error);
        return false;
      }
    }

    function renderRendererDegradedBanner() {
      if (!rendererModuleFailures.length || !doc?.body) return;
      let banner = doc.getElementById('renderer-degraded-banner');
      const failureCount = rendererModuleFailures.length;
      const moduleNames = Array.from(new Set(rendererModuleFailures.map((entry) => entry.moduleKey))).slice(0, 4).join(', ');
      if (!banner) {
        banner = doc.createElement('div');
        banner.id = 'renderer-degraded-banner';
        banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[140] max-w-[92vw] rounded-lg border border-amber-400/40 bg-amber-950/90 px-4 py-2 text-[11px] text-amber-100 shadow-xl backdrop-blur';
        banner.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="min-w-0">
              <div class="font-semibold">一部機能を無効化して起動しました</div>
              <div id="renderer-degraded-banner-text" class="text-amber-200/90"></div>
            </div>
            <button id="renderer-degraded-banner-log" class="btn-action whitespace-nowrap">ログを開く</button>
          </div>
        `;
        doc.body.appendChild(banner);
        banner.querySelector('#renderer-degraded-banner-log')?.addEventListener('click', () => {
          win.boothAPI?.openRuntimeLogWindow?.().catch?.(() => {});
        });
      }
      const text = banner.querySelector('#renderer-degraded-banner-text');
      if (text) {
        text.textContent = `${failureCount} 件の初期化失敗を検出しました。影響モジュール: ${moduleNames || 'unknown'}`;
      }
    }

    async function safeRunRendererStartupStep(stepName, run) {
      try {
        return await run();
      } catch (error) {
        recordRendererModuleFailure('startup', stepName, error);
        return undefined;
      }
    }

    function getRendererModule(moduleKey) {
      return rendererModules[moduleKey];
    }

    return {
      requireRendererFactory,
      callRendererModule,
      getRendererModuleErrorMessage,
      recordRendererModuleFailure,
      safeCreateRendererModule,
      safeBindRendererModule,
      renderRendererDegradedBanner,
      safeRunRendererStartupStep,
      getRendererModule,
    };
  }

  global.AvatoolRenderModuleRegistry = {
    createRenderModuleRegistry,
  };
})(window);
