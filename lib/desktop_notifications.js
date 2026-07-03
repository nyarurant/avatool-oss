'use strict';

function createDesktopNotifications({ Notification, path }) {
  function showDesktopNotification(title, body, imageUrl) {
    try {
      const supported = Boolean(Notification && Notification.isSupported?.());
      console.log('[NOTIFY][main]', `supported=${supported}`, String(title || ''), String(body || ''));
      if (!supported) return false;
      const opts = {
        title: String(title || 'Avatool'),
        body: String(body || ''),
        silent: false,
      };
      let imgSrc = null;
      if (typeof imageUrl === 'string' && imageUrl) {
        if (imageUrl.startsWith('https://')) {
          imgSrc = imageUrl;
        } else if (imageUrl.startsWith('file:///')) {
          imgSrc = imageUrl;
        } else if (imageUrl.length > 0) {
          // ローカルファイルパスを file:// URI に変換
          imgSrc = 'file:///' + imageUrl.replace(/\\/g, '/');
        }
      }
      if (imgSrc && process.platform === 'win32') {
        const esc = (s) => String(s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        opts.toastXml = [
          '<toast duration="long">',
          '<visual><binding template="ToastGeneric">',
          `<text>${esc(opts.title)}</text>`,
          `<text>${esc(opts.body)}</text>`,
          `<image src="${esc(imgSrc)}"/>`,
          '</binding></visual>',
          '</toast>',
        ].join('');
      }
      const n = new Notification(opts);
      n.show();
      return true;
    } catch (e) {
      console.warn('[notify] failed:', e?.message || e);
      return false;
    }
  }

  function formatElapsedMs(ms) {
    const n = Math.max(0, Number(ms || 0));
    const totalSec = Math.floor(n / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m <= 0) return `${s}秒`;
    return `${m}分${s}秒`;
  }

  function sendDesktopNotificationForAutoBootstrap(payload) {
    const phase = String(payload?.phase || '').trim();
    const source = String(payload?.source || '').trim();
    const projectName = path.basename(String(payload?.projectPath || '').trim()) || 'Project';
    const msg = String(payload?.message || '').trim();
    const elapsedMs = Number(payload?.elapsedMs || 0);
    const elapsedText = elapsedMs > 0 ? ` (所要時間: ${formatElapsedMs(elapsedMs)})` : '';
    const isStartup = source === 'startup';
    // Startup auto-download status is surfaced in-app via renderer messages only.
    if (isStartup) return;
    if (phase === 'started') {
      showDesktopNotification('自動インポート開始', `${projectName}: 自動インポートが作動中です。インポートと初期コンパイルを実行します。処理完了までこのプロジェクトを開かないでください。`);
      return;
    }
    if (phase === 'done') {
      showDesktopNotification('自動インポート完了', msg || `${projectName}: 自動インポートが完了しました。${elapsedText}`);
      return;
    }
    if (phase === 'skipped') {
      showDesktopNotification('自動インポートスキップ', msg || `${projectName}: 自動インポートはスキップされました。${elapsedText}`);
      return;
    }
    if (phase === 'error') {
      showDesktopNotification('自動インポート失敗', msg || `${projectName}: 自動インポートに失敗しました。${elapsedText}`);
    }
  }

  return {
    showDesktopNotification,
    formatElapsedMs,
    sendDesktopNotificationForAutoBootstrap,
  };
}

module.exports = { createDesktopNotifications };
