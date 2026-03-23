import type { Core } from '@strapi/strapi';

function asFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Allowed category ids for a tenant-visible content-items set.
 * Includes the parent chain so the category tree stays navigable.
 */
export async function resolveAllowedCategoryIds(
  strapi: Core.Strapi,
  visibleContentItemIds: number[],
): Promise<number[]> {
  if (!Array.isArray(visibleContentItemIds) || visibleContentItemIds.length === 0) return [];

  // content-category relation is stored via link table.
  const rows = await (strapi as any).db.connection('content_items_category_lnk')
    .distinct('content_category_id as id')
    .whereIn('content_item_id', visibleContentItemIds)
    .whereNotNull('content_category_id');

  const initial = Array.isArray(rows)
    ? rows.map((r: any) => asFiniteNumber(r.id)).filter((n: number | null) => n != null) as number[]
    : [];

  const allowed = new Set<number>(initial);
  const queue: number[] = [...initial];

  // Include parent chain so the category tree remains navigable.
  while (queue.length > 0) {
    const batch = queue.splice(0, 500);
    const parents = await (strapi as any).db.connection('content_categories_parent_lnk')
      .select('inv_content_category_id as id')
      .whereIn('content_category_id', batch);

    if (!Array.isArray(parents)) continue;

    for (const row of parents as any[]) {
      const parentId = asFiniteNumber(row?.id);
      if (parentId == null) continue;
      if (!allowed.has(parentId)) {
        allowed.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return Array.from(allowed);
}

/**
 * Allowed navigation ids for a tenant-visible content-items set.
 * Includes the parent chain so the navigation tree stays navigable.
 */
export async function resolveAllowedNavigationIds(
  strapi: Core.Strapi,
  visibleContentItemIds: number[],
): Promise<number[]> {
  if (!Array.isArray(visibleContentItemIds) || visibleContentItemIds.length === 0) return [];

  // navigation-item content relation is stored via link table.
  const initialRows = await (strapi as any).db.connection('navigation_items_content_item_lnk')
    .distinct('navigation_item_id as id')
    .whereIn('content_item_id', visibleContentItemIds);

  const initialIds = Array.isArray(initialRows)
    ? initialRows
      .map((r: any) => asFiniteNumber(r.id))
      .filter((n: number | null) => n != null) as number[]
    : [];

  const allowed = new Set<number>(initialIds);
  const queue: number[] = [...allowed];

  while (queue.length > 0) {
    const batch = queue.splice(0, 500);
    // navigation parent relation is stored via link table (inv_navigation_item_id = parent).
    const parentsRows = await (strapi as any).db.connection('navigation_items_parent_lnk')
      .select('inv_navigation_item_id as id')
      .whereIn('navigation_item_id', batch);

    if (!Array.isArray(parentsRows)) continue;

    for (const row of parentsRows as any[]) {
      const parentId = asFiniteNumber(row?.id);
      if (parentId == null) continue;
      if (!allowed.has(parentId)) {
        allowed.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return Array.from(allowed);
}

export async function resolveAllowedProductIds(
  strapi: Core.Strapi,
  visibleContentItemIds: number[],
): Promise<number[]> {
  if (!Array.isArray(visibleContentItemIds) || visibleContentItemIds.length === 0) return [];

  const rows = await (strapi as any).db.connection('content_items_product_lnk')
    .distinct('product_id as id')
    .whereIn('content_item_id', visibleContentItemIds)
    .whereNotNull('product_id');

  return Array.isArray(rows)
    ? rows.map((r: any) => asFiniteNumber(r.id)).filter((n: number | null) => n != null) as number[]
    : [];
}

export async function resolveAllowedSwaggerIds(
  strapi: Core.Strapi,
  visibleContentItemIds: number[],
): Promise<number[]> {
  if (!Array.isArray(visibleContentItemIds) || visibleContentItemIds.length === 0) return [];

  const rows = await (strapi as any).db.connection('content_items_swagger_lnk')
    .distinct('swagger_id as id')
    .whereIn('content_item_id', visibleContentItemIds)
    .whereNotNull('swagger_id');

  return Array.isArray(rows)
    ? rows.map((r: any) => asFiniteNumber(r.id)).filter((n: number | null) => n != null) as number[]
    : [];
}

