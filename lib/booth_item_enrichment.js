'use strict';

/**
 * BOOTHアイテムの後付けエンリッチ（フリー素材候補の解決、カテゴリの後追い補完）。
 * boothClient は ensureClientReady() 実行後に都度 getBoothClient() で取得する。
 */
function createBoothItemEnrichment({
  getBoothClient,
  ensureClientReady,
  extractBoothItemId,
  extractFreeDownloadLinksFromItemJson,
  fetchFreeDownloadLinksForItem,
  dedupeDownloadLinks,
  createManualFreeMetaItem,
  enrichItemAvatarMetadata,
  learnAvatarsToFile,
}) {
  async function resolveManualFreeAssetCandidate(rawInput) {
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

    let links = extractFreeDownloadLinksFromItemJson(itemJson);
    if (!links.length) {
      links = await fetchFreeDownloadLinksForItem(itemId);
    }
    links = dedupeDownloadLinks(links);
    if (!links.length) return { error: 'free_download_links_not_found' };

    const item = createManualFreeMetaItem(itemId, itemJson, links);
    return { ok: true, itemId, itemJson, links, item };
  }

  function toBoothCategoryRowsFromItemJson(itemJson) {
    const cat = itemJson?.category;
    const rows = [];
    if (cat && cat.parent) {
      rows.push({
        href: cat.parent.url,
        text: cat.parent.name,
        slug: String(cat.parent.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    if (cat) {
      rows.push({
        href: cat.url,
        text: cat.name,
        slug: String(cat.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    return rows;
  }

  async function backfillCategoriesForItemIds(items, itemIds, onProgress = null) {
    const rows = Array.isArray(items) ? items : [];
    const targetSet = new Set(
      Array.from(itemIds || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean),
    );
    if (!rows.length || !targetSet.size) return { changed: false, backfilled: 0, total: 0 };

    const targets = rows.filter((it) => targetSet.has(String(it?.itemId || '').trim()));
    if (!targets.length) return { changed: false, backfilled: 0, total: 0 };

    await ensureClientReady();
    const boothClient = getBoothClient();
    let changed = false;
    let backfilled = 0;
    const learnedAvatars = [];
    for (let i = 0; i < targets.length; i += 1) {
      const item = targets[i];
      const itemId = String(item?.itemId || '').trim();
      if (!itemId) continue;
      if (onProgress) {
        try {
          onProgress({ phase: 'categories', index: i + 1, total: targets.length });
        } catch {
          // ignore progress callback errors
        }
      }
      try {
        const res = await boothClient.get(`/ja/items/${itemId}.json`, { baseURL: 'https://booth.pm' });
        const data = res?.data || {};
        const categories = toBoothCategoryRowsFromItemJson(data);
        if (Array.isArray(categories) && categories.length > 0) {
          item.categories = categories;
          item.primaryCategory = categories[categories.length - 1] || null;
          const { learned } = enrichItemAvatarMetadata(item, data, categories);
          if (learned) learnedAvatars.push(learned);
          changed = true;
          backfilled += 1;
        }
      } catch {
        // ignore per-item errors; lightweight sync should stay resilient
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    if (learnedAvatars.length) {
      try {
        learnAvatarsToFile(learnedAvatars);
      } catch {
        // non-critical; avatars.json update failure should not break sync
      }
    }

    return { changed, backfilled, total: targets.length };
  }

  return {
    resolveManualFreeAssetCandidate,
    toBoothCategoryRowsFromItemJson,
    backfillCategoriesForItemIds,
  };
}

module.exports = { createBoothItemEnrichment };
