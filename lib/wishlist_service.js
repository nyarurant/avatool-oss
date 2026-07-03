'use strict';

/**
 * BOOTHの「ほしいものリスト」関連機能（インポート同期・Avatool独自リストへの反映）。
 * main.js から切り出し。boothClient は ensureClientReady() 実行後に都度 getBoothClient() で
 * 取得する（再接続で参照が差し替わるため、モジュールロード時に一度だけ束縛してはいけない）。
 */
function createWishlistService({
  getBoothClient,
  ensureClientReady,
  extractBoothItemId,
  extractBoothCsrfFromHtml,
  metaMgr,
  fs,
  META_PATH,
  dedupeMetaItemsByItemId,
  writeMetaFile,
}) {
  // Avatoolから追加したほしいものは、BOOTH本体の「avatool」という名前付きリストにも
  // 反映する（他のツールから手動で追加したものと見分けられるようにするため）。
  const AVATOOL_WISH_LIST_NAME = 'avatool';
  let cachedAvatoolWishListCode = null;

  // wish_list系のPOST/PATCHはRailsのCSRF検証があり、x-csrf-tokenヘッダーがないと422になる。
  // ページHTMLの<meta name="csrf-token">から取得する（addWishlistItemToBoothCartと同じ手法）。
  async function fetchBoothCsrfToken() {
    const htmlRes = await getBoothClient().get('/ja', {
      baseURL: 'https://booth.pm',
      responseType: 'text',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    return extractBoothCsrfFromHtml(String(htmlRes?.data || ''));
  }

  async function ensureAvatoolWishListCode(csrfToken) {
    if (cachedAvatoolWishListCode) return cachedAvatoolWishListCode;
    const names = await fetchWishListNames();
    const existing = names.find((n) => String(n?.name || '') === AVATOOL_WISH_LIST_NAME);
    if (existing?.code) {
      cachedAvatoolWishListCode = String(existing.code);
      return cachedAvatoolWishListCode;
    }
    const res = await getBoothClient().post(
      'https://accounts.booth.pm/wish_list_names.json',
      { name: AVATOOL_WISH_LIST_NAME },
      {
        baseURL: 'https://accounts.booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      },
    );
    cachedAvatoolWishListCode = String(res?.data?.code || '');
    return cachedAvatoolWishListCode || null;
  }

  async function addItemToAvatoolWishListName(itemId) {
    try {
      await ensureClientReady();
      const csrfToken = await fetchBoothCsrfToken();
      const boothClient = getBoothClient();

      // 1. 汎用ほしいリスト（ハートアイコン相当）に入れる。既に入っていても200が返るだけ。
      await boothClient.post(`https://booth.pm/items/${itemId}/wish_list`, null, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken },
      });

      const avatoolCode = await ensureAvatoolWishListCode(csrfToken);
      if (!avatoolCode) return;

      // 2. 現在このアイテムがどの名前付きリストに属しているか確認し、avatoolを追加した集合をPATCH。
      const currentRes = await boothClient.get(`https://booth.pm/items/${itemId}/wish_list_items.json`, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json' },
      });
      const current = Array.isArray(currentRes?.data) ? currentRes.data : [];
      const currentCodes = current.filter((n) => n?.is_item_in_wish_list_name).map((n) => String(n.wish_list_name_code));
      if (currentCodes.includes(avatoolCode)) return;
      const nextCodes = [...currentCodes, avatoolCode];
      await boothClient.patch(`https://booth.pm/items/${itemId}/wish_list_items.json`, { wish_list_name_codes: nextCodes }, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      });
    } catch {
      // BOOTH側への反映に失敗しても、ローカルのほしいリスト登録自体は成功させたいので握りつぶす。
    }
  }

  async function removeItemFromAvatoolWishListName(itemId) {
    try {
      await ensureClientReady();
      const csrfToken = await fetchBoothCsrfToken();
      const avatoolCode = await ensureAvatoolWishListCode(csrfToken);
      if (!avatoolCode) return;
      const boothClient = getBoothClient();
      const currentRes = await boothClient.get(`https://booth.pm/items/${itemId}/wish_list_items.json`, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json' },
      });
      const current = Array.isArray(currentRes?.data) ? currentRes.data : [];
      const currentCodes = current.filter((n) => n?.is_item_in_wish_list_name).map((n) => String(n.wish_list_name_code));
      if (!currentCodes.includes(avatoolCode)) return;
      const nextCodes = currentCodes.filter((c) => c !== avatoolCode);
      await boothClient.patch(`https://booth.pm/items/${itemId}/wish_list_items.json`, { wish_list_name_codes: nextCodes }, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      });
    } catch {
      // ベストエフォート。失敗してもローカルのisWishlisted解除自体は成功させる。
    }
  }

  async function resolveWishlistCandidate(rawInput) {
    await ensureClientReady();
    const itemId = extractBoothItemId(rawInput);
    if (!itemId) return { error: 'invalid_item_id_or_url' };

    let itemJson = {};
    try {
      const jsonRes = await getBoothClient().get(`/ja/items/${itemId}.json`, { responseType: 'json' });
      itemJson = jsonRes?.data || {};
    } catch (e) {
      return { error: `item_json_fetch_failed: ${e?.message || String(e)}` };
    }

    const item = metaMgr.createWishlistMetaItem(itemId, itemJson);
    addItemToAvatoolWishListName(itemId).catch(() => {});
    return { ok: true, itemId, itemJson, item };
  }

  // 「ほしいものリスト」機能（複数の名前付きリストにアイテムを分類できる、booth.pm/mypage
  // のリニューアルで追加された仕組み）の一覧を取得する。現状Avatoolはリスト名ごとの分類までは
  // 保持せず、単に「ほしいリストに入っているか」だけを見るため、主にログ・将来の拡張用途。
  async function fetchWishListNames() {
    await ensureClientReady();
    try {
      const res = await getBoothClient().get('https://accounts.booth.pm/wish_list_names.json', {
        baseURL: 'https://accounts.booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json' },
      });
      return Array.isArray(res?.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  // wish_list_name_items.json はページ単位で、名前付きリストを横断した「ほしいものリスト」の
  // アイテムをまとめて返す。1アイテムずつ /ja/items/{id}.json を叩く旧実装と違い、
  // サムネイル・ショップ・カテゴリなど表示に必要な情報が最初から含まれているため、
  // ページ数分のリクエストだけで済む。
  async function fetchWishListNameItemsPage(page) {
    const res = await getBoothClient().get('https://accounts.booth.pm/wish_list_name_items.json', {
      baseURL: 'https://accounts.booth.pm',
      params: { page },
      responseType: 'json',
      headers: { Accept: 'application/json' },
    });
    return res?.data || {};
  }

  async function importBoothWishlist({ onProgress } = {}) {
    await ensureClientReady();

    const wishListNames = await fetchWishListNames();

    let allItems = [];
    try {
      let page = 1;
      let totalPages = 1;
      do {
        const data = await fetchWishListNameItemsPage(page);
        const items = Array.isArray(data?.items) ? data.items : [];
        allItems = allItems.concat(items);
        totalPages = Number(data?.pagination?.total_pages || 1) || 1;
        onProgress?.({ done: allItems.length, total: null, page, totalPages });
        page++;
        if (page <= totalPages) {
          // gentle throttle between page fetches only (not per item)
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
        }
      } while (page <= totalPages);
    } catch (e) {
      return { error: `fetch_failed: ${e?.message || String(e)}` };
    }

    // Load existing meta to find already-registered items
    let meta = [];
    if (fs.existsSync(META_PATH)) {
      try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { meta = []; }
      if (!Array.isArray(meta)) meta = [];
    }
    const existingIds = new Set(meta.map((m) => String(m?.itemId || '')));
    const boothItemIds = new Set(allItems.map((it) => String(it?.id || '').trim()).filter(Boolean));

    const toImport = allItems.filter((it) => !existingIds.has(String(it?.id || '')));
    const skipped = allItems.length - toImport.length;

    let imported = 0;
    const errors = [];
    for (const rawItem of toImport) {
      const itemId = String(rawItem?.id || '').trim();
      if (!itemId) continue;
      try {
        const item = metaMgr.createWishlistMetaItem(itemId, rawItem);
        meta = dedupeMetaItemsByItemId([...meta, item]);
        imported++;
      } catch (e) {
        errors.push({ itemId, error: e?.message || String(e) });
      }
    }

    // Full mirror: BOOTH is the source of truth for the wishlist. Reconcile isWishlisted for
    // items that are still wishlist-only (never touch already-purchased/owned items, since
    // BOOTH itself clears bought items from the wishlist and ownership tracking is separate).
    const now = new Date().toISOString();
    let mirrored = 0;
    meta = meta.map((m) => {
      if (!metaMgr.isWishlistOnlyMetaItem(m)) return m;
      const itemId = String(m?.itemId || '').trim();
      const inBooth = boothItemIds.has(itemId);
      if (inBooth && !m.isWishlisted) {
        mirrored++;
        return { ...m, isWishlisted: true, wishlistAddedAt: m.wishlistAddedAt || now };
      }
      if (!inBooth && m.isWishlisted) {
        mirrored++;
        return { ...m, isWishlisted: false };
      }
      return m;
    });

    if (imported > 0 || mirrored > 0) {
      writeMetaFile(meta);
    }

    return { ok: true, imported, skipped, mirrored, total: allItems.length, errors, wishListNames };
  }

  return {
    resolveWishlistCandidate,
    addItemToAvatoolWishListName,
    removeItemFromAvatoolWishListName,
    importBoothWishlist,
  };
}

module.exports = { createWishlistService };
