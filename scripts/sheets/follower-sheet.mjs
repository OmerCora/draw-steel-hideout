/**
 * Draw Steel – Hideout
 * Custom actor sheet for the Follower actor subtype.
 *
 * Extends DrawSteelRetainerSheet (found at runtime) to provide a trimmed view:
 *   Stats:      Characteristics | Skills | Languages
 *   Features:   (unchanged from retainer)
 *   Effects:    (unchanged)
 *   Biography:  Biography text + Director notes (Languages moved to Stats)
 *   No Abilities tab.
 *
 * The class is built lazily inside getFollowerSheetClass() so we can extend
 * the live DrawSteelRetainerSheet class after the system has loaded.
 */

import { MODULE_ID } from "../config.mjs";

const DS_BASE = "systems/draw-steel/templates/sheets/actor";

/** @type {typeof foundry.applications.sheets.ActorSheetV2 | null} */
let _FollowerSheet = null;

/**
 * Returns the FollowerSheet class, building it on first call.
 * Must be called during or after the `ready` hook so that
 * DrawSteelRetainerSheet is already registered.
 * @returns {typeof foundry.applications.sheets.ActorSheetV2}
 */
export function getFollowerSheetClass() {
  if (_FollowerSheet) return _FollowerSheet;

  // Prefer the original system class from the ds namespace. When Draw Steel Plus
  // is enabled it replaces CONFIG.Actor.sheetClasses.retainer with its own subclass
  // that breaks our trimmed Stats tab (characteristics/skills/languages don't render).
  // Extending the unmodified system class avoids inheriting those overrides.
  const dsPlusActive = game.modules.get("draw-steel-plus")?.active;
  let DrawSteelRetainerSheet = ds?.applications?.sheets?.DrawSteelRetainerSheet ?? null;

  if (!DrawSteelRetainerSheet) {
    // Fallback: pull from the live registry (may be DS Plus's override).
    const retainerEntries = Object.values(CONFIG.Actor.sheetClasses?.retainer ?? {});
    const retainerEntry = retainerEntries.find(e => e.default) ?? retainerEntries[0];
    DrawSteelRetainerSheet = retainerEntry?.cls ?? null;
  }

  if (!DrawSteelRetainerSheet) {
    throw new Error(
      "draw-steel-hideout | Cannot build FollowerSheet – DrawSteelRetainerSheet not found. " +
      `Available actor sheet types: ${Object.keys(CONFIG.Actor.sheetClasses ?? {}).join(", ")}`
    );
  }

  if (dsPlusActive) {
    console.log("draw-steel-hideout | Draw Steel Plus detected – extending the unmodified system DrawSteelRetainerSheet for FollowerSheet.");
  }

  /* ------------------------------------------------------------------ */

  _FollowerSheet = class FollowerSheet extends DrawSteelRetainerSheet {

    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
      // "follower-sheet" is merged with ancestor classes (draw-steel, sheet, actor, retainer)
      classes: ["follower-sheet"],
      position: { height: 560 },
      // No extra actions needed beyond what the retainer provides
      actions: {},
    };

    /* -------------------------------------------------- */

    /** @inheritdoc */
    static PARTS = {
      header: {
        template: `${DS_BASE}/retainer-sheet/header.hbs`,
      },
      tabs: {
        template: "templates/generic/tab-navigation.hbs",
      },
      stats: {
        template: `modules/${MODULE_ID}/templates/sheets/follower-sheet/stats.hbs`,
        templates: [
          `${DS_BASE}/shared/partials/stats/characteristics.hbs`,
        ],
        scrollable: [""],
      },
      features: {
        template: `${DS_BASE}/retainer-sheet/features.hbs`,
        templates: [
          `${DS_BASE}/shared/partials/features/features.hbs`,
        ],
        scrollable: [""],
      },
      effects: {
        template: `${DS_BASE}/shared/effects.hbs`,
        scrollable: [""],
      },
      biography: {
        template: `modules/${MODULE_ID}/templates/sheets/follower-sheet/biography.hbs`,
        templates: [
          `${DS_BASE}/shared/partials/biography/biography.hbs`,
          `${DS_BASE}/shared/partials/biography/director-notes.hbs`,
        ],
        scrollable: [""],
      },
    };

    /* -------------------------------------------------- */

    /**
     * Remove the Abilities tab – followers use Features for homebrew
     * but don't need the abilities list.
     * @inheritdoc
     */
    _prepareTabs(group) {
      const tabs = super._prepareTabs(group);
      if (group === "primary") delete tabs.abilities;
      return tabs;
    }

    /* -------------------------------------------------- */

    /** @inheritdoc */
    async _preparePartContext(partId, context, options) {
      await super._preparePartContext(partId, context, options);

      if (partId === "stats") {
        // Characteristics (editable outside play mode)
        context.characteristics = this._getCharacteristics(true);
        // Skills (from follower's own skills field)
        context.skills = this._getFollowerSkills();
        // Languages (moved here from biography; base method reads biography.languages)
        context.languages = this._getLanguages();
        context.unfilledLanguage = !!this.actor.system._unfilledTraits?.language?.size;
      }

      return context;
    }

    /* -------------------------------------------------- */

    /**
     * Builds the skills context object for the stats template.
     * Mirrors DrawSteelHeroSheet._getSkills() but reads from the
     * follower's own system.skills field.
     * @returns {{ list: string, options: object[] }}
     */
    _getFollowerSkills() {
      const skills = this.actor.system.skills;
      if (!skills) return { list: "", options: [] };

      // Start with the system's standard optgroups (fresh copy each call via getter)
      const options = ds.CONFIG.skills.optgroups;

      // Append any custom skill values not in the official list
      for (const skill of skills.value) {
        if (!(skill in ds.CONFIG.skills.list)) options.push({ value: skill });
      }

      return {
        list: skills.list ?? "",
        options,
      };
    }
  };

  return _FollowerSheet;
}
