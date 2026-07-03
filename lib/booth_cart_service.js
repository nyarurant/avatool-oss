'use strict';

const cheerio = require('cheerio');

/**
 * BOOTHのカート追加・カート取得（ショッピングカートHTTPフロー）。
 * boothClient は ensureClientReady() 実行後に都度 getBoothClient() で取得する
 * （再接続で参照が差し替わるため、モジュールロード時に一度だけ束縛してはいけない）。
 */
function createBoothCartService({ getBoothClient, ensureClientReady, extractBoothItemId }) {
  function extractBoothCsrfFromHtml(html) {
    const $ = cheerio.load(String(html || ''));
    return String(
      $('meta[name="csrf-token"]').attr('content') ||
      $('input[name="authenticity_token"]').first().attr('value') ||
      '',
    ).trim();
  }

  async function addWishlistItemToBoothCart(rawInput, variationName) {
    await ensureClientReady();
    const itemId = extractBoothItemId(rawInput);
    if (!itemId) return { error: 'invalid_item_id_or_url' };
    const boothClient = getBoothClient();

    // Fetch JSON (variation IDs + shop subdomain) and HTML (CSRF token) in parallel
    let jsonData, csrfToken;
    try {
      const [jsonRes, htmlRes] = await Promise.all([
        boothClient.get(`/ja/items/${itemId}.json`, {
          baseURL: 'https://booth.pm',
          responseType: 'json',
          headers: { Accept: 'application/json' },
        }),
        boothClient.get(`/ja/items/${itemId}`, {
          baseURL: 'https://booth.pm',
          responseType: 'text',
          headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', Referer: 'https://booth.pm/' },
        }),
      ]);
      jsonData = jsonRes?.data;
      csrfToken = extractBoothCsrfFromHtml(String(htmlRes?.data || ''));
    } catch (e) {
      return { error: `item_fetch_failed: ${e?.message || String(e)}` };
    }

    if (!csrfToken) return { error: 'cart_authenticity_token_not_found' };

    const shopSubdomain = String(jsonData?.shop?.subdomain || '').trim();
    if (!shopSubdomain) return { error: 'cart_shop_not_found' };

    const variations = (Array.isArray(jsonData?.variations) ? jsonData.variations : [])
      .map((v) => ({ id: String(v?.id || ''), name: String(v?.name || '').trim() }))
      .filter((v) => v.id);

    let resolvedVariationId = variations.length === 1 ? variations[0].id : '';
    if (!resolvedVariationId && variationName && variations.length > 0) {
      const needle = String(variationName).trim().toLowerCase();
      const match = variations.find((v) => v.name.toLowerCase() === needle)
        || variations.find((v) => v.name.toLowerCase().includes(needle))
        || variations.find((v) => needle.includes(v.name.toLowerCase()));
      if (match) resolvedVariationId = match.id;
    }

    if (!resolvedVariationId) {
      return {
        error: variations.length > 1 ? 'cart_variation_ambiguous' : 'cart_variation_not_found',
        variationCount: variations.length,
        variations,
      };
    }

    const cartUrl = new URL(`https://${shopSubdomain}.booth.pm/cart`);
    cartUrl.searchParams.set('added_to_cart', 'true');
    cartUrl.searchParams.set('via', 'market');

    const body = new URLSearchParams();
    body.set('_method', 'patch');
    body.set('cart_item[variation_id]', resolvedVariationId);
    body.set('authenticity_token', csrfToken);

    let cartPageHtml = '';
    try {
      const postRes = await boothClient.post(cartUrl.toString(), body.toString(), {
        responseType: 'text',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://booth.pm',
          Referer: 'https://booth.pm/',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      cartPageHtml = String(postRes?.data || '');
    } catch (e) {
      const status = e?.response?.status || null;
      return { error: `cart_add_failed${status ? `:${status}` : ''}: ${e?.message || String(e)}` };
    }

    // Extract checkout URL from the cart page response
    // Pattern: href="https://checkout.booth.pm/checkout/step1?uuid=UUID"
    let checkoutUrl = null;
    const checkoutMatch = /https:\/\/checkout\.booth\.pm\/checkout\/step1\?uuid=[a-f0-9-]+[^"'\s]*/i.exec(cartPageHtml);
    if (checkoutMatch) {
      checkoutUrl = checkoutMatch[0];
    }

    // Fallback: fetch cart.json to get checkout URL
    if (!checkoutUrl) {
      try {
        const cartBase = new URL(cartUrl.toString());
        cartBase.pathname = '/cart.json';
        cartBase.search = '';
        const cartJson = await boothClient.get(cartBase.toString(), {
          responseType: 'json',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: cartUrl.toString() },
        });
        const cartData = cartJson?.data;
        const checkoutPath =
          cartData?.carts?.[0]?.shop?.checkout_url ||
          cartData?.carts?.[0]?.shop?.checkout_path ||
          cartData?.carts?.[0]?.checkout_url ||
          cartData?.carts?.[0]?.checkout_path ||
          cartData?.checkout_url ||
          cartData?.checkout_path ||
          '';
        if (checkoutPath) {
          checkoutUrl = checkoutPath.startsWith('http') ? checkoutPath : `https://checkout.booth.pm${checkoutPath}`;
        }
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      itemId,
      variationId: resolvedVariationId,
      cartUrl: cartUrl.toString(),
      checkoutUrl,
    };
  }

  async function fetchBoothCart(shopSubdomain) {
    await ensureClientReady();
    const subdomain = String(shopSubdomain || '').trim();
    try {
      const url = subdomain
        ? `https://${subdomain}.booth.pm/cart.json`
        : 'https://booth.pm/carts.json';
      const res = await getBoothClient().get(url, {
        responseType: 'json',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: subdomain ? `https://${subdomain}.booth.pm/cart` : 'https://booth.pm/cart',
        },
      });
      return { ok: true, data: res?.data, global: !subdomain };
    } catch (e) {
      return { error: `cart_fetch_failed: ${e?.message || String(e)}` };
    }
  }

  return {
    extractBoothCsrfFromHtml,
    addWishlistItemToBoothCart,
    fetchBoothCart,
  };
}

module.exports = { createBoothCartService };
