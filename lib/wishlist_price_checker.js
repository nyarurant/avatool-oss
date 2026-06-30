'use strict';

const PRICE_CHECK_STALE_MS = 6 * 60 * 60 * 1000; // 6h
const REQUEST_DELAY_MS = 2000;
const REQUEST_JITTER_MS = 1500;

async function runWishlistPriceCheck({ metaPath, fs, fetchItemPricePublic, writeMetaFile, onPriceDrop, log }) {
  let meta = [];
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    meta = JSON.parse(raw);
    if (!Array.isArray(meta)) return;
  } catch {
    return;
  }

  const now = Date.now();
  const stale = meta.filter((item) =>
    item?.isWishlisted &&
    !item?.isRemoved &&
    (now - (item?.lastPriceCheckedAt || 0)) > PRICE_CHECK_STALE_MS,
  );

  if (!stale.length) return;
  const MAX_CHECK = 500;
  const targets = stale.length > MAX_CHECK ? stale.slice(0, MAX_CHECK) : stale;
  if (log) log(`[WishlistPriceChecker] ${targets.length}件をチェックします${stale.length > MAX_CHECK ? `（上限 ${MAX_CHECK} 件、残り ${stale.length - MAX_CHECK} 件は次回）` : ''}\n`);

  for (let i = 0; i < targets.length; i += 1) {
    const item = targets[i];
    try {
      const result = await fetchItemPricePublic(item.itemId);
      if (!result) continue;

      const prevPrice = typeof item.price === 'number' ? item.price : null;
      const currentPrice = result.price;

      // 毎回ファイルを読み直して上書き競合を避ける
      let freshMeta = [];
      try {
        freshMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (!Array.isArray(freshMeta)) freshMeta = [...meta];
      } catch {
        freshMeta = [...meta];
      }

      const idx = freshMeta.findIndex((m) => String(m?.itemId || '') === String(item.itemId || ''));
      if (idx === -1) continue;

      freshMeta[idx] = {
        ...freshMeta[idx],
        price: currentPrice,
        priceMin: typeof result.priceMin === 'number' ? result.priceMin : currentPrice,
        priceMax: typeof result.priceMax === 'number' ? result.priceMax : currentPrice,
        priceVariationCount: Number.isFinite(Number(result.priceVariationCount)) ? Number(result.priceVariationCount) : 0,
        priceVariations: Array.isArray(result.priceVariations) ? result.priceVariations : [],
        lastPriceCheckedAt: Date.now(),
      };
      writeMetaFile(freshMeta);
      meta = freshMeta;

      if (prevPrice !== null && currentPrice < prevPrice) {
        if (log) log(`[WishlistPriceChecker] 値下げ検知: ${item.itemId} ¥${prevPrice} → ¥${currentPrice}\n`);
        if (onPriceDrop) onPriceDrop(item, prevPrice, currentPrice);
      }
    } catch (e) {
      if (log) log(`[WishlistPriceChecker] エラー (${item.itemId}): ${e?.message}\n`);
    }

    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS + Math.random() * REQUEST_JITTER_MS));
    }
  }
}

module.exports = { runWishlistPriceCheck };
