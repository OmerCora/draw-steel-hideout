/**
 * Draw Steel – Hideout
 * Archives manager: known recipes, manuals, blueprints the party has unlocked.
 */

import { MODULE_ID, SETTINGS } from "../config.mjs";

export function getArchives() {
  try {
    return JSON.parse(game.settings.get(MODULE_ID, SETTINGS.ARCHIVES) ?? "[]");
  } catch {
    return [];
  }
}

async function _saveArchives(items) {
  await game.settings.set(MODULE_ID, SETTINGS.ARCHIVES, JSON.stringify(items));
}

/**
 * Add an entry to the archives. Deduplicates by UUID.
 * @param {{ uuid: string, name: string, img: string, description: string, category: string, echelon: number, hasCraftingData: boolean, projectData: object|null }} entry
 * @returns {Promise<boolean>} false if already present, true if added.
 */
export async function addArchiveEntry(entry) {
  const items = getArchives();
  if (items.some(i => i.uuid === entry.uuid)) return false;
  items.push({
    id: foundry.utils.randomID(),
    uuid: entry.uuid,
    name: entry.name,
    img: entry.img ?? "icons/svg/item-bag.svg",
    description: entry.description ?? "",
    category: entry.category ?? "",
    echelon: entry.echelon ?? 0,
    hasCraftingData: entry.hasCraftingData ?? false,
    projectData: entry.projectData ?? null,
  });
  await _saveArchives(items);
  return true;
}

/**
 * Remove an entry from the archives by its local ID.
 * @param {string} id
 */
export async function removeArchiveEntry(id) {
  const items = getArchives().filter(i => i.id !== id);
  await _saveArchives(items);
}
