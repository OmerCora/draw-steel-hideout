/**
 * Draw Steel – Hideout
 * Module constants and configuration.
 */

export const MODULE_ID = "draw-steel-hideout";
export const SYSTEM_ID = "draw-steel";

/** Folder name for created followers in the world. */
export const HIDEOUT_FOLDER = "Hideout";

/** The type key for the Follower actor subtype. */
export const FOLLOWER_TYPE = `${MODULE_ID}.follower`;

/** Setting keys */
export const SETTINGS = {
  PROJECTS: "projects",
  STASH: "stash",
  FOLLOWERS: "roster-followers",
  ITEM_FOLLOWERS: "roster-item-followers",
  ARCHIVES: "archives",
  MINIMUM_ROLE: "minimumRole",
  MINIMUM_GM_ROLE: "minimumGmRole",
  ALLOW_INDIVIDUAL_ROLLS: "allowIndividualRolls",
  DEFAULT_PROJECT_SETTINGS: "defaultProjectSettings",
  PROJECT_BROWSER_FILTERS: "projectBrowserFilters",
  TREASURE_BROWSER_FILTERS: "treasureBrowserFilters",
};

/**
 * Default values applied to newly-created projects when no override is given.
 * The Default Project Settings dialog persists the world-level overrides; this
 * object is the factory baseline used to reset/initialise that setting.
 */
export const PROJECT_SETTING_DEFAULTS = Object.freeze({
  eventsMode: "disabled",
  eventTableUuid: null,
  postEventsPrivate: true,
  carryOverflow: false,
});

/** Default compendium pack IDs that contain project-type items. */
export const DEFAULT_PROJECT_PACK_IDS = new Set(["draw-steel.rewards"]);

/** Default compendium pack IDs that contain treasure-type items. */
export const DEFAULT_TREASURE_PACK_IDS = new Set(["draw-steel.rewards"]);

/** Index fields for project item packs. */
export const PROJECT_INDEX_FIELDS = [
  "system.type",
  "system.goal",
  "system.projectSource",
  "system.rollCharacteristic",
  "system.prerequisites",
  "system.description.value",
  "system.yield.item",
  "system.yield.amount",
  "system.yield.display",
  "img",
];

/** Index fields for treasure item packs. */
export const TREASURE_INDEX_FIELDS = [
  "system.kind",
  "system.category",
  "system.echelon",
  "system.keywords",
  "system.description.value",
  "system.project.goal",
  "system.project.source",
  "system.project.rollCharacteristic",
  "system.project.prerequisites",
  "system.project.yield.amount",
  "system.project.yield.display",
  "system.quantity",
  "img",
];

/**
 * Characteristics that can be used for project rolls, with their roll-key abbreviations.
 */
export const CHARACTERISTIC_ROLL_KEYS = {
  might: "M",
  agility: "A",
  reason: "R",
  intuition: "I",
  presence: "P",
};
