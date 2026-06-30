(function attachBoothClient(global) {
  function createBoothClientView({ boothAPI, getAssets }) {
    const pageEl   = document.getElementById('page-booth');
    const sbBooth  = document.getElementById('sb-booth');
    const sbLib    = document.getElementById('sb-lib');
    const pageLib  = document.getElementById('page-lib');
    const filterGp = document.getElementById('lib-filter-group');
    const msLib    = document.getElementById('ms-lib');
    const msBooth  = document.getElementById('ms-booth');
    const msBadge  = document.getElementById('ms-booth-badge');

    let currentMode = 'lib';
    let currentView = 'home';
    let boothHomeCache = null;
    let boothHomePromise = null;
    let recommendedItemsCache = null;
    let recommendedItemsPromise = null;
    let followedShopNewCache = null;
    let followedShopNewPromise = null;

    // アセットから画像URLを取得（preview は配列）
    function getThumbUrl(item) {
      const p = item.preview;
      if (Array.isArray(p) && p[0]) return p[0];
      if (typeof p === 'string' && p) return p;
      return null;
    }

    // アイテム名
    function getTitle(item) {
      return item.title || item.name || item.itemName || '';
    }

    // ── モード切替 ──────────────────────────────────────────
    function switchMode(mode) {
      currentMode = mode;
      const isLib = mode === 'lib';
      if (pageLib)  pageLib.style.display  = isLib ? '' : 'none';
      if (pageEl)   pageEl.style.display   = isLib ? 'none' : 'flex';
      if (sbLib)    sbLib.style.display    = isLib ? '' : 'none';
      if (sbBooth)  sbBooth.style.display  = isLib ? 'none' : 'block';
      if (filterGp) filterGp.style.display = isLib ? '' : 'none';
      if (msLib)   msLib.className  = 'msbtn' + (isLib ? ' ms-active-lib' : '');
      if (msBooth) msBooth.className = 'msbtn' + (!isLib ? ' ms-active-booth' : '');
      if (!isLib) switchView(currentView || 'home');
    }

    // ── ビュー切替 ────────────────────────────────────────
    function switchView(name) {
      if (name === 'search') {
        document.getElementById('btn-booth-search')?.click();
        return;
      }
      currentView = name;
      document.querySelectorAll('.bview').forEach(v => { v.style.display = 'none'; });
      const el = document.getElementById('bview-' + name);
      if (el) el.style.display = 'flex';
      document.querySelectorAll('#sb-booth .sb-booth-nav').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === name);
      });
      if (name === 'home')          loadHome();
      else if (name === 'cart')     loadCart();
      else if (name === 'wishlist') loadWishlist();
      else if (name === 'orders')   loadOrders();
    }

    // ── ホーム ────────────────────────────────────────────
    function loadHome() {
      const assets = getAssets() || [];
      const purchased = assets.filter(a => a.downloaded);
      const wishlist = assets.filter(a => a.isWishlisted && !a.downloaded);
      const updates = assets.filter(a => a.hasUpdate);
      const ordered = assets
        .filter(a => a.orderDate && a.orderDate !== 'Unknown')
        .sort((a, b) => getOrderTime(b) - getOrderTime(a));
      const totalLib = purchased.length;
      const wishCount = wishlist.length;
      const updatesCount = updates.length;
      const shopRows = getTopShops(assets, 8);
      const lastOrder = ordered[0] ? formatDateShort(ordered[0].orderDate) : '-';
      const wishlistTotal = wishlist.reduce((sum, item) => sum + getItemPrice(item), 0);

      const statsEl = document.getElementById('booth-home-stats');
      if (statsEl) {
        statsEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:18px;">
            ${stat('ライブラリ', totalLib, 'アイテム', 'rgba(255,255,255,0.06)', '#f4f4f5')}
            ${stat('ほしいリスト', wishCount, '未購入', 'rgba(236,72,153,0.08)', '#f9a8d4')}
            ${stat('更新あり', updatesCount, 'アイテム', 'rgba(251,191,36,0.08)', '#fbbf24')}
            ${stat('ショップ', shopRows.length, '上位表示', 'rgba(59,130,246,0.08)', '#93c5fd')}
            ${stat('直近購入', lastOrder, '注文日', 'rgba(16,185,129,0.08)', '#86efac')}
          </div>`;
      }

      const recentEl = document.getElementById('booth-home-recent');
      if (recentEl) {
        const recent = ordered.slice(0, 10);
        recentEl.style.cssText = 'display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.8fr);gap:12px;margin-bottom:18px;';
        recentEl.innerHTML = '';
        recentEl.appendChild(buildPanel('最近の注文', `${recent.length}件`, recent.length
          ? recent.map(item => buildHomeAssetRow(item, { meta: formatDateShort(item.orderDate), compact: true }))
          : [emptyHomeLine('最近の注文データがありません')]));
        recentEl.appendChild(buildPanel('更新あり', `${updatesCount}件`, updates.length
          ? updates.slice(0, 8).map(item => buildHomeAssetRow(item, { meta: '更新あり', tone: 'update' }))
          : [emptyHomeLine('更新待ちのアイテムはありません')]));
      }

      const wishEl = document.getElementById('booth-home-wishlist-preview');
      if (wishEl) {
        const wl = wishlist.slice(0, 8);
        wishEl.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.75fr);gap:12px;';
        wishEl.innerHTML = '';
        wishEl.appendChild(buildPanel('ほしいリスト', wishlistTotal > 0 ? `合計 ${formatPrice(wishlistTotal)}` : `${wishCount}件`, wl.length
          ? wl.map(item => buildHomeAssetRow(item, { meta: formatWishlistPrice(item), tone: 'wish' }))
          : [emptyHomeLine('ほしいリストは空です')]));
        wishEl.appendChild(buildPanel('ショップ比率', `${shopRows.length}件`, shopRows.length
          ? shopRows.map(shop => buildShopSummaryRow(shop))
          : [emptyHomeLine('ショップ情報がありません')]));
      }

      loadOfficialBoothHome();
      loadRecommendedItems(assets, ordered);
      loadFollowedShopNewItems(shopRows);
    }

    function stat(label, value, unit, bg, color) {
      return `<div style="border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;background:${bg};">
        <div style="font-size:9px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color};font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>
        <div style="font-size:10px;color:#71717a;margin-top:2px">${unit}</div>
      </div>`;
    }

    function buildPanel(title, meta, rows) {
      const panel = document.createElement('div');
      panel.style.cssText = 'min-width:0;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(255,255,255,0.025);overflow:hidden;';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:10px;font-weight:800;color:#a1a1aa;letter-spacing:.08em;text-transform:uppercase;';
      label.textContent = title;
      const count = document.createElement('div');
      count.style.cssText = "font-size:10px;color:#52525b;font-family:'JetBrains Mono',monospace;white-space:nowrap;";
      count.textContent = meta || '';
      head.appendChild(label);
      head.appendChild(count);
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;';
      rows.forEach(row => body.appendChild(row));
      panel.appendChild(head);
      panel.appendChild(body);
      return panel;
    }

    function buildHomeAssetRow(item, options = {}) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-bottom:1px solid rgba(255,255,255,0.035);background:transparent;color:inherit;cursor:pointer;font-family:inherit;text-align:left;';
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.035)'; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.addEventListener('click', () => openBoothItemDetail(item));

      row.appendChild(mkThumb(item, 42));
      const info = document.createElement('div');
      info.style.cssText = 'min-width:0;';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;font-weight:700;color:#e4e4e7;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      title.textContent = getTitle(item);
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:9px;color:#52525b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      sub.textContent = item.author || '';
      info.appendChild(title);
      info.appendChild(sub);

      const meta = document.createElement('div');
      const color = options.tone === 'wish' ? '#f9a8d4' : (options.tone === 'update' ? '#fbbf24' : '#71717a');
      meta.style.cssText = `font-size:10px;font-weight:700;color:${color};white-space:nowrap;font-family:'JetBrains Mono',monospace;`;
      meta.textContent = options.meta || '';
      row.appendChild(info);
      row.appendChild(meta);
      return row;
    }

    function buildShopSummaryRow(shop) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:8px 10px;border:0;border-bottom:1px solid rgba(255,255,255,0.035);background:transparent;color:inherit;cursor:pointer;font-family:inherit;text-align:left;';
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.035)'; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.addEventListener('click', () => loadShop(shop));
      const icon = document.createElement('span');
      icon.style.cssText = 'width:32px;height:32px;border-radius:50%;overflow:hidden;background:#18181b;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;color:#71717a;font-size:10px;font-weight:800;';
      if (shop.icon) {
        const img = document.createElement('img');
        img.src = shop.icon;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.onerror = () => { icon.textContent = getShopInitial(shop.name); img.remove(); };
        icon.appendChild(img);
      } else {
        icon.textContent = getShopInitial(shop.name);
      }
      const name = document.createElement('div');
      name.style.cssText = 'min-width:0;font-size:11px;font-weight:700;color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      name.textContent = shop.name;
      const count = document.createElement('div');
      count.style.cssText = "font-size:10px;color:#52525b;font-family:'JetBrains Mono',monospace;";
      count.textContent = String(shop.count);
      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(count);
      return row;
    }

    function emptyHomeLine(text) {
      const line = document.createElement('div');
      line.style.cssText = 'padding:18px 12px;font-size:11px;color:#52525b;';
      line.textContent = text;
      return line;
    }

    function getTopShops(assets, limit = 10) {
      const counts = new Map();
      (assets || []).forEach(a => {
        const name = String(a.author || '').trim();
        if (!name) return;
        const key = normalizeShopName(name);
        const current = counts.get(key) || { name, shopUrl: '', icon: '', count: 0 };
        current.count += 1;
        if (!current.shopUrl && a.authorShopUrl) current.shopUrl = String(a.authorShopUrl || '');
        if (!current.icon && a.authorIcon) current.icon = String(a.authorIcon || '');
        counts.set(key, current);
      });
      return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja')).slice(0, limit);
    }

    function getOrderTime(item) {
      const raw = typeof item === 'string' ? item : item?.orderDate;
      const t = Date.parse(String(raw || ''));
      return Number.isFinite(t) ? t : 0;
    }

    function formatDateShort(value) {
      const t = getOrderTime(value);
      if (!t) return '-';
      const d = new Date(t);
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    }

    function getItemPrice(item) {
      const price = Number(item?.priceMin ?? item?.price);
      return Number.isFinite(price) && price > 0 ? price : 0;
    }

    function formatPrice(value) {
      const price = Number(value);
      return Number.isFinite(price) && price > 0 ? `¥${Math.round(price).toLocaleString('ja-JP')}` : '-';
    }

    function formatWishlistPrice(item) {
      const min = Number(item?.priceMin ?? item?.price);
      const max = Number(item?.priceMax ?? item?.price);
      if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min) {
        return `¥${Math.round(min).toLocaleString('ja-JP')}-${Math.round(max).toLocaleString('ja-JP')}`;
      }
      return formatPrice(min);
    }

    function openBoothItemDetail(item) {
      const id = String(item?.id || item?.itemId || '').trim();
      if (!id) return;
      const previewData = {
        id,
        name: item.name || item.title || item.itemName || '',
        shop: item.shop || item.author || item.followedShopName || '',
        price: item.price ?? item.priceMin ?? null,
        imageUrl: item.imageUrl || item.thumbnail || item.images?.[0] || item.preview?.[0] || getThumbUrl(item) || '',
      };
      if (global.AvatoolBoothDetail && typeof global.AvatoolBoothDetail.open === 'function') {
        global.AvatoolBoothDetail.open(id, previewData);
        return;
      }
      boothAPI.openExternalUrl(`https://booth.pm/ja/items/${id}`);
    }

    async function loadRecommendedItems(assets, ordered) {
      const el = document.getElementById('booth-home-recommended');
      if (!el) return;
      const seed = pickRecommendationSeed(assets, ordered);
      el.innerHTML = '';
      if (!seed) {
        el.appendChild(buildPanel('あなたにおすすめの商品', '0件', [emptyHomeLine('おすすめ取得に使えるアイテムがありません')]));
        return;
      }
      el.appendChild(buildPanel('あなたにおすすめの商品', '読み込み中', [emptyHomeLine('BOOTH の関連商品APIから取得しています')]));

      try {
        if (!recommendedItemsCache) {
          recommendedItemsPromise = recommendedItemsPromise || boothAPI.fetchBoothRelatedItems?.(seed.itemId, { limit: 12 });
          recommendedItemsCache = await recommendedItemsPromise;
        }
        const ownedIds = new Set((assets || []).map(a => String(a.itemId || '')).filter(Boolean));
        const items = (Array.isArray(recommendedItemsCache?.items) ? recommendedItemsCache.items : [])
          .filter(item => item && item.id && !ownedIds.has(String(item.id)))
          .slice(0, 12);
        el.innerHTML = '';
        if (!items.length) {
          el.appendChild(buildPanel('あなたにおすすめの商品', '0件', [emptyHomeLine('おすすめ商品が見つかりませんでした')]));
          return;
        }
        el.appendChild(buildDiscoverySection({
          title: 'あなたにおすすめの商品',
          meta: recommendedItemsCache?.categoryName || '関連商品',
          items,
          tone: 'recommended',
        }));
      } catch (e) {
        el.innerHTML = '';
        el.appendChild(buildPanel('あなたにおすすめの商品', 'エラー', [emptyHomeLine('おすすめ商品の取得に失敗しました')]));
      }
    }

    function pickRecommendationSeed(assets, ordered) {
      const candidates = [
        ...(Array.isArray(ordered) ? ordered : []),
        ...(Array.isArray(assets) ? assets : []),
      ];
      return candidates.find(item => String(item?.itemId || '').trim()) || null;
    }

    async function loadFollowedShopNewItems(shopRows) {
      const el = document.getElementById('booth-home-following-new');
      if (!el) return;
      const shops = Array.isArray(shopRows) ? shopRows.slice(0, 8) : [];
      el.innerHTML = '';
      if (!shops.length) {
        el.appendChild(buildPanel('フォローしているショップの新着', '0件', [emptyHomeLine('ショップ情報がありません')]));
        return;
      }
      el.appendChild(buildPanel('フォローしているショップの新着', '読み込み中', [emptyHomeLine('ショップ別の新着を取得しています')]));

      try {
        if (!followedShopNewCache) {
          followedShopNewPromise = followedShopNewPromise || fetchFollowedShopNewItems(shops);
          followedShopNewCache = await followedShopNewPromise;
        }
        const items = Array.isArray(followedShopNewCache?.items) ? followedShopNewCache.items : [];
        el.innerHTML = '';
        if (!items.length) {
          el.appendChild(buildPanel('フォローしているショップの新着', '0件', [emptyHomeLine('新着商品が見つかりませんでした')]));
          return;
        }
        el.appendChild(buildDiscoverySection({
          title: 'フォローしているショップの新着',
          meta: `${items.length}件`,
          items,
        }));
      } catch (e) {
        el.innerHTML = '';
        el.appendChild(buildPanel('フォローしているショップの新着', 'エラー', [emptyHomeLine('ショップ新着の取得に失敗しました')]));
      }
    }

    async function fetchFollowedShopNewItems(shops) {
      const seen = new Set();
      const rows = [];
      const assets = getAssets() || [];
      const ownedIds = new Set(assets.map(a => String(a.itemId || '')).filter(Boolean));
      await Promise.all(shops.map(async (shop) => {
        const name = String(shop?.name || '').trim();
        if (!name) return;
        const shopKey = normalizeShopName(name);
        const shopSubdomainKey = normalizeShopName(extractBoothSubdomain(shop?.shopUrl || ''));
        const res = await boothAPI.searchBooth(name, { page: 1, sort: 'new', inStock: false, categoryId: '' });
        const allItems = Array.isArray(res?.items) ? res.items : [];
        allItems
          .filter(item => {
            const itemShop = normalizeShopName(item?.shop || '');
            return itemShop && (itemShop === shopKey || itemShop === shopSubdomainKey);
          })
          .slice(0, 4)
          .forEach(item => {
            const id = String(item?.id || '');
            if (!id || seen.has(id)) return;
            seen.add(id);
            rows.push({ ...item, followedShopName: name, owned: ownedIds.has(id) });
          });
      }));
      rows.sort((a, b) => {
        const aOwned = a.owned ? 1 : 0;
        const bOwned = b.owned ? 1 : 0;
        return aOwned - bOwned || String(a.followedShopName || '').localeCompare(String(b.followedShopName || ''), 'ja');
      });
      return { items: rows.slice(0, 16) };
    }

    async function loadOfficialBoothHome() {
      const el = document.getElementById('booth-home-official');
      if (!el) return;
      el.innerHTML = '';
      el.appendChild(buildPanel('BOOTHトップ', '読み込み中', [emptyHomeLine('https://booth.pm/ja から取得しています')]));

      try {
        if (!boothHomeCache) {
          boothHomePromise = boothHomePromise || boothAPI.fetchBoothHome?.({ limitSections: 8, itemsPerSection: 6 });
          boothHomeCache = await boothHomePromise;
        }
        const sections = pickOfficialHomeSections(boothHomeCache?.sections || []);
        el.innerHTML = '';
        if (!sections.length) {
          el.appendChild(buildPanel('あなた向けBOOTHトップ', '0件', [emptyHomeLine('トップページの商品情報を取得できませんでした')]));
          return;
        }
        sections.forEach(section => el.appendChild(buildOfficialSection(section)));
      } catch (e) {
        el.innerHTML = '';
        el.appendChild(buildPanel('あなた向けBOOTHトップ', 'エラー', [emptyHomeLine('BOOTHトップの取得に失敗しました')]));
      }
    }

    function pickOfficialHomeSections(sections) {
      const rows = Array.isArray(sections) ? sections.filter(s => Array.isArray(s.items) && s.items.length) : [];
      return rows
        .filter(isAssetManagerOfficialSection)
        .sort((a, b) => getOfficialSectionScore(b) - getOfficialSectionScore(a))
        .slice(0, 2);
    }

    function isAssetManagerOfficialSection(section) {
      const title = String(section?.title || '');
      return title.includes('あなたにおすすめ')
        || title.includes('おすすめの商品')
        || title.includes('フォローしているショップ')
        || title.includes('3Dモデル');
    }

    function getOfficialSectionScore(section) {
      const title = String(section?.title || '');
      if (title.includes('あなたにおすすめ')) return 300;
      if (title.includes('おすすめの商品')) return 280;
      if (title.includes('フォローしているショップ')) return 240;
      if (title.includes('3Dモデル')) return 100;
      return 0;
    }

    function buildOfficialSection(section) {
      return buildDiscoverySection({
        title: section.title || 'あなた向けBOOTHトップ',
        meta: section.moreUrl ? 'もっと見る' : '',
        items: (section.items || []).slice(0, 6),
        moreUrl: section.moreUrl || '',
        tone: 'official',
      });
    }

    function buildDiscoverySection({ title: sectionTitle, meta = '', items = [], moreUrl = '', tone = 'following' }) {
      const panel = document.createElement('div');
      const border = tone === 'official' ? 'rgba(99,102,241,0.14)' : (tone === 'recommended' ? 'rgba(236,72,153,0.14)' : 'rgba(34,197,94,0.14)');
      const bg = tone === 'official' ? 'rgba(99,102,241,0.035)' : (tone === 'recommended' ? 'rgba(236,72,153,0.035)' : 'rgba(34,197,94,0.035)');
      const accent = tone === 'official' ? '#c4b5fd' : (tone === 'recommended' ? '#f9a8d4' : '#86efac');
      const link = tone === 'official' ? '#818cf8' : (tone === 'recommended' ? '#f472b6' : '#4ade80');
      panel.style.cssText = `min-width:0;border:1px solid ${border};border-radius:10px;background:${bg};overflow:hidden;`;
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);';
      const title = document.createElement('div');
      title.style.cssText = `font-size:10px;font-weight:800;color:${accent};letter-spacing:.08em;text-transform:uppercase;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      title.textContent = sectionTitle || '';
      head.appendChild(title);
      if (meta) {
        const more = moreUrl ? document.createElement('button') : document.createElement('div');
        if (moreUrl) more.type = 'button';
        more.style.cssText = `font-size:10px;color:${link};background:transparent;border:0;padding:0;${moreUrl ? 'cursor:pointer;' : ''}font-family:inherit;white-space:nowrap;`;
        more.textContent = meta;
        if (moreUrl) {
          more.addEventListener('click', () => boothAPI.openExternalUrl(moreUrl));
        }
        head.appendChild(more);
      }
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:10px;';
      (items || []).slice(0, 16).forEach(item => grid.appendChild(buildOfficialItemCard(item)));
      panel.appendChild(head);
      panel.appendChild(grid);
      return panel;
    }

    function buildOfficialItemCard(item) {
      const card = document.createElement('button');
      card.type = 'button';
      card.style.cssText = 'min-width:0;border:0;background:transparent;padding:0;text-align:left;cursor:pointer;font-family:inherit;color:inherit;';
      card.addEventListener('click', () => openBoothItemDetail(item));
      const thumb = document.createElement('div');
      thumb.style.cssText = 'aspect-ratio:1/1;border-radius:8px;overflow:hidden;background:#18181b;border:1px solid rgba(255,255,255,0.06);';
      if (item.imageUrl) {
        const img = document.createElement('img');
        img.src = item.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        thumb.appendChild(img);
      }
      const name = document.createElement('div');
      name.style.cssText = 'font-size:9px;font-weight:700;color:#e4e4e7;line-height:1.25;margin-top:6px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
      name.textContent = item.name || '';
      const meta = document.createElement('div');
      meta.style.cssText = "font-size:9px;color:#71717a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'JetBrains Mono',monospace;";
      meta.textContent = item.price != null ? formatPrice(item.price) : (item.priceText || item.shop || '');
      card.appendChild(thumb);
      card.appendChild(name);
      card.appendChild(meta);
      return card;
    }

    function buildThumbCard(item) {
      const card = document.createElement('div');
      card.style.cssText = 'flex-shrink:0;width:140px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .2s;background:#111114;';
      card.onmouseenter = () => { card.style.borderColor = 'rgba(255,255,255,0.14)'; card.style.transform = 'translateY(-2px)'; };
      card.onmouseleave = () => { card.style.borderColor = 'rgba(255,255,255,0.06)'; card.style.transform = ''; };
      card.addEventListener('click', () => openBoothItemDetail(item));

      const thumb = document.createElement('div');
      thumb.style.cssText = 'aspect-ratio:1/1;background:#1c1c21;display:flex;align-items:center;justify-content:center;overflow:hidden;';
      const url = getThumbUrl(item);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        thumb.style.fontSize = '28px';
        thumb.textContent = '🎨';
      }

      const body = document.createElement('div');
      body.style.cssText = 'padding:8px;';
      const name = document.createElement('div');
      name.style.cssText = 'font-size:10px;font-weight:600;color:#d4d4d8;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:4px;';
      name.textContent = getTitle(item);
      const shop = document.createElement('div');
      shop.style.cssText = 'font-size:9px;color:#52525b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      shop.textContent = item.author || '';
      body.appendChild(name);
      body.appendChild(shop);
      card.appendChild(thumb);
      card.appendChild(body);
      return card;
    }

    // ── カート ────────────────────────────────────────────
    function loadCart() {
      const el = document.getElementById('booth-cart-content');
      if (!el) return;
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:48px;color:#52525b;">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          <div style="font-size:12px;color:#71717a;text-align:center;line-height:1.6;">
            カートの内容はBOOTH公式でご確認ください。<br>
            <span style="font-size:10px;color:#52525b;">（カートAPIはショップ別のため Avatool では一覧取得できません）</span>
          </div>
          <button id="open-booth-cart-btn"
            style="font-size:11px;font-weight:700;padding:9px 20px;border-radius:8px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.1);color:#818cf8;cursor:pointer;font-family:inherit;transition:background .15s;">
            BOOTHでカートを開く →
          </button>
        </div>`;
      document.getElementById('open-booth-cart-btn')?.addEventListener('click', () =>
        boothAPI.openExternalUrl('https://booth.pm/cart'));
    }

    // ── ほしいリスト ──────────────────────────────────────
    function loadWishlist() {
      const el = document.getElementById('booth-wishlist-content');
      if (!el) return;
      const assets  = getAssets() || [];
      const wishlist = assets.filter(a => a.isWishlisted && !a.downloaded);

      if (!wishlist.length) {
        el.innerHTML = emptyState('ほしいリストにアイテムがありません');
        return;
      }
      el.innerHTML = '';
      wishlist.forEach(item => el.appendChild(buildWishRow(item)));
    }

    function buildWishRow(item) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);';

      const thumb = mkThumb(item, 48);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const name = document.createElement('div');
      name.style.cssText = 'font-size:11px;font-weight:600;color:#f4f4f5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = getTitle(item);
      const shop = document.createElement('div');
      shop.style.cssText = 'font-size:10px;color:#52525b;margin-top:2px;';
      shop.textContent = item.author || '';
      info.appendChild(name);
      info.appendChild(shop);

      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

      const cartBtn = document.createElement('button');
      cartBtn.textContent = 'カートへ';
      cartBtn.style.cssText = 'font-size:10px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.08);color:#818cf8;cursor:pointer;font-family:inherit;transition:background .15s;';
      cartBtn.addEventListener('click', async () => {
        cartBtn.disabled = true; cartBtn.textContent = '...';
        try {
          const res = await boothAPI.addWishlistItemToCart(`https://booth.pm/ja/items/${item.itemId}`);
          if (res?.ok) { cartBtn.textContent = '✓ 完了'; cartBtn.style.color = '#34d399'; }
          else { cartBtn.textContent = 'エラー'; cartBtn.disabled = false; }
        } catch { cartBtn.textContent = 'エラー'; cartBtn.disabled = false; }
      });

      const extBtn = document.createElement('button');
      extBtn.textContent = 'BOOTH';
      extBtn.style.cssText = 'font-size:10px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#52525b;cursor:pointer;font-family:inherit;';
      extBtn.addEventListener('click', () => boothAPI.openExternalUrl(`https://booth.pm/ja/items/${item.itemId}`));

      btns.appendChild(cartBtn);
      btns.appendChild(extBtn);
      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(btns);
      return row;
    }

    // ── 注文履歴 ──────────────────────────────────────────
    function loadOrders() {
      const el = document.getElementById('booth-orders-content');
      if (!el) return;
      const assets = getAssets() || [];
      const withOrders = assets
        .filter(a => a.orderDate && a.orderDate !== 'Unknown')
        .sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));

      if (!withOrders.length) {
        el.innerHTML = emptyState('注文履歴データがありません（ライブラリを同期してください）');
        return;
      }

      const groups = new Map();
      withOrders.forEach(item => {
        const date = (item.orderDate || '').slice(0, 10);
        if (!groups.has(date)) groups.set(date, []);
        groups.get(date).push(item);
      });

      el.innerHTML = '';
      for (const [date, items] of groups) {
        el.appendChild(buildOrderCard(date, items));
      }
    }

    function buildOrderCard(date, items) {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid rgba(255,255,255,0.06);border-radius:12px;overflow:hidden;margin-bottom:10px;';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);';
      hdr.innerHTML = `
        <span style="font-size:11px;font-weight:600;color:#a1a1aa;font-family:'JetBrains Mono',monospace;">${date}</span>
        <span style="margin-left:auto;font-size:10px;color:#52525b;font-family:'JetBrains Mono',monospace;">${items.length}点</span>
        <span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(52,211,153,0.1);color:#34d399;border:1px solid rgba(52,211,153,0.2);">完了</span>`;

      const body = document.createElement('div');
      body.style.cssText = 'padding:10px 14px;display:flex;align-items:center;gap:10px;';

      const thumbs = document.createElement('div');
      thumbs.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
      items.slice(0, 4).forEach(item => thumbs.appendChild(mkThumb(item, 40)));
      if (items.length > 4) {
        const more = document.createElement('div');
        more.style.cssText = 'width:40px;height:40px;border-radius:7px;background:#1a1a1f;display:flex;align-items:center;justify-content:center;font-size:10px;color:#52525b;flex-shrink:0;';
        more.textContent = `+${items.length - 4}`;
        thumbs.appendChild(more);
      }

      const names = document.createElement('div');
      names.style.cssText = 'flex:1;min-width:0;font-size:10px;color:#a1a1aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      names.textContent = items.map(i => getTitle(i)).filter(Boolean).join('、');

      body.appendChild(thumbs);
      body.appendChild(names);
      card.appendChild(hdr);
      card.appendChild(body);
      return card;
    }

    // ── サイドバー: フォロー中ショップ ──────────────────
    function updateShopsNav() {
      const shopsEl = document.getElementById('sb-booth-shops');
      if (!shopsEl) return;
      const assets = getAssets() || [];
      const top = getTopShops(assets, 10);

      shopsEl.innerHTML = '';
      if (!top.length) {
        shopsEl.innerHTML = '<div style="font-size:10px;color:#52525b;padding:6px 14px;">同期してください</div>';
        return;
      }
      top.forEach((shop) => {
        const btn = document.createElement('button');
        btn.className = 'nav-item w-full';
        btn.style.cssText = 'font-size:11px;padding:7px 14px;gap:8px;';
        const icon = document.createElement('span');
        icon.style.cssText = 'width:18px;height:18px;border-radius:50%;overflow:hidden;background:#18181b;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#71717a;font-size:9px;font-weight:700;';
        if (shop.icon) {
          const img = document.createElement('img');
          img.src = shop.icon;
          img.alt = '';
          img.loading = 'lazy';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.onerror = () => {
            icon.textContent = getShopInitial(shop.name);
            img.remove();
          };
          icon.appendChild(img);
        } else {
          icon.textContent = getShopInitial(shop.name);
        }
        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;';
        nameEl.textContent = shop.name;
        const countEl = document.createElement('span');
        countEl.style.cssText = "font-size:9px;font-family:'JetBrains Mono',monospace;color:#52525b;flex-shrink:0;";
        countEl.textContent = String(shop.count);
        btn.appendChild(icon);
        btn.appendChild(nameEl);
        btn.appendChild(countEl);
        btn.addEventListener('click', () => loadShop(shop));
        shopsEl.appendChild(btn);
      });
    }

    // ── ショップビュー ────────────────────────────────────
    let shopPage = 1;
    let shopName = '';
    let shopLoading = false;

    async function loadShop(shop, page = 1) {
      if (shopLoading) return;
      shopLoading = true;
      const shopInfo = typeof shop === 'string' ? { name: shop, shopUrl: '' } : (shop || {});
      const name = String(shopInfo.name || '').trim();
      const shopKey = normalizeShopName(name);
      const shopSubdomainKey = normalizeShopName(extractBoothSubdomain(shopInfo.shopUrl || ''));
      shopName = shopInfo;
      shopPage = page;

      // ビュー切替（nav active は外す）
      document.querySelectorAll('.bview').forEach(v => { v.style.display = 'none'; });
      document.querySelectorAll('#sb-booth .sb-booth-nav').forEach(b => b.classList.remove('active'));
      const shopView = document.getElementById('bview-shop');
      if (shopView) shopView.style.display = 'flex';
      currentView = 'shop';

      const nameEl  = document.getElementById('bview-shop-name');
      const countEl = document.getElementById('bview-shop-count');
      const grid    = document.getElementById('bview-shop-grid');
      const moreDiv = document.getElementById('bview-shop-more');
      if (nameEl)  nameEl.textContent = name;
      if (countEl) countEl.textContent = '読み込み中…';
      if (page === 1 && grid) grid.innerHTML = `<div style="grid-column:1/-1;${emptyState('読み込み中…')}"></div>`;

      try {
        const res = await boothAPI.searchBooth(name, { page, sort: 'new', inStock: false, categoryId: '' });
        const allItems = Array.isArray(res?.items) ? res.items : [];
        const items = allItems.filter(item => {
          const itemShop = normalizeShopName(item?.shop || '');
          return itemShop && (itemShop === shopKey || itemShop === shopSubdomainKey);
        });

        if (page === 1 && grid) grid.innerHTML = '';
        if (!items.length && page === 1 && grid) {
          grid.innerHTML = `<div style="grid-column:1/-1;">${emptyState('アイテムが見つかりませんでした')}</div>`;
          if (countEl) countEl.textContent = '';
          if (moreDiv) moreDiv.style.display = 'none';
          shopLoading = false; return;
        }

        if (countEl) countEl.textContent = `${document.querySelectorAll('#bview-shop-grid > div').length + items.length}件`;
        if (grid) items.forEach(item => grid.appendChild(buildShopCard(item)));

        if (moreDiv) {
          const hasMore = Boolean(res?.hasNextPage || allItems.length >= 24);
          moreDiv.style.display = hasMore ? '' : 'none';
        }
      } catch (e) {
        if (grid) grid.innerHTML = `<div style="grid-column:1/-1;">${emptyState('エラーが発生しました')}</div>`;
      }
      shopLoading = false;
    }

    function normalizeShopName(value) {
      return String(value || '').trim().normalize('NFKC').toLowerCase();
    }

    function extractBoothSubdomain(url) {
      try {
        const host = new URL(String(url || '')).hostname.toLowerCase();
        return host.endsWith('.booth.pm') ? host.slice(0, -'.booth.pm'.length) : '';
      } catch {
        return '';
      }
    }

    function getShopInitial(name) {
      return String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
    }

    function buildShopCard(item) {
      const owned = (getAssets() || []).some(a => String(a.itemId) === String(item.id));
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;cursor:pointer;background:#111114;transition:border-color .15s,transform .15s;min-height:218px;display:block;';
      card.onmouseenter = () => { card.style.borderColor = 'rgba(255,255,255,0.14)'; card.style.transform = 'translateY(-2px)'; };
      card.onmouseleave = () => { card.style.borderColor = 'rgba(255,255,255,0.06)'; card.style.transform = ''; };
      card.addEventListener('click', () => openBoothItemDetail(item));

      const imgUrl = item.imageUrl || item.thumbnail || item.images?.[0] || item.preview?.[0] || null;
      // aspect-ratio はグリッドアイテム内で崩れるため padding-top:100% トリックを使用
      const thumb = document.createElement('div');
      thumb.style.cssText = 'position:relative;width:100%;height:160px;background:#1c1c21;overflow:hidden;';
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl; img.loading = 'lazy';
        img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;';
        thumb.appendChild(img);
      }
      if (owned) {
        const badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;top:5px;right:5px;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.3);backdrop-filter:blur(4px);';
        badge.textContent = '所持済';
        thumb.appendChild(badge);
      }

      const body = document.createElement('div');
      body.style.cssText = 'padding:8px;';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:10px;font-weight:600;color:#d4d4d8;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:3px;';
      title.textContent = item.name || item.title || '';
      const price = document.createElement('div');
      price.style.cssText = 'font-size:10px;color:#a1a1aa;font-family:"JetBrains Mono",monospace;';
      price.textContent = item.price != null ? (item.price === 0 ? '無料' : `¥${item.price.toLocaleString()}〜`) : '';

      body.appendChild(title);
      body.appendChild(price);
      card.appendChild(thumb);
      card.appendChild(body);
      return card;
    }

    // ── ユーティリティ ───────────────────────────────────
    function mkThumb(item, size) {
      const t = document.createElement('div');
      t.style.cssText = `width:${size}px;height:${size}px;border-radius:${size > 44 ? 8 : 7}px;background:#1c1c21;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
      const url = getThumbUrl(item);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.loading = 'lazy';
        t.appendChild(img);
      }
      return t;
    }

    function emptyState(text) {
      return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px;color:#52525b;text-align:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="font-size:11px;color:#71717a;">${text}</span>
      </div>`;
    }

    // ── イベント配線 ─────────────────────────────────────
    document.getElementById('ms-lib')  ?.addEventListener('click', () => switchMode('lib'));
    document.getElementById('ms-booth')?.addEventListener('click', () => switchMode('booth'));

    document.querySelectorAll('#sb-booth .sb-booth-nav').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('bview-shop-back')?.addEventListener('click', () => switchView('home'));
    document.getElementById('bview-shop-more-btn')?.addEventListener('click', () => loadShop(shopName, shopPage + 1));

    return {
      switchMode,
      switchView,
      onAssetsLoaded(assets) {
        updateShopsNav();
        const wl = (assets || []).filter(a => a.isWishlisted && !a.downloaded).length;
        if (msBadge) { msBadge.textContent = wl || ''; msBadge.style.display = wl ? '' : 'none'; }
        // BOOTHモードで表示中のビューを即時更新
        if (currentMode === 'booth') {
          if (currentView === 'home')          loadHome();
          else if (currentView === 'wishlist') loadWishlist();
          else if (currentView === 'orders')   loadOrders();
        }
      },
    };
  }

  global.AvatoolBoothClient = { createBoothClientView };
})(window);
