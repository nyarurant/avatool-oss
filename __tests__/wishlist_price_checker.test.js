'use strict';

const { runWishlistPriceCheck } = require('../lib/wishlist_price_checker');

describe('runWishlistPriceCheck', () => {
  test('wishlist item に価格レンジとバリエーション内訳を反映する', async () => {
    const metaPath = 'meta.json';
    let stored = JSON.stringify([
      {
        itemId: '8027472',
        itemName: 'STREETPUNK',
        isWishlisted: true,
        price: 800,
        lastPriceCheckedAt: 0,
      },
    ]);
    const fs = {
      readFileSync: jest.fn(() => stored),
    };
    const writeMetaFile = jest.fn((next) => {
      stored = JSON.stringify(next);
    });
    const fetchItemPricePublic = jest.fn(async () => ({
      price: 800,
      priceMin: 800,
      priceMax: 1600,
      priceVariationCount: 2,
      priceVariations: [
        { name: '通常版', price: 800 },
        { name: 'おやつ代', price: 1600 },
      ],
    }));

    await runWishlistPriceCheck({
      metaPath,
      fs,
      fetchItemPricePublic,
      writeMetaFile,
    });

    expect(fetchItemPricePublic).toHaveBeenCalledWith('8027472');
    expect(writeMetaFile).toHaveBeenCalledTimes(1);
    const next = JSON.parse(stored);
    expect(next[0].priceMin).toBe(800);
    expect(next[0].priceMax).toBe(1600);
    expect(next[0].priceVariationCount).toBe(2);
    expect(next[0].priceVariations).toEqual([
      { name: '通常版', price: 800 },
      { name: 'おやつ代', price: 1600 },
    ]);
  });
});
