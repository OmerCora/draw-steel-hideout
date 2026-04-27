/**
 * Draw Steel – Hideout
 * Module entry point: register settings, data models, hooks, sidebar button, templates.
 */

import { MODULE_ID, SYSTEM_ID, FOLLOWER_TYPE, SETTINGS } from "./config.mjs";
import { registerFollowerModel } from "./data-models/follower-model.mjs";
import { getFollowerSheetClass } from "./sheets/follower-sheet.mjs";
import { HideoutApp } from "./hideout/hideout-app.mjs";
import { getStash, removeStashItem, changeStashQuantity } from "./hideout/stash-manager.mjs";
import { registerSocket, HIDEOUT_SETTING_KEYS } from "./socket.mjs";
import { ProgressProjectsDialog } from "./dialogs/progress-projects.mjs";
/* -------------------------------------------------- */
/*  Init                                              */
/* -------------------------------------------------- */

Hooks.once("init", () => {
  // Register world settings
  game.settings.register(MODULE_ID, SETTINGS.PROJECTS, {
    scope: "world",
    config: false,
    type: String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, SETTINGS.STASH, {
    scope: "world",
    config: false,
    type: String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, SETTINGS.FOLLOWERS, {
    scope: "world",
    config: false,
    type: String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, SETTINGS.ARCHIVES, {
    scope: "world",
    config: false,
    type: String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, SETTINGS.ITEM_FOLLOWERS, {
    scope: "world",
    config: false,
    type: String,
    default: "[]",
  });

  game.settings.register(MODULE_ID, SETTINGS.MINIMUM_ROLE, {
    name: "DSHIDEOUT.Settings.MinimumRole.Name",
    hint: "DSHIDEOUT.Settings.MinimumRole.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: CONST.USER_ROLES.PLAYER,
    choices: {
      [CONST.USER_ROLES.PLAYER]: "USER.RolePlayer",
      [CONST.USER_ROLES.TRUSTED]: "USER.RoleTrusted",
      [CONST.USER_ROLES.ASSISTANT]: "USER.RoleAssistant",
      [CONST.USER_ROLES.GAMEMASTER]: "USER.RoleGamemaster",
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.ALLOW_INDIVIDUAL_ROLLS, {
    name: "DSHIDEOUT.Settings.AllowIndividualRolls.Name",
    hint: "DSHIDEOUT.Settings.AllowIndividualRolls.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      if (HideoutApp._instance?.rendered) {
        HideoutApp._instance.render({ parts: ["main"] });
      }
    },
  });

  // Register Follower data model
  registerFollowerModel();

  // Preload Handlebars templates
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/parts/hideout-roster.hbs`,
    `modules/${MODULE_ID}/templates/parts/hideout-main.hbs`,
    `modules/${MODULE_ID}/templates/parts/hideout-actionbar.hbs`,
    `modules/${MODULE_ID}/templates/browsers/project-browser.hbs`,
    `modules/${MODULE_ID}/templates/browsers/treasure-browser.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/create-follower.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/create-follower-footer.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/progress-projects.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/individual-project-roll.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/project-settings.hbs`,
    `modules/${MODULE_ID}/templates/dialogs/project-settings-footer.hbs`,
    // Follower actor sheet templates
    `modules/${MODULE_ID}/templates/sheets/follower-sheet/stats.hbs`,
    `modules/${MODULE_ID}/templates/sheets/follower-sheet/biography.hbs`,
  ]);

  // Register Handlebars helpers
  _registerHandlebarsHelpers();

  console.log(`draw-steel-hideout | Initialized.`);
});

/* -------------------------------------------------- */
/*  Ready                                             */
/* -------------------------------------------------- */

Hooks.once("ready", () => {
  // Expose public API
  game.modules.get(MODULE_ID).api = { HideoutApp };

  // Register socket relay so non-GM clients can write world settings via the GM.
  registerSocket();

  // Build and register the custom FollowerSheet.
  // Must be done in `ready` so DrawSteelRetainerSheet is already in the registry.
  try {
    const FollowerSheet = getFollowerSheetClass();
    Actors.registerSheet(MODULE_ID, FollowerSheet, {
      types: [FOLLOWER_TYPE],
      makeDefault: true,
      label: game.i18n.localize("DSHIDEOUT.FollowerSheet.Label"),
    });
    console.log("draw-steel-hideout | Registered FollowerSheet for", FOLLOWER_TYPE);
  } catch (err) {
    console.error("draw-steel-hideout | Failed to register FollowerSheet:", err);
  }

  // Register capture-phase drop listener on the canvas for stash→hero token transfers
  _registerCanvasStashDropHandler();
});

/* -------------------------------------------------- */
/*  Auto-configure new Follower actors                */
/* -------------------------------------------------- */

Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (actor.type !== FOLLOWER_TYPE) return;
  // Stamina max = 0 causes the system to tag the actor as dead.
  // Set it to 1 so freshly-created followers are alive by default.
  if (!data.system?.stamina?.max) {
    actor.updateSource({ "system.stamina.max": 1 });
  }
});

/* -------------------------------------------------- */
/*  Project Event "Proceed with Project Rolls" button */
/* -------------------------------------------------- */

/**
 * Wire the chat-message Proceed button so the GM can resume a deferred
 * project roll batch after reading the "Before the roll" event(s).
 * Supports both the legacy `renderChatMessage` (jQuery html) and the
 * v13+ `renderChatMessageHTML` (HTMLElement) hooks.
 */
function _wireProceedButton(root) {
  if (!root) return;
  const el = (root instanceof HTMLElement) ? root
    : (root.jquery ? root[0] : (root[0] ?? root));
  if (!el?.querySelectorAll) return;
  for (const btn of el.querySelectorAll('[data-action="dshideoutProceedProjectRolls"]')) {
    if (btn.dataset.dshideoutWired) continue;
    btn.dataset.dshideoutWired = "1";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const runId = btn.dataset.runId;
      if (!runId) return;
      const ok = ProgressProjectsDialog.resolvePendingProceed(runId);
      if (ok) {
        btn.disabled = true;
        btn.classList.add("dshideout-event-proceed-btn-used");
      } else {
        ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Events.ProceedExpired"));
      }
    });
  }
}
Hooks.on("renderChatMessage",     (app, html) => _wireProceedButton(html));
Hooks.on("renderChatMessageHTML", (app, html) => _wireProceedButton(html));

/* -------------------------------------------------- */
/*  Sidebar / Scene Controls Button                   */
/* -------------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  // Add under the "token" group (available to all users)
  const tokenGroup = controls.tokens ?? controls.token;
  if (!tokenGroup) return;

  tokenGroup.tools["draw-steel-hideout"] = {
    name: "draw-steel-hideout",
    title: "DSHIDEOUT.SidebarButton",
    icon: "fa-solid fa-house-flag",
    button: true,
    onChange: () => HideoutApp.toggle(),
  };
});

/* -------------------------------------------------- */
/*  Live-update HideoutApp on actor changes           */
/* -------------------------------------------------- */

function _reRosterIfOpen(actor) {
  if (!HideoutApp._instance?.rendered) return;
  const isHero = actor.type === "hero";
  const isFollower = actor.type === FOLLOWER_TYPE;
  if (isHero || isFollower) {
    HideoutApp._instance.render({ parts: ["roster"] });
  }
}

Hooks.on("createActor", (actor) => _reRosterIfOpen(actor));
Hooks.on("deleteActor", (actor) => _reRosterIfOpen(actor));
Hooks.on("updateActor", (actor) => _reRosterIfOpen(actor));

/* -------------------------------------------------- */
/*  Re-render on remote setting changes               */
/* -------------------------------------------------- */

// Foundry fires `updateSetting` on EVERY client whenever a setting is
// changed (including world settings written by another client). We listen
// for our own settings and fan out to `dshideout:refresh` so all open
// HideoutApp windows re-render with the latest data — GM, originating
// player, and any observers all stay in sync without custom acks.
Hooks.on("updateSetting", (setting) => {
  // setting.key is namespaced as "<moduleId>.<settingKey>"
  const fullKey = setting?.key ?? "";
  const dotIdx = fullKey.indexOf(".");
  if (dotIdx < 0) return;
  const namespace = fullKey.slice(0, dotIdx);
  const settingKey = fullKey.slice(dotIdx + 1);
  if (namespace !== MODULE_ID) return;
  if (!HIDEOUT_SETTING_KEYS.has(settingKey)) return;
  Hooks.callAll("dshideout:refresh");
});

Hooks.on("dshideout:refresh", () => {
  if (!HideoutApp._instance?.rendered) return;
  // Debounce: GM-side write fires both `updateSetting` (broadcast by Foundry)
  // and our backup `refreshHideout` socket within a few ms of each other.
  // Two renders in close succession cause the progress-bar animation to be
  // lost (the first render's rAF chain races against the second render which
  // replaces the DOM with no-animate markup). Coalesce into a single render.
  if (HideoutApp._refreshTimer) return;
  HideoutApp._refreshTimer = setTimeout(() => {
    HideoutApp._refreshTimer = null;
    if (HideoutApp._instance?.rendered) {
      HideoutApp._instance.render({ parts: ["roster", "main"] });
    }
  }, 50);
});

/* -------------------------------------------------- */
/*  Stash → Hero transfer (actor sheet & canvas)      */
/* -------------------------------------------------- */

/**
 * Transfer a stash item to a hero actor.
 * Creates the item on the actor (from compendium UUID or stored data fallback),
 * then removes/decreases it from the party stash and refreshes the Hideout UI.
 * Only hero actors are allowed as targets.
 *
 * @param {Actor} actor
 * @param {string} stashId  The stash item's module ID (from _dshideoutStashId in drag data)
 */
async function _handleStashDropOnActor(actor, stashId) {
  if (actor.type !== "hero") {
    ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Stash.HeroOnly"));
    return;
  }

  const stash = getStash();
  const stashItem = stash.find(i => i.id === stashId);
  if (!stashItem) return;

  // Resolve source item (prefer UUID; fallback to constructing from stored data)
  const sourceItem = await fromUuid(stashItem.uuid).catch(() => null);

  let itemData;
  if (sourceItem) {
    itemData = sourceItem.toObject();
    delete itemData._id;
  } else {
    // Source item no longer accessible (e.g. deleted actor-embedded item) — build from stored data
    itemData = {
      name: stashItem.name,
      type: "treasure",
      img: stashItem.img ?? "icons/svg/item-bag.svg",
      system: {
        category: stashItem.category ?? "",
        echelon: stashItem.echelon ?? 0,
        description: { value: stashItem.description ?? "" },
      },
    };
  }

  const maxQty = stashItem.quantity ?? 1;
  let transferQty = 1;
  if (maxQty > 1) {
    let chosen = null;
    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("DSHIDEOUT.Transfer.PromptTitle", { item: stashItem.name }) },
      content: `
        <form class="standard-form">
          <div class="form-group">
            <label>${game.i18n.format("DSHIDEOUT.Transfer.HowMany", { item: stashItem.name, target: actor.name, max: maxQty })}</label>
            <input type="number" name="quantity" value="1" min="1" max="${maxQty}" style="width:100%" autofocus />
          </div>
        </form>
      `,
      buttons: [
        {
          action: "ok",
          label: game.i18n.localize("DSHIDEOUT.Transfer.Confirm"),
          default: true,
          callback: (event, button, dialog) => {
            const val = parseInt(dialog.element.querySelector("[name='quantity']").value);
            chosen = Math.max(1, Math.min(maxQty, isNaN(val) ? 1 : val));
          },
        },
        { action: "cancel", label: game.i18n.localize("Cancel") },
      ],
    });
    if (!chosen) return; // cancelled
    transferQty = chosen;
  }

  // Merge quantity if actor already owns the same item (consumables)
  const existingItem = actor.items.find(i => {
    const srcId = i.flags?.core?.sourceId ?? null;
    if (srcId === stashItem.uuid || i.uuid === stashItem.uuid) return true;
    // Fallback: match by name + type for items given outside of this module
    return i.name === stashItem.name && i.type === (sourceItem?.type ?? "treasure");
  });

  if (existingItem && "quantity" in (existingItem.system ?? {})) {
    await existingItem.update({ "system.quantity": (existingItem.system.quantity ?? 1) + transferQty });
  } else {
    if ("quantity" in (itemData.system ?? {})) itemData.system.quantity = transferQty;
    // Explicitly set sourceId so future drops can find and merge this item.
    foundry.utils.setProperty(itemData, "flags.core.sourceId", stashItem.uuid);
    await actor.createEmbeddedDocuments("Item", [itemData]);
  }

  // Decrease stash
  if (transferQty >= maxQty) {
    await removeStashItem(stashItem.id);
  } else {
    await changeStashQuantity(stashItem.id, -transferQty);
  }

  ui.notifications.info(game.i18n.format("DSHIDEOUT.Transfer.DoneToHero", {
    qty: transferQty, item: stashItem.name, hero: actor.name,
  }));
  await ChatMessage.create({
    content: `<p><strong>${game.i18n.localize("DSHIDEOUT.Chat.ItemTransferred")}</strong> — ${game.i18n.format("DSHIDEOUT.Chat.ItemTransferredMsg", { qty: transferQty, item: stashItem.name, hero: actor.name })}</p>`,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
  HideoutApp._instance?.render({ parts: ["main"] });
}

/**
 * Intercept drops on actor sheets that carry a stash-item marker.
 * Returns false to block Foundry's default item-drop processing.
 */
Hooks.on("dropActorSheetData", (actor, sheet, data) => {
  if (!data._dshideoutStashId) return true;
  _handleStashDropOnActor(actor, data._dshideoutStashId); // fire and forget
  return false;
});

/**
 * Intercept drops on canvas tokens that carry a stash-item marker.
 * Registered once in `ready` using a capture listener so we get the event
 * coordinates before Foundry's own canvas drop handler runs.
 */
function _registerCanvasStashDropHandler() {
  const canvasEl = document.getElementById("board");
  if (!canvasEl) return;

  canvasEl.addEventListener("drop", (e) => {
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
    catch { return; }
    if (!data._dshideoutStashId) return;

    // We're handling this — stop Foundry's canvas handler from also processing it
    e.stopPropagation();
    e.preventDefault();

    // Convert client coordinates to canvas/scene coordinates.
    // Use the board element (canvasEl) which we already hold from the closure.
    const rect = canvasEl.getBoundingClientRect();
    const t = canvas.stage.worldTransform;
    const sx = (e.clientX - rect.left - t.tx) / t.a;
    const sy = (e.clientY - rect.top - t.ty) / t.d;

    // Find the topmost token at this position
    const token = canvas.tokens.placeables
      .slice()
      .reverse()
      .find(tok => tok.bounds?.contains(sx, sy));

    if (!token?.actor) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Stash.DropOnHeroToken"));
      return;
    }

    _handleStashDropOnActor(token.actor, data._dshideoutStashId); // fire and forget
  }, true /* capture — fires before Foundry's own listener */);
}

/* -------------------------------------------------- */
/*  Handlebars helpers                                */
/* -------------------------------------------------- */

function _registerHandlebarsHelpers() {
  Handlebars.registerHelper("dshideout-eq", function(a, b, options) {
    if (options?.fn) {
      return a === b ? options.fn(this) : options.inverse(this);
    }
    return a === b;
  });
  Handlebars.registerHelper("dshideout-gt", (a, b) => a > b);
  Handlebars.registerHelper("dshideout-lt", (a, b) => a < b);
  Handlebars.registerHelper("dshideout-add", (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper("dshideout-math", (a, op, b) => {
    a = Number(a); b = Number(b);
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    if (op === "/") return b !== 0 ? a / b : 0;
    return a;
  });
  Handlebars.registerHelper("dshideout-concat", (...args) => args.slice(0, -1).join(""));
  Handlebars.registerHelper("dshideout-capitalize", (str) => {
    if (typeof str !== "string" || !str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  });
  Handlebars.registerHelper("dshideout-clamp", (val, min, max) => Math.min(Math.max(val, min), max));
  Handlebars.registerHelper("dshideout-has", (set, value) => {
    if (set instanceof Set) return set.has(value);
    if (Array.isArray(set)) return set.includes(value);
    return false;
  });
}
