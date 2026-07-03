(function attachBoothSearch(global) {
  // ファイル名によるバリエーション所持推測は、アバター向けカテゴリ（衣装/髪型）でのみ試みる。
  // これらのカテゴリはバリエーション名がアバター名そのものであることが多く、実データ検証で
  // 高い精度を確認済み。逆に武器/小物などの他カテゴリは「通常版/支援版」のような価格帯の
  // 違いでしかなく、ファイル名とバリエーション名に関連がないため試みても無意味/危険。
  const AVATAR_VARIATION_CATEGORIES = new Set(['3D衣装', '3D髪型']);

  function getPrimaryCategoryText(asset) {
    const c = asset?.primaryCategory;
    if (!c || typeof c !== 'object') return '';
    return String(c.text || c.name || '').trim();
  }

  function normalizeMatchTokens(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // 絵文字装飾を除去
      .replace(/\.zip$/i, '')
      .split(/[^a-z0-9ぁ-んァ-ヶー一-龠]+/i)
      .filter(t => t.length >= 3); // 短いトークン（連番"no"等）による偶然一致を防ぐ
  }

  function variationMatchesLocalFiles(variationName, files) {
    const vTokens = normalizeMatchTokens(variationName);
    if (!vTokens.length || !Array.isArray(files) || !files.length) return false;
    return files.some(f => {
      const fTokens = normalizeMatchTokens(f?.fileName || f);
      if (!fTokens.length) return false;
      const score = vTokens.filter(t => fTokens.some(ft => ft.includes(t) || t.includes(ft))).length;
      return score / vTokens.length >= 0.5;
    });
  }

  function createBoothSearchView({ boothAPI, toggleWishlist, getAssetMap }) {
    let currentPage = 1;
    let maxKnownPage = 1;
    let totalPages = null;
    let currentSort = 'new_arrivals';
    let currentInStock = true;
    let hasNextPage = false;
    let isLoading = false;
    let currentItems = [];

    const searchInput = document.getElementById('booth-search-input');
    const sortSelect = document.getElementById('booth-search-sort');
    const inStockCheck = document.getElementById('booth-search-instock');
    const grid = document.getElementById('booth-search-grid');
    const status = document.getElementById('booth-search-status');
    const pagination = document.getElementById('booth-search-pagination');
    const pageButtons = document.getElementById('booth-page-buttons');
    const prevBtn = document.getElementById('btn-booth-prev');
    const nextBtn = document.getElementById('btn-booth-next');
    const submitBtn = document.getElementById('btn-booth-search-submit');
    const emptyState = document.getElementById('booth-search-empty');
    const categorySelect = document.getElementById('booth-search-category');
    const priceSelect = document.getElementById('booth-search-price');

    // --- 詳細パネル ---
    const detailPanel = document.getElementById('booth-item-detail');
    const detailImage = document.getElementById('booth-detail-image');
    const detailTitle = document.getElementById('booth-detail-title');
    const detailShop = document.getElementById('booth-detail-shop');
    const detailStats = document.getElementById('booth-detail-stats');
    const detailVariations = document.getElementById('booth-detail-variations');
    const detailTags = document.getElementById('booth-detail-tags');
    const detailDesc = document.getElementById('booth-detail-desc');
    const detailCloseBtn = document.getElementById('btn-booth-detail-close');
    const detailWishBtn = document.getElementById('btn-booth-detail-wish');
    const detailOpenBtn = document.getElementById('btn-booth-detail-open');
    const detailPrevImg = document.getElementById('btn-booth-detail-prev-img');
    const detailNextImg = document.getElementById('btn-booth-detail-next-img');
    const detailDots = document.getElementById('booth-detail-img-dots');
    const detailThumbs = document.getElementById('booth-detail-img-thumbs');

    let detailImages = [];
    let detailImgIdx = 0;
    let currentDetailItemId = null;
    let currentDetailItem = null;

    function setDetailImage(idx) {
      if (!detailImages.length) return;
      detailImgIdx = Math.max(0, Math.min(idx, detailImages.length - 1));
      detailImage.src = detailImages[detailImgIdx];
      if (detailDots) {
        Array.from(detailDots.children).forEach((d, i) => {
          d.style.background = i === detailImgIdx ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.2)';
        });
      }
      if (detailThumbs) {
        Array.from(detailThumbs.children).forEach((thumb, i) => {
          thumb.style.borderColor = i === detailImgIdx ? 'rgba(167,139,250,0.85)' : 'rgba(255,255,255,0.08)';
          thumb.style.opacity = i === detailImgIdx ? '1' : '0.56';
        });
      }
      const multi = detailImages.length > 1 ? 'flex' : 'none';
      if (detailPrevImg) detailPrevImg.style.display = multi;
      if (detailNextImg) detailNextImg.style.display = multi;
      if (detailThumbs) detailThumbs.style.display = detailImages.length > 1 ? 'grid' : 'none';
    }

    async function openDetail(itemId, previewData) {
      if (!detailPanel) return;
      currentDetailItemId = itemId;
      currentDetailItem = null;

      // まず手持ちのデータで仮表示
      if (previewData) {
        detailTitle.textContent = previewData.name || '';
        detailShop.textContent = previewData.shop || '';
        detailVariations.innerHTML = '';
        if (previewData.price != null) {
          const priceEl = document.createElement('div');
          priceEl.style.cssText = 'font-size:18px;font-weight:700;color:#34d399';
          priceEl.textContent = `¥${Number(previewData.price).toLocaleString()}`;
          detailVariations.appendChild(priceEl);
        }
        detailTags.innerHTML = '';
        detailDesc.textContent = '読み込み中...';
        detailStats.textContent = '';
        detailImages = previewData.imageUrl ? [previewData.imageUrl] : [];
        detailDots.innerHTML = '';
        if (detailThumbs) detailThumbs.innerHTML = '';
        setDetailImage(0);
        if (detailPrevImg) detailPrevImg.style.display = 'none';
        if (detailNextImg) detailNextImg.style.display = 'none';
      }

      detailPanel.style.display = 'flex';
      detailWishBtn.textContent = 'ほしいリストに追加';
      detailWishBtn.disabled = false;

      // 詳細をフェッチ
      try {
        const res = await boothAPI.fetchBoothItemDetail(itemId);
        if (res?.error || currentDetailItemId !== itemId) return;
        currentDetailItem = res;
        renderDetail(res);
      } catch (e) {
        if (currentDetailItemId === itemId) detailDesc.textContent = `読み込みエラー: ${e?.message || e}`;
      }
    }

    function renderDetail(d) {
      detailTitle.textContent = d.name || '';
      detailShop.textContent = d.shopName ? `${d.shopName}` : '';

      const stats = [];
      if (d.purchaseCount != null) stats.push(`購入 ${d.purchaseCount} 件`);
      if (d.wishCount != null) stats.push(`ほしい ${d.wishCount} 件`);
      detailStats.textContent = stats.join('  ·  ');

      // "既に持っている" の判定は2つのシグナルのORで決める:
      //  1. v.alreadyBought — BOOTHの認証済みAPIが返すバリエーション単位の正確な購入
      //     ステータス（fetchBoothItemDetailAuthenticated 経由。Cookie必須）。
      //  2. inLib — AvatoolのローカルライブラリにこのitemIdがあるか。Full Packのように
      //     1つの購入で他の全バリエーション分のファイルもまとめて手に入るケースをカバーする
      //     （BOOTHのストアフロント上は他バリエーションはaddable_to_cartのままでも、
      //     Avatool上は実質「もう持っている」ため、ユーザーの意向でこちらを優先する）。
      // assetMap.has(id) だけだとウィッシュリスト専用アイテム（未購入）まで
      // 「所持済み」扱いになってしまうため、downloaded/files で実際の所持を確認する。
      const assetMap = getAssetMap ? getAssetMap() : new Map();
      const asset = assetMap instanceof Map ? assetMap.get(d.id) : assetMap?.[d.id];
      const inLib = Boolean(asset?.downloaded || asset?.files?.length);
      // アバター向けカテゴリのみ、inLib時にファイル名でバリエーション単位の所持を絞り込む。
      // それ以外のカテゴリはバリエーション名とファイル名に関連がないため、inLibをそのまま使う。
      const canFileMatch = AVATAR_VARIATION_CATEGORIES.has(getPrimaryCategoryText(asset));

      const makeCartOrBuyBtn = (v, openCheckout) => {
        const btn = document.createElement('button');
        const label = openCheckout ? '購入する' : 'カートへ';
        const baseColor = openCheckout ? '#6ee7b7' : '#a5b4fc';
        const baseBorder = openCheckout ? 'rgba(52,211,153,0.4)' : 'rgba(99,102,241,0.5)';
        const baseBg = openCheckout ? 'rgba(52,211,153,0.08)' : 'rgba(99,102,241,0.12)';
        const hoverBg = openCheckout ? 'rgba(52,211,153,0.18)' : 'rgba(99,102,241,0.25)';
        btn.textContent = label;
        btn.style.cssText = `flex-shrink:0;font-size:10px;font-weight:700;font-family:inherit;padding:3px 8px;border-radius:5px;border:1px solid ${baseBorder};background:${baseBg};color:${baseColor};cursor:pointer;transition:background .15s`;
        btn.addEventListener('mouseenter', () => { if (!btn.dataset.loading) btn.style.background = hoverBg; });
        btn.addEventListener('mouseleave', () => { if (!btn.dataset.loading) btn.style.background = baseBg; });
        btn.addEventListener('click', async () => {
          if (btn.dataset.loading) return;
          btn.dataset.loading = '1';
          btn.textContent = '…';
          btn.style.opacity = '0.6';
          try {
            const res = await boothAPI.addWishlistItemToCart(`https://booth.pm/ja/items/${currentDetailItemId}`, v.name && v.name.trim() ? v.name.trim() : undefined);
            if (res?.ok) {
              btn.textContent = '✓ 完了';
              btn.style.cssText = `flex-shrink:0;font-size:10px;font-weight:700;font-family:inherit;padding:3px 8px;border-radius:5px;border:1px solid rgba(52,211,153,0.4);background:rgba(52,211,153,0.1);color:#6ee7b7;cursor:default`;
              if (openCheckout && res.checkoutUrl) boothAPI.openExternalUrl(res.checkoutUrl);
            } else if (String(res?.error || '').includes('cart_variation_ambiguous')) {
              boothAPI.openExternalUrl(`https://booth.pm/ja/items/${currentDetailItemId}`);
              btn.textContent = 'BOOTHで選択';
              btn.style.color = baseColor;
              btn.style.opacity = '1';
              delete btn.dataset.loading;
            } else {
              btn.textContent = 'エラー';
              btn.style.color = '#f87171';
              btn.style.opacity = '1';
              delete btn.dataset.loading;
              setTimeout(() => { btn.textContent = label; btn.style.color = baseColor; }, 2000);
            }
          } catch {
            btn.textContent = 'エラー';
            btn.style.color = '#f87171';
            btn.style.opacity = '1';
            delete btn.dataset.loading;
            setTimeout(() => { btn.textContent = label; btn.style.color = baseColor; }, 2000);
          }
        });
        return btn;
      };

      // バリエーションの所持状態バッジ/ヒント/ボタンを1行分組み立てる（複数バリエーション行・
      // 単一バリエーションの両方から使う共通処理）。
      function buildVariationActionsRow(v) {
        const row = document.createElement('div');
        // 固定幅・右寄せにすることで、バッジ1個だけの行とヒント+ボタン2個の行とで
        // 中身の幅が違っても、name側の伸縮量が変わらず、価格列の位置が揃うようにする。
        row.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:nowrap;flex-shrink:0;width:210px';
        const fileMatched = canFileMatch && variationMatchesLocalFiles(v.name, asset?.files);
        const alreadyOwned = v.alreadyBought || (inLib && (!canFileMatch || fileMatched));
        // ライブラリにはある（inLib）が、このバリエーション固有のファイルが見つからなかった
        // ケース。本当に未所持とは限らない（タイポ等でファイル名マッチが外れただけかもしれない）
        // ため、ボタンは残しつつ控えめに注記する。
        const maybeOwned = !alreadyOwned && inLib && canFileMatch && !fileMatched;
        if (v.inStock && alreadyOwned) {
          const ownedBadge = document.createElement('span');
          ownedBadge.style.cssText = 'flex-shrink:0;font-size:10px;font-weight:700;font-family:inherit;padding:3px 8px;border-radius:5px;border:1px solid rgba(52,211,153,0.3);background:rgba(52,211,153,0.08);color:rgba(110,231,183,0.7);';
          ownedBadge.textContent = '購入済み';
          row.appendChild(ownedBadge);
        } else if (v.inStock) {
          if (maybeOwned) {
            const hint = document.createElement('span');
            hint.style.cssText = 'flex-shrink:0;font-size:9px;color:#a1a1aa;white-space:nowrap';
            hint.textContent = '既にお持ちかも';
            row.appendChild(hint);
          }
          row.appendChild(makeCartOrBuyBtn(v, false));
          row.appendChild(makeCartOrBuyBtn(v, true));
        }
        return row;
      }

      // バリエーション/価格 — 単一バリエーションでも複数バリエーションでも同じ行レイアウトに統一する
      detailVariations.innerHTML = '';
      if (d.variations && d.variations.length > 0) {
        d.variations.forEach(v => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
          const nameEl = document.createElement('span');
          nameEl.style.cssText = 'font-size:11px;color:#d4d4d8;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          nameEl.textContent = v.name && v.name.trim() ? v.name.trim() : '—';
          const priceEl = document.createElement('span');
          // 価格幅を固定して右寄せにすることで、後ろに続く要素（購入済みバッジ/カート・購入
          // ボタン/ヒント）の有無や長さに関わらず、価格列が縦に揃うようにする。
          priceEl.style.cssText = `flex-shrink:0;min-width:60px;text-align:right;font-size:12px;font-weight:700;white-space:nowrap;color:${v.inStock ? '#34d399' : '#52525b'}`;
          priceEl.textContent = v.price != null ? `¥${Number(v.price).toLocaleString()}` : '無料';
          if (!v.inStock) {
            const sold = document.createElement('span');
            sold.style.cssText = 'font-size:10px;color:#3f3f46;margin-left:4px';
            sold.textContent = '売切';
            priceEl.appendChild(sold);
          }
          row.appendChild(nameEl);
          row.appendChild(priceEl);
          row.appendChild(buildVariationActionsRow(v));
          detailVariations.appendChild(row);
        });
      }

      // タグ
      detailTags.innerHTML = '';
      (d.tags || []).forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-zinc-400 bg-white/3';
        chip.textContent = `#${tag}`;
        detailTags.appendChild(chip);
      });

      // 説明
      detailDesc.textContent = (d.description || '').trim() || '（説明なし）';

      // 画像
      detailImages = d.images || [];
      detailDots.innerHTML = '';
      if (detailThumbs) detailThumbs.innerHTML = '';
      detailImages.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.style.cssText = 'width:6px;height:6px;border-radius:50%;cursor:pointer;transition:background .15s';
        dot.addEventListener('click', () => setDetailImage(i));
        detailDots.appendChild(dot);
      });
      if (detailThumbs) {
        detailImages.forEach((src, i) => {
          const thumb = document.createElement('button');
          thumb.type = 'button';
          thumb.style.cssText = 'aspect-ratio:1/1;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:#09090b;padding:0;overflow:hidden;cursor:pointer;opacity:.56;transition:opacity .15s,border-color .15s';
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
          thumb.appendChild(img);
          thumb.addEventListener('click', () => setDetailImage(i));
          detailThumbs.appendChild(thumb);
        });
      }
      setDetailImage(0);

      // ほしいリスト状態
      if (inLib) {
        detailWishBtn.textContent = 'ライブラリ済';
        detailWishBtn.disabled = true;
        detailWishBtn.className = 'flex-1 py-2 rounded border border-emerald-500/30 text-emerald-400/60 text-xs cursor-default';
      }
    }

    function closeDetail() {
      if (detailPanel) detailPanel.style.display = 'none';
      currentDetailItemId = null;
      currentDetailItem = null;
    }

    if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetail);
    if (detailPanel) detailPanel.addEventListener('click', e => { if (e.target === detailPanel) closeDetail(); });
    if (detailPrevImg) detailPrevImg.addEventListener('click', e => { e.stopPropagation(); setDetailImage(detailImgIdx - 1); });
    if (detailNextImg) detailNextImg.addEventListener('click', e => { e.stopPropagation(); setDetailImage(detailImgIdx + 1); });

    if (detailWishBtn) {
      detailWishBtn.addEventListener('click', async () => {
        if (!currentDetailItemId) return;
        detailWishBtn.disabled = true;
        detailWishBtn.textContent = '...';
        try {
          const res = await toggleWishlist(currentDetailItemId, `https://booth.pm/ja/items/${currentDetailItemId}`);
          if (res?.ok) {
            detailWishBtn.textContent = '✓ ほしいリストに追加済み';
            detailWishBtn.className = 'flex-1 py-2 rounded border border-emerald-500/30 text-emerald-300 text-xs';
            refreshCard(currentDetailItemId);
          } else {
            detailWishBtn.textContent = 'ほしいリストに追加';
            detailWishBtn.disabled = false;
          }
        } catch {
          detailWishBtn.textContent = 'ほしいリストに追加';
          detailWishBtn.disabled = false;
        }
      });
    }

    if (detailOpenBtn) {
      detailOpenBtn.addEventListener('click', () => {
        if (currentDetailItemId) boothAPI.openExternalUrl(`https://booth.pm/ja/items/${currentDetailItemId}`);
      });
    }

    // --- 検索ビュー ---
    // #bview-search がBOOTHクライアントのサイドバーから通常のタブとして表示されるたびに
    // 呼ばれる（render_booth_client.js の switchView 経由）。モーダルの表示切り替えは
    // 不要になった（#bview-search自体の表示/非表示は switchView が管理する）。
    function open() {
      // 再オープン時: 検索済みならカードのバッジ状態を最新化して復元
      if (currentItems.length > 0) {
        renderResults(currentItems);
        setEmptyState(false);
      } else {
        setEmptyState(true);
      }
      searchInput.focus();
    }

    function setStatus(text) {
      if (!status) return;
      if (!text) { status.style.display = 'none'; return; }
      status.textContent = text;
      status.style.display = 'block';
    }

    function setPrevNextState(btn, disabled) {
      btn.disabled = disabled;
      btn.style.opacity = disabled ? '0.35' : '1';
      btn.style.cursor = disabled ? 'default' : 'pointer';
    }

    function renderPageButtons(current, max) {
      if (!pageButtons) return;
      pageButtons.innerHTML = '';

      // 表示するページ番号を決定（省略あり）
      const show = new Set();
      show.add(1);
      show.add(max);
      for (let d = -2; d <= 2; d++) {
        const p = current + d;
        if (p >= 1 && p <= max) show.add(p);
      }
      const pages = Array.from(show).sort((a, b) => a - b);

      let prev = 0;
      for (const p of pages) {
        if (p - prev > 1) {
          const gap = document.createElement('span');
          gap.textContent = '…';
          Object.assign(gap.style, { padding: '8px 4px', fontSize: '13px', color: '#52525b', alignSelf: 'center' });
          pageButtons.appendChild(gap);
        }
        prev = p;

        const btn = document.createElement('button');
        btn.textContent = String(p);
        const isCurrent = p === current;
        Object.assign(btn.style, {
          minWidth: '36px', padding: '8px 10px', borderRadius: '8px', fontSize: '13px',
          fontWeight: isCurrent ? '700' : '400', fontFamily: 'inherit', cursor: 'pointer',
          border: isCurrent ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.08)',
          background: isCurrent ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)',
          color: isCurrent ? '#c4b5fd' : '#a1a1aa',
          transition: 'background .12s,color .12s',
        });
        if (!isCurrent) {
          btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.09)'; btn.style.color = '#e4e4e7'; };
          btn.onmouseout  = () => { btn.style.background = 'rgba(255,255,255,0.04)'; btn.style.color = '#a1a1aa'; };
        }
        btn.addEventListener('click', () => doSearch(p));
        pageButtons.appendChild(btn);
      }
    }

    function setEmptyState(visible) {
      if (emptyState) emptyState.style.display = visible ? 'flex' : 'none';
    }

    async function doSearch(page = 1) {
      const q = searchInput.value.trim();
      if (!q || isLoading) return;
      isLoading = true;
      currentPage = page;
      if (page === 1) { maxKnownPage = 1; totalPages = null; }
      currentSort = sortSelect.value;
      currentInStock = inStockCheck.checked;

      setStatus('検索中...');
      setEmptyState(false);
      grid.innerHTML = '';
      pagination.classList.add('hidden');

      try {
        const priceVal = priceSelect?.value || '';
      const [minPrice, maxPrice] = priceVal
        ? priceVal.split('-').map((v, i) => v === '' ? (i === 0 ? 0 : null) : Number(v))
        : [null, null];
      const res = await boothAPI.searchBooth(q, {
        page, sort: currentSort, inStock: currentInStock,
        categoryId: categorySelect?.value || '',
        minPrice, maxPrice,
      });
        if (res.error) { setStatus(`エラー: ${res.error}`); setEmptyState(true); return; }
        // BOOTHサーバー側はバリエーション最安値基準でフィルターするためクライアント側で補正
        let items = res.items || [];
        if (minPrice != null || maxPrice != null) {
          items = items.filter(item => {
            const p = item.price;
            if (p == null) return minPrice == null || minPrice === 0;
            if (minPrice != null && p < minPrice) return false;
            if (maxPrice != null && p > maxPrice) return false;
            return true;
          });
        }
        renderResults(items);
        hasNextPage = Boolean(res.hasNextPage);
        const count = items.length;
        if (count === 0) {
          setEmptyState(true);
          setStatus('結果が見つかりませんでした');
        } else {
          const total = hasNextPage ? `${count}件以上` : `${count}件`;
          setStatus(total);
        }
        if (page > 1 || hasNextPage) {
          if (res.totalPages) totalPages = res.totalPages;
          maxKnownPage = totalPages ?? Math.max(maxKnownPage, hasNextPage ? page + 1 : page);
          pagination.classList.remove('hidden');
          renderPageButtons(page, maxKnownPage);
          setPrevNextState(prevBtn, page <= 1);
          setPrevNextState(nextBtn, !hasNextPage);
          if (page > 1) grid.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          pagination.classList.add('hidden');
        }
      } catch (e) {
        setStatus(`エラー: ${e?.message || String(e)}`);
        setEmptyState(true);
      } finally {
        isLoading = false;
      }
    }

    function getAsset(itemId) {
      const map = getAssetMap ? getAssetMap() : new Map();
      return map instanceof Map ? (map.get(itemId) || null) : (map[itemId] || null);
    }

    function renderResults(items) {
      currentItems = items;
      grid.innerHTML = '';
      items.forEach(item => grid.appendChild(buildCard(item, getAsset(item.id))));
    }

    function refreshCard(itemId) {
      const old = grid.querySelector(`[data-item-id="${itemId}"]`);
      if (!old) return;
      const item = currentItems.find(i => i.id === itemId);
      if (!item) return;
      const next = buildCard(item, getAsset(itemId));
      old.replaceWith(next);
    }

    function buildCard(item, asset) {
      const inLibrary = Boolean(asset?.downloaded || asset?.files?.length);
      const inWishlist = Boolean(asset?.isWishlisted) && !inLibrary;

      const card = document.createElement('div');
      card.dataset.itemId = item.id;
      card.className = 'flex flex-col bg-black/30 border border-white/5 rounded-xl overflow-hidden hover:border-violet-500/30 transition-colors group cursor-pointer';

      const imgWrap = document.createElement('div');
      imgWrap.className = 'aspect-square bg-zinc-900 overflow-hidden flex-shrink-0';
      if (item.imageUrl) {
        const img = document.createElement('img');
        img.src = item.imageUrl;
        img.alt = '';
        img.className = 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300';
        img.loading = 'lazy';
        imgWrap.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'flex flex-col gap-1 p-3 flex-1';

      const name = document.createElement('div');
      name.className = 'text-xs font-medium text-zinc-200 line-clamp-2 leading-snug';
      name.textContent = item.name || '';

      const metaRow = document.createElement('div');
      metaRow.className = 'flex items-center justify-between mt-auto pt-1';

      const priceEl = document.createElement('span');
      priceEl.className = 'text-xs font-bold text-emerald-400';
      priceEl.textContent = item.price != null ? `¥${item.price.toLocaleString()}〜` : '無料';

      const shopEl = document.createElement('span');
      shopEl.className = 'text-[10px] text-zinc-500 truncate max-w-[80px]';
      shopEl.textContent = item.shop || '';

      metaRow.appendChild(priceEl);
      metaRow.appendChild(shopEl);

      const btnRow = document.createElement('div');
      btnRow.className = 'flex gap-1.5 mt-2';

      if (inLibrary) {
        const badge = document.createElement('span');
        badge.className = 'text-[10px] text-emerald-400/70 border border-emerald-500/20 rounded px-2 py-1 flex-1 text-center';
        badge.textContent = 'ライブラリ済';
        btnRow.appendChild(badge);
      } else if (inWishlist) {
        const badge = document.createElement('span');
        badge.className = 'text-[10px] text-violet-300/60 border border-violet-500/20 rounded px-2 py-1 flex-1 text-center';
        badge.textContent = '♥ ほしい済';
        btnRow.appendChild(badge);
      } else {
        const wishBtn = document.createElement('button');
        wishBtn.className = 'flex-1 text-[10px] px-2 py-1 rounded border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 transition-colors';
        wishBtn.textContent = 'ほしい';
        wishBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          wishBtn.disabled = true;
          wishBtn.textContent = '...';
          try {
            const res = await toggleWishlist(item.id, `https://booth.pm/ja/items/${item.id}`);
            if (res?.ok) refreshCard(item.id);
            else { wishBtn.textContent = 'ほしい'; wishBtn.disabled = false; }
          } catch {
            wishBtn.textContent = 'ほしい';
            wishBtn.disabled = false;
          }
        });
        btnRow.appendChild(wishBtn);
      }

      const boothBtn = document.createElement('button');
      boothBtn.className = 'text-[10px] px-2 py-1 rounded border border-white/10 text-zinc-400 hover:bg-white/5 transition-colors';
      boothBtn.textContent = 'BOOTH';
      boothBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        boothAPI.openExternalUrl(`https://booth.pm/ja/items/${item.id}`);
      });
      btnRow.appendChild(boothBtn);

      body.appendChild(name);
      body.appendChild(metaRow);
      body.appendChild(btnRow);
      card.appendChild(imgWrap);
      card.appendChild(body);

      // カードクリックで詳細パネルを開く
      card.addEventListener('click', () => openDetail(item.id, item));

      return card;
    }

    submitBtn?.addEventListener('click', () => doSearch(1));
    searchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(1); });
    prevBtn?.addEventListener('click', () => { if (currentPage > 1) doSearch(currentPage - 1); });
    nextBtn?.addEventListener('click', () => { if (hasNextPage) doSearch(currentPage + 1); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && detailPanel?.style.display === 'flex') {
        closeDetail();
      }
    });

    // 商品詳細は、ホーム/検索/カート/ほしいリストなど、どのビューからでも共通で開ける
    // 独立モーダルとして扱う（openDetailがdetailPanel自身の表示切り替えまで行う）。
    global.AvatoolBoothDetail = { open: openDetail, close: closeDetail };
    // #bview-search がBOOTHクライアントのサイドバーから表示される際に呼ばれる
    // （render_booth_client.js の switchView から起動）。
    global.AvatoolBoothSearchView = { activate: open };

    return { open };
  }

  global.AvatoolBoothSearch = { createBoothSearchView };
})(window);
