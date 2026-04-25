/**
 * Draw Steel – Hideout
 * Follower actor data model.
 *
 * Followers are similar to Retainers but have skills (like Heroes) instead of
 * combat abilities. This model extends the system's RetainerModel and adds
 * a `skills` field matching the HeroModel schema.
 *
 * The actual class is defined lazily inside `initFollowerModel()` so that we
 * can extend the system's live RetainerModel class once Foundry has set up the
 * system (which happens before module `init` fires).
 */

import { MODULE_ID, FOLLOWER_TYPE } from "../config.mjs";

/** @type {typeof foundry.abstract.TypeDataModel | null} */
let _FollowerModel = null;

/**
 * Returns the FollowerModel class, building it on first call.
 * Must be called during or after the system's `init` hook.
 * @returns {typeof foundry.abstract.TypeDataModel}
 */
export function getFollowerModelClass() {
  if (_FollowerModel) return _FollowerModel;

  // Access the system's RetainerModel via the CONFIG, which is populated during system init.
  const RetainerModel = CONFIG.Actor.dataModels?.retainer;
  if (!RetainerModel) {
    throw new Error(`draw-steel-hideout | Could not find RetainerModel. Is draw-steel system loaded?`);
  }

  const { SetField, StringField, SchemaField } = foundry.data.fields;

  _FollowerModel = class FollowerModel extends RetainerModel {
    /** @inheritdoc */
    static get metadata() {
      return {
        ...super.metadata,
        // The type key must match what Foundry uses in CONFIG.Actor.dataModels
        type: FOLLOWER_TYPE,
      };
    }

    /* ---------------------------------------------- */

    /** @inheritdoc */
    static LOCALIZATION_PREFIXES = [
      ...super.LOCALIZATION_PREFIXES,
      "DRAW_STEEL.Actor.retainer", // reuse retainer localization
    ];

    /* ---------------------------------------------- */

    /** @inheritdoc */
    static defineSchema() {
      const schema = super.defineSchema();

      // Add hero-style skills field
      schema.skills = new SchemaField({
        value: new SetField(new StringField({ required: true, blank: false })),
      });

      return schema;
    }

    /* ---------------------------------------------- */

    /** @inheritdoc */
    prepareDerivedData() {
      super.prepareDerivedData();

      // Build a formatted skill label list (same pattern as HeroModel)
      if (this.skills) {
        const list = Array.from(this.skills.value ?? []).reduce((skills, skill) => {
          const label = ds.CONFIG.skills.list[skill]?.label;
          if (label) skills.push(label);
          return skills;
        }, []).sort((a, b) => a.localeCompare(b, game.i18n.lang));

        const formatter = game.i18n.getListFormatter();
        this.skills.list = formatter.format(list);
      }
    }
  };

  return _FollowerModel;
}

/**
 * Register the Follower actor data model. Call during `init`.
 */
export function registerFollowerModel() {
  const FollowerModel = getFollowerModelClass();
  CONFIG.Actor.dataModels[FOLLOWER_TYPE] = FollowerModel;
}
