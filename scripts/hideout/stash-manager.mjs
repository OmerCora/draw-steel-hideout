/**
 * Draw Steel – Hideout
 * Party Stash state manager.
 *
 * Stash items are persisted as a world-scoped Setting (JSON array).
 */

import { MODULE_ID, SETTINGS } from "../config.mjs";
import { saveWorldSetting } from "../socket.mjs";

// ── Typedefs ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StashItem
 * @property {string}   id        Unique module-generated ID.
 * @property {string}   uuid      Source item UUID.
 * @property {string}   name      Display name.
 * @property {string}   img       Icon path.
 * @property {string}   description HTML description.
 * @property {string}   category  Treasure category: "consumable"|"trinket"|"leveled"|"artifact"|""
 * @property {number}   echelon   Echelon tier (1-4).
 * @property {number}   quantity  Stack quantity.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {StashItem[]} */
function _loadStash() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTINGS.STASH);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

/** @param {StashItem[]} items */
async function _saveStash(items) {
  await saveWorldSetting(SETTINGS.STASH, JSON.stringify(items));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return all stash items.
 * @returns {StashItem[]}
 */
export function getStash() {
  return _loadStash();
}

/**
 * Add an item to the stash.
 * If the item already exists (by UUID), increase its quantity instead.
 * @param {object} itemData
 * @param {number} [quantity=1]
 * @returns {Promise<StashItem>}
 */
export async function addStashItem(itemData, quantity = 1) {
  const items = _loadStash();

  const existing = items.find(i => i.uuid === itemData.uuid || (itemData.name && i.name === itemData.name));
  if (existing) {
    existing.quantity = (existing.quantity ?? 1) + quantity;
    await _saveStash(items);
    return existing;
  }

  /** @type {StashItem} */
  const item = {
    id: foundry.utils.randomID(),
    uuid: itemData.uuid,
    name: itemData.name,
    img: itemData.img ?? "icons/svg/item-bag.svg",
    description: itemData.description ?? "",
    category: itemData.category ?? "",
    echelon: itemData.echelon ?? 0,
    quantity,
  };

  items.push(item);
  await _saveStash(items);
  return item;
}

/**
 * Remove a stash item by its module ID.
 * @param {string} itemId
 */
export async function removeStashItem(itemId) {
  const items = _loadStash().filter(i => i.id !== itemId);
  await _saveStash(items);
}

/**
 * Change the quantity of a stash item. Removes if quantity drops to 0.
 * @param {string} itemId
 * @param {number} delta Positive or negative change.
 */
export async function changeStashQuantity(itemId, delta) {
  const items = _loadStash();
  const idx = items.findIndex(i => i.id === itemId);
  if (idx === -1) return;

  items[idx].quantity = Math.max(0, (items[idx].quantity ?? 1) + delta);
  if (items[idx].quantity === 0) items.splice(idx, 1);

  await _saveStash(items);
}
