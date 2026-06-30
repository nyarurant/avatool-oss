'use strict';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const axios = require('axios');
const { searchBoothItems, parseBoothHomeHtml, parseBoothRelatedItemsJson } = require('../lib/booth_search');

describe('searchBoothItems', () => {
  beforeEach(() => {
    axios.get.mockReset();
  });

  test('data-product-brand が data-product-id より前にある検索結果でも shop を読む', async () => {
    axios.get.mockResolvedValue({
      data: `
        <ul>
          <li class="item-card" data-product-brand="trista" data-product-category="127" data-product-id="6341654" data-product-name="Seeker" data-product-price="1950">
            <div class="item-card__wrap" id="item_6341654">
              <a data-original="https://booth.pximg.net/c/300x300/item.jpg"></a>
            </div>
          </li>
        </ul>
      `,
    });

    const res = await searchBoothItems({ query: 'TRISTA', page: 1, inStock: false });

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: '6341654',
      name: 'Seeker',
      shop: 'trista',
      categoryId: '127',
      imageUrl: 'https://booth.pximg.net/c/300x300/item.jpg',
    });
  });
});

describe('parseBoothHomeHtml', () => {
  test('extracts product sections and removes duplicate section blocks', () => {
    const section = `
      <div class="market_section">
        <div class="market_section-head">
          <h2 class="market_section-head-title">3Dモデルの注目商品</h2>
          <a class="more-to-category" href="/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?new_arrival=true">more</a>
        </div>
        <ul>
          <li class="item-card" data-product-brand="trista" data-product-category="127" data-product-id="6341654" data-product-name="Seeker" data-product-price="1950">
            <div id="item_6341654"><a href="/ja/items/6341654" data-original="https://booth.pximg.net/item.jpg"></a></div>
          </li>
        </ul>
      </div>
    `;

    const res = parseBoothHomeHtml(`${section}${section}`, { limitSections: 6, itemsPerSection: 4 });

    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].title).toBe('3Dモデルの注目商品');
    expect(res.sections[0].moreUrl).toBe('https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?new_arrival=true');
    expect(res.sections[0].items[0]).toMatchObject({
      id: '6341654',
      name: 'Seeker',
      price: 1950,
      shop: 'trista',
      imageUrl: 'https://booth.pximg.net/item.jpg',
      url: 'https://booth.pm/ja/items/6341654',
    });
  });
});

describe('parseBoothRelatedItemsJson', () => {
  test('normalizes related item API payload', () => {
    const res = parseBoothRelatedItemsJson({
      category_name: '3Dモデル',
      related_items: [{
        id: 6106863,
        name: 'オリジナル3Dモデル「しなの」',
        price: '¥ 6,000',
        shop: { name: 'ポンデロニウム研究所', url: 'https://ponderogen.booth.pm/', thumbnail_url: 'https://booth.pximg.net/shop.jpg' },
        thumbnail_image_urls: ['https://booth.pximg.net/item.jpg'],
        url: 'https://booth.pm/ja/items/6106863',
        category: { name: { ja: '3Dキャラクター' } },
        tracking_data: { product_price: 6000, product_brand: 'ponderogen', product_category: 208 },
        is_vrchat: true,
      }],
      tag_related_items: [{
        id: 6106863,
        name: 'duplicate',
      }],
    });

    expect(res.categoryName).toBe('3Dモデル');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: '6106863',
      name: 'オリジナル3Dモデル「しなの」',
      price: 6000,
      priceText: '¥ 6,000',
      shop: 'ポンデロニウム研究所',
      shopUrl: 'https://ponderogen.booth.pm/',
      categoryId: '208',
      categoryName: '3Dキャラクター',
      imageUrl: 'https://booth.pximg.net/item.jpg',
      url: 'https://booth.pm/ja/items/6106863',
      isVrchat: true,
    });
  });
});
