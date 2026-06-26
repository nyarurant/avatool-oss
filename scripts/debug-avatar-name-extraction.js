/**
 * debug-avatar-name-extraction.js
 *
 * アバターアイテムの名前抽出結果を検証するデバッグスクリプト。
 * 実際の librarymeta.json を読み込み、fixAvatarItemFields の前後を比較する。
 *
 * Usage:
 *   node scripts/debug-avatar-name-extraction.js
 *   node scripts/debug-avatar-name-extraction.js --apply  # 実際に librarymeta.json へ書き戻す
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── パス解決 ─────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'avatool', 'data');
const META_PATH = path.join(DATA_DIR, 'librarymeta.json');
const AVATARS_PATH = path.join(DATA_DIR, 'avatars.json');
const APPLY = process.argv.includes('--apply');

// ── booth_meta_fetcher をロード ───────────────────────────────────────────────
const fetcher = require('../lib/booth_meta_fetcher.js');
fetcher.setDataRoot(DATA_DIR);

const { fixAvatarItemFields, syncAvatarItemsToFile } = fetcher;

// ── メタ読み込み ──────────────────────────────────────────────────────────────
if (!fs.existsSync(META_PATH)) {
  console.error('librarymeta.json が見つかりません:', META_PATH);
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
const avatarItems = items.filter((i) => {
  const cats = Array.isArray(i.categories) ? i.categories : [];
  return i.isAvatarItem || cats.some((c) => {
    const s = String(c?.slug || c?.href || '').toLowerCase();
    return s.includes('3d%e3%82%ad%e3%83%a3%e3%83%a9%e3%82%af%e3%82%bf%e3%83%bc') ||
           s.includes('3dキャラクター') || s.includes('3d%e3%83%a2%e3%83%87%e3%83%ab');
  });
});

console.log(`\n📦 librarymeta.json: ${items.length} アイテム / うちアバター候補: ${avatarItems.length} 件\n`);
console.log('━'.repeat(72));

// ── Before ───────────────────────────────────────────────────────────────────
console.log('\n【Before】fixAvatarItemFields 適用前\n');
avatarItems.forEach((item) => {
  console.log(`  ${item.itemName}`);
  console.log(`    supportedAvatars:          ${JSON.stringify(item.supportedAvatars)}`);
  console.log(`    supportedAvatarsInferred:  ${JSON.stringify(item.supportedAvatarsInferred)}`);
  console.log(`    nameVariants.katakana:     ${JSON.stringify(item.nameVariants?.katakana)}`);
  console.log(`    nameVariants.latin:        ${JSON.stringify(item.nameVariants?.latin)}`);
  console.log();
});

// ── Apply fix (on cloned data to avoid mutating unless --apply) ───────────────
const cloned = JSON.parse(JSON.stringify(items));
fixAvatarItemFields(cloned);
const clonedAvatarItems = cloned.filter((i) => i.isAvatarItem);

console.log('━'.repeat(72));
console.log('\n【After】fixAvatarItemFields 適用後\n');

let allOk = true;
clonedAvatarItems.forEach((item) => {
  const sa = item.supportedAvatars?.[0] || '(empty)';
  const isClean = sa.length <= 20 && !/オリジナル|3Dモデル|ver\.|【|】|『|』/.test(sa);
  const mark = isClean ? '✅' : '⚠️ ';
  if (!isClean) allOk = false;
  console.log(`  ${mark} ${item.itemName}`);
  console.log(`     supportedAvatars: ${JSON.stringify(item.supportedAvatars)}`);
  console.log();
});

// ── avatars.json の現状 ───────────────────────────────────────────────────────
console.log('━'.repeat(72));
console.log('\n【avatars.json】現在の内容\n');
if (fs.existsSync(AVATARS_PATH)) {
  const avatarsRaw = JSON.parse(fs.readFileSync(AVATARS_PATH, 'utf8'));
  if (Array.isArray(avatarsRaw) && avatarsRaw.length === 0) {
    console.log('  ⚠️  空 ([] ) — pruneOrphanedAvatarEntries により削除された可能性があります');
  } else {
    (Array.isArray(avatarsRaw) ? avatarsRaw : []).forEach((e) => {
      console.log(`  - ${e.name}  (count: ${e.count})`);
    });
  }
} else {
  console.log('  ファイルなし');
}
console.log();

// ── 判定サマリー ─────────────────────────────────────────────────────────────
console.log('━'.repeat(72));
if (allOk) {
  console.log('\n✅ 全アバターアイテムのアバター名が正しく抽出されています。\n');
} else {
  console.log('\n⚠️  一部アイテムで抽出が不完全な可能性があります。上の After ログを確認してください。\n');
}

// ── --apply モード ────────────────────────────────────────────────────────────
if (APPLY) {
  console.log('--apply モード: librarymeta.json に書き戻します...');
  fs.writeFileSync(META_PATH, JSON.stringify(cloned, null, 2), 'utf8');
  // avatars.json を再構築
  syncAvatarItemsToFile(cloned);
  const avatarsAfter = JSON.parse(fs.readFileSync(AVATARS_PATH, 'utf8'));
  console.log(`avatars.json を更新しました (${avatarsAfter.length} エントリ):`);
  (Array.isArray(avatarsAfter) ? avatarsAfter : []).forEach((e) => {
    console.log(`  - ${e.name}`);
  });
  console.log('\n完了。アプリを再起動してフィルターを確認してください。');
} else {
  console.log('※ 実際に書き戻すには --apply オプションを付けて実行してください。');
  console.log('   node scripts/debug-avatar-name-extraction.js --apply\n');
}
