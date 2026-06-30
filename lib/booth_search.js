'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const SEARCH_BASE = 'https://booth.pm/ja/search';
const HOME_URL = 'https://booth.pm/ja';
const RELATED_ITEMS_URL = 'https://api.booth.pm/frontend/related_items.json';
const TIMEOUT_MS = 12000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseSearchHtml(html) {
  const items = [];

  const liRe = /<li\b([^>]*)\bdata-product-id="(\d+)"([^>]*)>/g;
  let liMatch;
  while ((liMatch = liRe.exec(html)) !== null) {
    const attrs = `${liMatch[1] || ''} ${liMatch[3] || ''}`;
    const id = liMatch[2];

    const nameMatch = /data-product-name="([^"]*)"/.exec(attrs);
    const priceMatch = /data-product-price="([^"]*)"/.exec(attrs);
    const brandMatch = /data-product-brand="([^"]*)"/.exec(attrs);
    const categoryMatch = /data-product-category="([^"]*)"/.exec(attrs);

    const name = nameMatch ? decodeHtmlEntities(nameMatch[1]) : '';
    const price = priceMatch ? parseInt(priceMatch[1], 10) : null;
    const shop = brandMatch ? decodeHtmlEntities(brandMatch[1]) : '';
    const categoryId = categoryMatch ? categoryMatch[1] : '';

    // サムネイル: id="item_XXXXX" の直後のdata-originalを探す
    const thumbRe = new RegExp(`id="item_${id}"[\\s\\S]{0,600}?data-original="(https://[^"]+)"`);
    const thumbMatch = thumbRe.exec(html);
    const imageUrl = thumbMatch ? thumbMatch[1] : '';

    items.push({ id, name, price, shop, categoryId, imageUrl });
  }

  const hasNextPage = html.includes('rel="next"');

  // last-page リンクから総ページ数を取得（href内は &amp; エンコード済み）
  const lastPageMatch = /class="[^"]*last-page[^"]*"[^>]*href="[^"]*(?:[?&]|&amp;)page=(\d+)/.exec(html)
    || /href="[^"]*(?:[?&]|&amp;)page=(\d+)[^"]*"[^>]*class="[^"]*last-page[^"]*"/.exec(html);
  const totalPages = lastPageMatch ? parseInt(lastPageMatch[1], 10) : null;

  return { items, hasNextPage, totalPages };
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '…');
}

function parseBoothHomeHtml(html, { limitSections = 6, itemsPerSection = 4 } = {}) {
  const $ = cheerio.load(String(html || ''));
  const sections = [];
  const seen = new Set();

  $('.market_section').each((_index, sectionEl) => {
    const section = $(sectionEl);
    const title = section.find('.market_section-head-title').first().text().trim();
    const moreUrl = absolutizeBoothUrl(section.find('.more-to-category').attr('href') || '');
    const items = [];

    section.find('li[data-product-id]').each((_itemIndex, li) => {
      if (items.length >= itemsPerSection) return false;
      const item = parseHomeItemCard($, li);
      if (item) items.push(item);
      return undefined;
    });

    if (!title || !items.length) return;
    const key = `${title}\n${moreUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    sections.push({ title, moreUrl, items });
    if (sections.length >= limitSections) return false;
    return undefined;
  });

  return {
    sections,
    fetchedAt: new Date().toISOString(),
  };
}

function parseHomeItemCard($, li) {
  const el = $(li);
  const id = String(el.attr('data-product-id') || '').trim();
  if (!id) return null;

  const name = decodeHtmlEntities(String(el.attr('data-product-name') || '').trim());
  const priceRaw = String(el.attr('data-product-price') || '').trim();
  const price = priceRaw ? parseInt(priceRaw, 10) : null;
  const shop = decodeHtmlEntities(String(el.attr('data-product-brand') || '').trim());
  const categoryId = String(el.attr('data-product-category') || '').trim();
  const imageUrl = absolutizeBoothUrl(el.find('[data-original]').first().attr('data-original') || '');
  const itemUrl = absolutizeBoothUrl(el.find('a[href*="/items/"]').first().attr('href') || `https://booth.pm/ja/items/${id}`);

  return { id, name, price: Number.isFinite(price) ? price : null, shop, categoryId, imageUrl, url: itemUrl };
}

function absolutizeBoothUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, 'https://booth.pm').toString();
  } catch {
    return raw;
  }
}

async function searchBoothItems({ query, page = 1, sort = 'new_arrivals', inStock = true, categoryId = '', minPrice = null, maxPrice = null } = {}) {
  if (!query || !String(query).trim()) return { items: [], hasNextPage: false, error: 'query_required' };

  const q = encodeURIComponent(String(query).trim());
  let url = `${SEARCH_BASE}/${q}?sort=${sort}&page=${page}`;
  if (inStock) url += '&in_stock=true';
  if (categoryId) url += `&category_id=${encodeURIComponent(categoryId)}`;
  if (minPrice != null) url += `&min_price=${minPrice}`;
  if (maxPrice != null) url += `&max_price=${maxPrice}`;

  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    timeout: TIMEOUT_MS,
  });

  return parseSearchHtml(String(res.data || ''));
}

async function fetchBoothHomeSections({ limitSections = 6, itemsPerSection = 4, client = null } = {}) {
  const http = client && typeof client.get === 'function' ? client : axios;
  const res = await http.get(HOME_URL, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    timeout: TIMEOUT_MS,
    responseType: 'text',
  });
  return parseBoothHomeHtml(String(res.data || ''), { limitSections, itemsPerSection });
}

function normalizeRelatedItem(raw) {
  if (!raw || raw.is_placeholder) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const tracking = raw.tracking_data || {};
  const shop = raw.shop || {};
  const thumbs = Array.isArray(raw.thumbnail_image_urls) ? raw.thumbnail_image_urls : [];
  const priceNumber = Number(tracking.product_price);
  return {
    id,
    name: String(raw.name || ''),
    price: Number.isFinite(priceNumber) ? priceNumber : null,
    priceText: String(raw.price || ''),
    shop: String(shop.name || tracking.product_brand || ''),
    shopUrl: String(shop.url || ''),
    shopIcon: String(shop.thumbnail_url || ''),
    categoryId: String(tracking.product_category || ''),
    categoryName: String(raw.category?.name?.ja || raw.category?.name?.en || ''),
    imageUrl: String(thumbs[0] || ''),
    url: String(raw.url || `https://booth.pm/ja/items/${id}`),
    isVrchat: Boolean(raw.is_vrchat),
    isSoldOut: Boolean(raw.is_sold_out || raw.is_end_of_sale),
  };
}

function parseBoothRelatedItemsJson(data, { limit = 12 } = {}) {
  const payload = data && typeof data === 'object' ? data : {};
  const seen = new Set();
  const items = [];
  const buckets = [
    ...(Array.isArray(payload.related_items) ? payload.related_items : []),
    ...(Array.isArray(payload.tag_related_items) ? payload.tag_related_items : []),
  ];

  buckets.forEach((raw) => {
    if (items.length >= limit) return;
    const item = normalizeRelatedItem(raw);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  });

  return {
    items,
    categoryName: String(payload.category_name || ''),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchBoothRelatedItems({ itemId, limit = 12, client = null } = {}) {
  const id = String(itemId || '').trim();
  if (!id) return { items: [], error: 'itemId_required' };
  const http = client && typeof client.get === 'function' ? client : axios;
  const url = `${RELATED_ITEMS_URL}?item_id=${encodeURIComponent(id)}`;
  const res = await http.get(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    timeout: TIMEOUT_MS,
    responseType: 'json',
  });
  return parseBoothRelatedItemsJson(res.data, { limit });
}

async function fetchBoothItemDetail(itemId) {
  const id = String(itemId || '').trim();
  if (!id) return { error: 'itemId_required' };
  const url = `https://booth.pm/ja/items/${id}.json`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    timeout: TIMEOUT_MS,
  });
  const d = res.data;
  return {
    id: String(d.id || id),
    name: d.name || '',
    description: d.description || '',
    price: d.price || '',
    shopName: d.shop?.name || '',
    shopSubdomain: d.shop?.subdomain || '',
    shopUrl: d.shop?.url || `https://${d.shop?.subdomain}.booth.pm`,
    images: Array.isArray(d.images) ? d.images.map(i => i.original || i.resized || '').filter(Boolean) : [],
    tags: Array.isArray(d.tags) ? d.tags.map(t => t.name || '').filter(Boolean) : [],
    variations: Array.isArray(d.variations)
      ? d.variations.map(v => ({ id: String(v.id || ''), name: v.name || '', price: v.price ?? null, inStock: !v.is_sold_out }))
      : [],
    wishCount: d.wish_lists_count ?? null,
    purchaseCount: d.past_purchase_count ?? null,
    isSoldOut: Boolean(d.is_sold_out),
    url: d.url || `https://booth.pm/ja/items/${id}`,
  };
}

module.exports = {
  searchBoothItems,
  fetchBoothItemDetail,
  fetchBoothHomeSections,
  fetchBoothRelatedItems,
  parseBoothHomeHtml,
  parseBoothRelatedItemsJson,
};
