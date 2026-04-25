/**
 * Draw Steel – Hideout
 * Create Follower dialog: two-step UI to create Artisan or Sage followers.
 * Step 1: choose type (Artisan / Sage)
 * Step 2: configure name, skills, characteristics, languages, mentor
 */

import { MODULE_ID, FOLLOWER_TYPE, HIDEOUT_FOLDER } from "../config.mjs";
import { HideoutApp } from "../hideout/hideout-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const FOLLOWER_PRESETS = {
  artisan: {
    key: "artisan",
    nameKey: "DSHIDEOUT.CreateFollower.TypeArtisan",
    descKey: "DSHIDEOUT.CreateFollower.TypeArtisanDesc",
    skillGroup: "crafting",
    skillCount: 4,
    /** Which characteristics can be +1? Player picks one. */
    charChoices: ["might", "agility"],
    charDefault: { might: 0, agility: 0, reason: 1, intuition: 0, presence: 0 },
    languages: { auto: ["caelian"], extraCount: 2 },
  },
  sage: {
    key: "sage",
    nameKey: "DSHIDEOUT.CreateFollower.TypeSage",
    descKey: "DSHIDEOUT.CreateFollower.TypeSageDesc",
    skillGroup: "lore",
    skillCount: 4,
    charChoices: null,  // Fixed: reason +1, intuition +1
    charDefault: { might: 0, agility: 0, reason: 1, intuition: 1, presence: 0 },
    languages: { auto: ["caelian"], extraCount: 2 },
  },
};

export class CreateFollowerDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dshideout-create-follower",
    classes: ["draw-steel-hideout", "dshideout-dialog"],
    position: { width: 520, height: 600 },
    window: {
      title: "DSHIDEOUT.CreateFollower.Title",
      resizable: false,
      icon: "fa-solid fa-user-plus",
    },
    actions: {
      selectType: CreateFollowerDialog.#onSelectType,
      backToStep1: CreateFollowerDialog.#onBackToStep1,
      createFollower: CreateFollowerDialog.#onCreateFollower,
    },
  };

  static PARTS = {
    dialog: {
      template: `modules/${MODULE_ID}/templates/dialogs/create-follower.hbs`,
    },
  };

  /** @type {null | "artisan" | "sage"} */
  #selectedType = null;

  /** Selected skills (Set of skill keys). */
  #selectedSkills = new Set();

  /** Selected characteristic for +1 bonus (Artisan only). */
  #selectedChar = null;

  /** Selected extra languages (array of language keys). */
  #selectedLanguages = [];

  #step = 1;
  #name = "";
  #mentorId = null;

  /** @inheritdoc */
  async _prepareContext(options) {
    const preset = this.#selectedType ? FOLLOWER_PRESETS[this.#selectedType] : null;
    const skills = this.#getSkillsForPreset(preset);

    // Build party heroes for mentor selection
    const partyHeroes = (game.actors.party?.system.members.values() ?? []);
    const mentorOptions = [...partyHeroes]
      .filter(m => m.actor?.type === "hero")
      .map(m => ({ value: m.actor.id, label: m.actor.name }));

    // Language list from ds.CONFIG
    const allLanguages = Object.entries(ds.CONFIG.languages ?? {})
      .map(([value, lang]) => ({ value, label: lang.label ?? value }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const autoLanguages = preset?.languages.auto ?? [];
    const extraLanguageOptions = allLanguages.filter(l => !autoLanguages.includes(l.value));

    // Build extra language slot objects for the template
    const extraLanguageSlots = [];
    for (let i = 0; i < (preset?.languages.extraCount ?? 0); i++) {
      extraLanguageSlots.push({
        slot: i,
        options: extraLanguageOptions.map(l => ({
          ...l,
          isSelected: this.#selectedLanguages[i] === l.value,
        })),
      });
    }

    return {
      step: this.#step,
      presets: Object.values(FOLLOWER_PRESETS).map(p => ({
        key: p.key,
        label: game.i18n.localize(p.nameKey),
        description: game.i18n.localize(p.descKey),
      })),
      selectedType: this.#selectedType,
      preset,
      name: this.#name,
      skills,
      selectedSkills: this.#selectedSkills,
      skillCount: preset?.skillCount ?? 0,
      charChoices: preset?.charChoices,
      selectedChar: this.#selectedChar,
      autoLanguages: autoLanguages.map(key => {
        const lang = ds.CONFIG.languages?.[key];
        return { key, label: lang?.label ?? key };
      }),
      extraLanguageSlots,
      selectedLanguages: this.#selectedLanguages,
      extraLanguageCount: preset?.languages.extraCount ?? 0,
      mentorOptions,
      selectedMentorId: this.#mentorId,
      canCreate: this.#canCreate(preset),
    };
  }

  #getSkillsForPreset(preset) {
    if (!preset) return [];
    const group = preset.skillGroup;
    const skillList = ds.CONFIG.skills.list ?? {};

    // ds.CONFIG.skills.list is a keyed object: { [skillKey]: { label, group } }
    return Object.entries(skillList)
      .filter(([key, s]) => s.group === group)
      .map(([key, s]) => ({
        key,
        label: s.label ?? key,
        selected: this.#selectedSkills.has(key),
      }));
  }

  #canCreate(preset) {
    if (!preset) return false;
    if (!this.#name.trim()) return false;
    if (this.#selectedSkills.size !== preset.skillCount) return false;
    if (preset.charChoices && !this.#selectedChar) return false;
    if (this.#selectedLanguages.length < preset.languages.extraCount) return false;
    return true;
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const el = this.element;

    // Name input
    const nameInput = el.querySelector("[name='followerName']");
    if (nameInput) {
      nameInput.value = this.#name;
      nameInput.addEventListener("input", (e) => {
        this.#name = e.target.value;
        this._updateCreateButton();
      });
    }

    // Skill checkboxes
    for (const cb of el.querySelectorAll("[data-skill-toggle]")) {
      cb.addEventListener("change", (e) => {
        const key = e.target.dataset.skillToggle;
        const preset = FOLLOWER_PRESETS[this.#selectedType];
        if (e.target.checked) {
          if (this.#selectedSkills.size >= (preset?.skillCount ?? 0)) {
            e.target.checked = false;
            ui.notifications.warn(game.i18n.format("DSHIDEOUT.CreateFollower.TooManySkills", {
              count: preset?.skillCount ?? 0,
            }));
            return;
          }
          this.#selectedSkills.add(key);
        } else {
          this.#selectedSkills.delete(key);
        }
        this._updateCreateButton();
      });
    }

    // Characteristic radio (Artisan only)
    for (const radio of el.querySelectorAll("[data-char-choice]")) {
      radio.addEventListener("change", (e) => {
        if (e.target.checked) {
          this.#selectedChar = e.target.dataset.charChoice;
          this._updateCreateButton();
        }
      });
    }

    // Language selects
    for (const sel of el.querySelectorAll("[data-language-slot]")) {
      const slot = parseInt(sel.dataset.languageSlot);
      sel.addEventListener("change", (e) => {
        this.#selectedLanguages[slot] = e.target.value;
        this._updateCreateButton();
      });
    }

    // Mentor select
    const mentorSel = el.querySelector("[name='mentorId']");
    if (mentorSel) {
      mentorSel.addEventListener("change", (e) => {
        this.#mentorId = e.target.value || null;
      });
    }
  }

  _updateCreateButton() {
    const btn = this.element?.querySelector("[data-action='createFollower']");
    if (!btn) return;
    const preset = this.#selectedType ? FOLLOWER_PRESETS[this.#selectedType] : null;
    btn.disabled = !this.#canCreate(preset);
  }

  /* -------------------------------------------------- */
  /*  Static action handlers                            */
  /* -------------------------------------------------- */

  static #onSelectType(event, target) {
    this.#selectedType = target.dataset.type;
    this.#step = 2;
    this.#selectedSkills.clear();
    this.#selectedChar = null;
    this.#selectedLanguages = [];
    // Default char for artisan
    if (this.#selectedType === "artisan") {
      this.#selectedChar = FOLLOWER_PRESETS.artisan.charChoices[0];
    }
    this.render();
  }

  static #onBackToStep1(event, target) {
    this.#step = 1;
    this.#selectedType = null;
    this.#selectedSkills.clear();
    this.#selectedChar = null;
    this.#selectedLanguages = [];
    this.render();
  }

  static async #onCreateFollower(event, target) {
    const preset = FOLLOWER_PRESETS[this.#selectedType];
    if (!preset) return;

    const name = this.#name.trim();
    if (!name) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.CreateFollower.NoName"));
      return;
    }

    // Get or create the Hideout folder
    let folder = game.folders.find(f => f.type === "Actor" && f.name === HIDEOUT_FOLDER);
    if (!folder) {
      folder = await Folder.create({ name: HIDEOUT_FOLDER, type: "Actor" });
    }

    // Build characteristics
    const chars = { ...preset.charDefault };
    if (preset.charChoices && this.#selectedChar) {
      chars[this.#selectedChar] = 1;
    }

    // Build languages
    const languages = [...preset.languages.auto, ...this.#selectedLanguages.filter(Boolean)];

    // Build actor data
    const actorData = {
      name,
      type: FOLLOWER_TYPE,
      folder: folder.id,
      img: "icons/svg/mystery-man.svg",
      system: {
        // Stamina max must be > 0 or the system marks the actor as dead
        stamina: { max: 1 },
        // Characteristics
        characteristics: {
          might: { value: chars.might ?? 0 },
          agility: { value: chars.agility ?? 0 },
          reason: { value: chars.reason ?? 0 },
          intuition: { value: chars.intuition ?? 0 },
          presence: { value: chars.presence ?? 0 },
        },
        // Skills
        skills: {
          value: [...this.#selectedSkills],
        },
        // Retainer mentor field
        ...(this.#mentorId ? { retainer: { mentor: this.#mentorId } } : {}),
        // Biography
        biography: {
          value: "",
          languages,
        },
      },
    };

    const actor = await Actor.create(actorData);
    if (!actor) {
      ui.notifications.error(game.i18n.localize("DSHIDEOUT.CreateFollower.Error"));
      return;
    }

    ui.notifications.info(game.i18n.format("DSHIDEOUT.CreateFollower.Created", { name }));
    await this.close();

    // Refresh Hideout app roster
    HideoutApp._instance?.render({ parts: ["roster"] });
  }
}
