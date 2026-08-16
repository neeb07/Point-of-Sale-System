/**
 * Blaze POS — shared constants.
 *
 * These were previously duplicated across MenuPanel.tsx, Deals.tsx and
 * MenuManagement.jsx, which is how the deal-group and category drift bugs
 * happened in the first place. Single source of truth now.
 */

/** Deal sub-groups. Must match `deals.deal_group` values in the database. */
export const DEAL_GROUPS = [
  '1 Person Deals',
  '2 Person Deals',
  'Student Deal',
  'Special Pizza Deal',
  'Family Deal',
  'Lunch & Midnight Deal',
  'Broast Deal',
] as const;

/** Deal group list including the "show everything" pseudo-tab. */
export const DEAL_GROUP_TABS = ['All Deals', ...DEAL_GROUPS] as const;

/**
 * Menu categories that actually exist in the seeded database.
 * MenuManagement merges this with whatever categories are live in the DB,
 * so adding a new one from the UI never orphans an item.
 */
export const MENU_CATEGORIES = [
  'Burger',
  'Chicken Rolls',
  'Sides',
  'Pizza',
  'Drinks',
  'Ice Cream',
] as const;

export const DEFAULT_CATEGORY = 'Burger';

/** Payment methods offered at checkout. */
export const PAYMENT_METHODS = ['Cash', 'Card', 'Online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Order types. */
export const ORDER_TYPES = ['Dine-in', 'Delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
