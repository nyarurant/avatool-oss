'use strict';

const { createWishlistService } = require('../lib/wishlist_service');

function makeDeps(overrides = {}) {
  const boothClient = {
    get: jest.fn((url) => {
      if (String(url).includes('/ja/items/')) {
        return Promise.resolve({ data: { name: 'Wishlist asset' } });
      }
      if (String(url).includes('wish_list_names.json')) {
        return Promise.resolve({ data: [{ name: 'avatool', code: 'avatool-code' }] });
      }
      if (String(url).includes('wish_list_items.json')) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: '<meta name="csrf-token" content="csrf-token">' });
    }),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    patch: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return {
    boothClient,
    getBoothClient: jest.fn(() => boothClient),
    ensureClientReady: jest.fn(() => Promise.resolve()),
    extractBoothItemId: jest.fn(() => '12345'),
    extractBoothCsrfFromHtml: jest.fn(() => 'csrf-token'),
    metaMgr: {
      createWishlistMetaItem: jest.fn((itemId, itemJson) => ({ itemId, itemName: itemJson.name })),
      isWishlistOnlyMetaItem: jest.fn(() => true),
    },
    fs: { existsSync: jest.fn(() => false), readFileSync: jest.fn() },
    META_PATH: 'C:/test/librarymeta.json',
    dedupeMetaItemsByItemId: jest.fn((items) => items),
    writeMetaFile: jest.fn(),
    ...overrides,
  };
}

describe('wishlist service BOOTH sync result contract', () => {
  test('addItemToAvatoolWishListName reports a successful BOOTH sync', async () => {
    const deps = makeDeps();
    const service = createWishlistService(deps);

    const result = await service.addItemToAvatoolWishListName('12345');

    expect(result).toMatchObject({ ok: true });
    expect(deps.boothClient.post).toHaveBeenCalledWith(
      'https://booth.pm/items/12345/wish_list',
      null,
      expect.any(Object),
    );
  });

  test('addItemToAvatoolWishListName returns an error result when BOOTH rejects it', async () => {
    const deps = makeDeps();
    deps.boothClient.post.mockRejectedValueOnce(new Error('BOOTH unavailable'));
    const service = createWishlistService(deps);

    const result = await service.addItemToAvatoolWishListName('12345');

    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(result.error).toContain('BOOTH unavailable');
  });

  test('removeItemFromAvatoolWishListName reports a successful BOOTH sync', async () => {
    const deps = makeDeps();
    deps.boothClient.get.mockImplementation((url) => {
      if (String(url).includes('wish_list_names.json')) {
        return Promise.resolve({ data: [{ name: 'avatool', code: 'avatool-code' }] });
      }
      if (String(url).includes('wish_list_items.json')) {
        return Promise.resolve({ data: [{ is_item_in_wish_list_name: true, wish_list_name_code: 'avatool-code' }] });
      }
      return Promise.resolve({ data: '<meta name="csrf-token" content="csrf-token">' });
    });
    const service = createWishlistService(deps);

    const result = await service.removeItemFromAvatoolWishListName('12345');

    expect(result).toMatchObject({ ok: true });
    expect(deps.boothClient.patch).toHaveBeenCalledWith(
      'https://booth.pm/items/12345/wish_list_items.json',
      { wish_list_name_codes: [] },
      expect.any(Object),
    );
  });

  test('removeItemFromAvatoolWishListName returns an error result when BOOTH rejects it', async () => {
    const deps = makeDeps();
    deps.boothClient.get.mockImplementation((url) => {
      if (String(url).includes('wish_list_names.json')) {
        return Promise.resolve({ data: [{ name: 'avatool', code: 'avatool-code' }] });
      }
      if (String(url).includes('wish_list_items.json')) {
        return Promise.reject(new Error('BOOTH unavailable'));
      }
      return Promise.resolve({ data: '<meta name="csrf-token" content="csrf-token">' });
    });
    const service = createWishlistService(deps);

    const result = await service.removeItemFromAvatoolWishListName('12345');

    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(result.error).toContain('BOOTH unavailable');
  });
});

describe('resolveWishlistCandidate', () => {
  test('syncBooth=false does not start a remote wishlist mutation', async () => {
    const deps = makeDeps();
    const service = createWishlistService(deps);

    const result = await service.resolveWishlistCandidate('https://booth.pm/ja/items/12345', { syncBooth: false });
    // Give a fire-and-forget sync a chance to reach its first HTTP mutation.
    await new Promise(setImmediate);

    expect(result).toMatchObject({ ok: true, itemId: '12345' });
    expect(deps.boothClient.post).not.toHaveBeenCalled();
    expect(deps.boothClient.patch).not.toHaveBeenCalled();
  });
});
