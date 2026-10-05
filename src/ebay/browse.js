// Vergleichsangebote (Browse API) + Kategorievorschläge (Taxonomy API) mit Application Token.
import { ebayFetch, hosts } from './http.js';
import { getAppToken } from './auth.js';
import { round2 } from '../util.js';

/** Preisstatistik aus Browse-API-Treffern (itemSummaries). */
export function priceStats(items = []) {
  const prices = items
    .map((i) => ({ v: Number(i?.price?.value), c: i?.price?.currency }))
    .filter((p) => Number.isFinite(p.v) && p.v > 0 && (!p.c || p.c === 'EUR'))
    .map((p) => p.v)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const n = prices.length;
  const median = n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
  const avg = prices.reduce((a, b) => a + b, 0) / n;
  return { anzahl: n, min: round2(prices[0]), median: round2(median), max: round2(prices[n - 1]), durchschnitt: round2(avg) };
}

export async function searchComparables(query, limit = 50) {
  const token = await getAppToken();
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  const d = await ebayFetch(`${hosts().api}/buy/browse/v1/item_summary/search?${q}`, {
    token,
    headers: { 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE' },
  });
  const items = d.itemSummaries || [];
  return {
    statistik: priceStats(items),
    beispiele: items.slice(0, 6).map((i) => ({
      titel: i.title,
      preis: i.price ? `${i.price.value} ${i.price.currency}` : '',
      zustand: i.condition || '',
      url: i.itemWebUrl,
    })),
  };
}

export async function categorySuggestions(query) {
  const token = await getAppToken();
  let treeId = '77';
  try {
    const t = await ebayFetch(`${hosts().api}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE`, { token });
    if (t.categoryTreeId) treeId = t.categoryTreeId;
  } catch {
    /* Standard 77 = Deutschland */
  }
  const d = await ebayFetch(
    `${hosts().api}/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?${new URLSearchParams({ q: query })}`,
    { token }
  );
  return (d.categorySuggestions || []).slice(0, 6).map((s) => ({
    id: s.category.categoryId,
    name: s.category.categoryName,
    pfad: (s.categoryTreeNodeAncestors || []).map((a) => a.categoryName).reverse().concat(s.category.categoryName).join(' > '),
  }));
}
