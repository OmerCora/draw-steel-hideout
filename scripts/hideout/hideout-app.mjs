/**
 * Draw Steel – Hideout
 * Main application window: Roster + Projects/Stash tabs + Action bar.
 */

import { MODULE_ID, FOLLOWER_TYPE, HIDEOUT_FOLDER, SETTINGS } from "../config.mjs";
import {
  getProjects, addProject, removeProject, updateProject, assignContributor,
  removeContributor, getContributingProject, markYieldObtained,
} from "./project-manager.mjs";
import {
  getStash, addStashItem, removeStashItem, changeStashQuantity,
} from "./stash-manager.mjs";
import {
  getArchives, addArchiveEntry, removeArchiveEntry,
} from "./archives-manager.mjs";
import { ProjectBrowserApp } from "../browsers/project-browser.mjs";
import { TreasureBrowserApp } from "../browsers/treasure-browser.mjs";
import { CreateFollowerDialog } from "../dialogs/create-follower.mjs";
import { ProgressProjectsDialog } from "../dialogs/progress-projects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HideoutApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /* -------------------------------------------------- */
  /*  Static                                            */
  /* -------------------------------------------------- */

  static _instance = null;

  static toggle() {
    if (this._instance?.rendered) {
      this._instance.close();
    } else {
      this._instance ??= new this();
      this._instance.render({ force: true });
    }
  }

  static show() {
    if (!this._instance) this._instance = new this();
    this._instance.render({ force: true });
  }

  /* -------------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "draw-steel-hideout",
    classes: ["draw-steel-hideout"],
    position: { width: 1100, height: 800 },
    window: {
      title: "DSHIDEOUT.WindowTitle",
      resizable: true,
      icon: "fa-solid fa-house-flag",
    },
    actions: {
      // Tab switching
      switchTab: HideoutApp.#onSwitchTab,
      // Projects
      removeProject: HideoutApp.#onRemoveProject,
      toggleDescription: HideoutApp.#onToggleDescription,
      removeContributor: HideoutApp.#onRemoveContributor,
      obtainYield: HideoutApp.#onObtainYield,
      restartProject: HideoutApp.#onRestartProject,
      // Stash
      increaseQty: HideoutApp.#onIncreaseQty,
      decreaseQty: HideoutApp.#onDecreaseQty,
      removeStashItem: HideoutApp.#onRemoveStashItem,
      // Archives
      beginCraftingFromArchive: HideoutApp.#onBeginCraftingFromArchive,
      removeArchiveEntry: HideoutApp.#onRemoveArchiveEntry,
      // Action bar
      createFollower: HideoutApp.#onCreateFollower,
      openProjectBrowser: HideoutApp.#onOpenProjectBrowser,
      openTreasureBrowser: HideoutApp.#onOpenTreasureBrowser,
      progressProjects: HideoutApp.#onProgressProjects,
      // Roster
      removeFromRoster: HideoutApp.#onRemoveFromRoster,
      // Projects
      openProjectSheet: HideoutApp.#onOpenProjectSheet,
    },
  };

  static PARTS = {
    roster: {
      template: `modules/${MODULE_ID}/templates/parts/hideout-roster.hbs`,
      scrollable: [".dshideout-roster-list"],
    },
    main: {
      template: `modules/${MODULE_ID}/templates/parts/hideout-main.hbs`,
      scrollable: [".dshideout-projects-list", ".dshideout-stash-list", ".dshideout-archives-list"],
    },
    actionBar: {
      template: `modules/${MODULE_ID}/templates/parts/hideout-actionbar.hbs`,
    },
  };

  /* -------------------------------------------------- */
  /*  Instance state                                    */
  /* -------------------------------------------------- */

  /** @type {"projects"|"stash"|"archives"} */
  #activeTab = "projects";

  /** @type {"all"|"ongoing"|"completed"} */
  #projectFilter = "all";

  /** @type {"progress"|"name"|"contributors"} */
  #projectSort = "name";

  /** Expanded description IDs (project ids or stash item ids). */
  #expandedDescriptions = new Set();

  /** Previous progress percentages — used to decide when to animate the bar. */
  #prevProgressPcts = new Map();

  /** AbortController for drop event listeners; recreated each render to avoid stacking. */
  #dropHandlerAbort = null;

  /** True when the active stash drag was received by our own drop zone (not an external actor sheet). */
  #stashDragHandledInternally = false;

  /* -------------------------------------------------- */
  /*  Context preparation                               */
  /* -------------------------------------------------- */

  async _prepareContext(options) {
    const isGM = game.user.isGM;

    // ── Roster ───────────────────────────────────────
    const heroes = this.#buildRosterHeroes();
    const followers = this.#buildRosterFollowers();
    const availableFollowers = this.#buildAvailableFollowers();

    // ── Projects ─────────────────────────────────────
    const allProjects = getProjects();
    const projects = this.#filterAndSortProjects(allProjects);

    // ── Stash ────────────────────────────────────────
    const stashItems = getStash();
    const stashGroups = this.#groupStashItems(stashItems);

    // ── Archives ─────────────────────────────────────
    const archiveItems = getArchives();
    const archiveGroups = await this.#buildArchiveGroups(archiveItems);

    return {
      isGM,
      activeTab: this.#activeTab,
      heroes,
      followers,
      availableFollowers,
      projects: await this.#enrichProjects(projects),
      stashGroups: await this.#enrichStashGroups(stashGroups),
      archiveGroups,
      projectFilter: this.#projectFilter,
      projectSort: this.#projectSort,
      expandedDescriptions: this.#expandedDescriptions,
      hasProjects: allProjects.length > 0,
      hasActiveProjects: allProjects.some(p => !p.completed),
    };
  }

  /** @inheritdoc */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    return context;
  }

  /* -------------------------------------------------- */
  /*  Data helpers                                      */
  /* -------------------------------------------------- */

  #buildRosterHeroes() {
    const party = game.actors.party;
    if (!party) return [];

    return [...party.system.members.values()]
      .filter(m => m.actor?.type === "hero")
      .map(m => {
        const actor = m.actor;
        const contributingProject = getContributingProject(actor.id);
        return {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          uuid: actor.uuid,
          isOwner: actor.isOwner,
          isGMOrOwner: game.user.isGM || actor.isOwner,
          contributingProjectId: contributingProject?.id ?? null,
          contributingProjectName: contributingProject?.name ?? null,
        };
      });
  }

  #buildRosterFollowers() {
    const rosterIds = new Set(HideoutApp.#getRosterFollowerIds());
    return game.actors
      .filter(a => a.type === FOLLOWER_TYPE && rosterIds.has(a.id))
      .map(a => {
        const mentor = a.system.retainer?.mentor ?? null;
        const mentorName = mentor ? (game.actors.get(mentor)?.name ?? null) : null;
        const contributingProject = getContributingProject(a.id);

        const isGM = game.user.isGM;
        const isMentor = mentor && game.user.character?.id === mentor;
        const isUnassigned = !mentor;

        const reason = a.system.characteristics?.reason?.value ?? 0;
        const reasonStr = reason >= 0 ? `+${reason}` : `${reason}`;
        const skillsList = a.system.skills?.list ?? "";

        const tooltipParts = [`Reason: ${reasonStr}`];
        if (skillsList) tooltipParts.push(`Skills: ${skillsList}`);
        if (contributingProject) tooltipParts.push(`Contributing to: ${contributingProject.name}`);
        tooltipParts.push(`Mentor: ${mentorName ?? "none"}`);

        return {
          id: a.id,
          name: a.name,
          img: a.img,
          uuid: a.uuid,
          mentorId: mentor,
          mentorName,
          isDraggable: isGM || isMentor || isUnassigned,
          isGMOrOwner: isGM || a.isOwner,
          contributingProjectId: contributingProject?.id ?? null,
          contributingProjectName: contributingProject?.name ?? null,
          characteristics: {
            might: a.system.characteristics?.might?.value ?? 0,
            agility: a.system.characteristics?.agility?.value ?? 0,
            reason: a.system.characteristics?.reason?.value ?? 0,
            intuition: a.system.characteristics?.intuition?.value ?? 0,
            presence: a.system.characteristics?.presence?.value ?? 0,
          },
          skillsList,
          followerTooltip: tooltipParts.join("<br>"),
        };
      });
  }

  /** World followers not yet in the roster (for the "add" dropdown). */
  #buildAvailableFollowers() {
    const rosterIds = new Set(HideoutApp.#getRosterFollowerIds());
    return game.actors
      .filter(a => a.type === FOLLOWER_TYPE && !rosterIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /* -------------------------------------------------- */
  /*  Roster setting helpers                            */
  /* -------------------------------------------------- */

  static #getRosterFollowerIds() {
    try {
      return JSON.parse(game.settings.get(MODULE_ID, SETTINGS.FOLLOWERS) ?? "[]");
    } catch {
      return [];
    }
  }

  static async #addFollowerToRoster(actorId) {
    const ids = HideoutApp.#getRosterFollowerIds();
    if (!ids.includes(actorId)) {
      ids.push(actorId);
      await game.settings.set(MODULE_ID, SETTINGS.FOLLOWERS, JSON.stringify(ids));
    }
  }

  static async #removeFollowerFromRoster(actorId) {
    const ids = HideoutApp.#getRosterFollowerIds().filter(id => id !== actorId);
    await game.settings.set(MODULE_ID, SETTINGS.FOLLOWERS, JSON.stringify(ids));
  }

  #filterAndSortProjects(projects) {
    let filtered = projects;

    if (this.#projectFilter === "ongoing") filtered = filtered.filter(p => !p.completed);
    else if (this.#projectFilter === "completed") filtered = filtered.filter(p => p.completed);

    filtered = filtered.slice().sort((a, b) => {
      if (this.#projectSort === "name") return a.name.localeCompare(b.name);
      if (this.#projectSort === "contributors") return b.contributorIds.length - a.contributorIds.length;
      // Default: progress % (completed always at the end)
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const aProgress = a.goal ? a.points / a.goal : 0;
      const bProgress = b.goal ? b.points / b.goal : 0;
      return bProgress - aProgress;
    });

    return filtered;
  }

  async #enrichProjects(projects) {
    const allActors = this.#buildRosterHeroes().concat(this.#buildRosterFollowers());
    const actorMap = new Map(allActors.map(a => [a.id, a]));

    return Promise.all(projects.map(async p => {
      const progressPct = p.goal ? Math.min(100, Math.round((p.points / p.goal) * 100)) : 100;

      // Animate only when pct changes. Capture the prev value before updating so we
      // can start the CSS transition from the old position instead of always from 0.
      const prevProgressPct = this.#prevProgressPcts.get(p.id) ?? 0;
      const animateBar = !this.#prevProgressPcts.has(p.id) || prevProgressPct !== progressPct;
      this.#prevProgressPcts.set(p.id, progressPct);
      // startPct: render the bar at its "from" position; JS rAF then moves it to progressPct
      const startPct = animateBar ? prevProgressPct : progressPct;

      const contributors = (p.contributorIds ?? [])
        .map(id => actorMap.get(id))
        .filter(Boolean);

      const projectTypeLabel = ds.CONFIG.projects.types[p.type]?.label ?? p.type;
      const charLabels = (p.rollCharacteristic ?? []).map(c => {
        const chr = ds.CONFIG.characteristics[c];
        return chr ? chr.label : c;
      });

      const isExpanded = this.#expandedDescriptions.has(p.id);
      const description = p.description
        ? await TextEditor.enrichHTML(p.description, { async: true }).catch(() => p.description)
        : p.description;

      return {
        ...p,
        progressPct,
        startPct,
        animateBar,
        progressLabel: p.goal ? `${p.points}/${p.goal}` : `${p.points}`,
        hasGoal: !!(p.goal),
        displayName: p.additionalDetail ? `${p.name} (${p.additionalDetail})` : p.name,
        projectTypeLabel,
        charLabels,
        contributors,
        description,
        isExpanded,
        canObtainYield: p.completed && p.yieldItemUuid && !p.yieldObtained,
        canRestart: p.completed && !p.yieldItemUuid,
        yieldAlreadyObtained: p.yieldObtained,
      };
    }));
  }

  #groupStashItems(items) {
    const groups = {};
    const categoryOrder = ["consumable", "trinket", "leveled", "artifact", ""];

    for (const item of items) {
      const cat = item.category || "";
      if (!groups[cat]) groups[cat] = { key: cat, label: this.#stashGroupLabel(cat), items: [] };
      groups[cat].items.push({
        ...item,
        isExpanded: this.#expandedDescriptions.has(item.id),
        echelonLabel: item.echelon ? `E${item.echelon}` : "",
      });
    }

    return categoryOrder
      .filter(cat => groups[cat])
      .map(cat => {
        const g = groups[cat];
        g.items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        return g;
      });
  }

  async #enrichStashGroups(groups) {
    for (const group of groups) {
      for (const item of group.items) {
        item.projectData = null;
        item.hasCraftingData = false;

        // Always enrich description (content is always rendered, just hidden)
        if (item.description) {
          item.description = await TextEditor.enrichHTML(item.description, { async: true })
            .catch(() => item.description);
        }

        if (item.uuid) {
          try {
            const src = await fromUuid(item.uuid);
            if (src) {
              item.hasCraftingData = !!(src.system?.project?.goal);
              const sys = src.system;
              item.projectData = {
                goal: sys.project?.goal ?? null,
                prerequisites: sys.project?.prerequisites ?? sys.prerequisites ?? null,
                projectSource: sys.project?.source ?? null,
              };
            }
          } catch { /* source item no longer available */ }
        }
      }
    }
    return groups;
  }

  #stashGroupLabel(cat) {
    const labels = {
      consumable: game.i18n.localize("DSHIDEOUT.Stash.GroupConsumable"),
      trinket: game.i18n.localize("DSHIDEOUT.Stash.GroupTrinket"),
      leveled: game.i18n.localize("DSHIDEOUT.Stash.GroupLeveled"),
      artifact: game.i18n.localize("DSHIDEOUT.Stash.GroupArtifact"),
    };
    return labels[cat] ?? game.i18n.localize("DSHIDEOUT.Stash.GroupOther");
  }

  async #buildArchiveGroups(items) {
    const groups = {};
    const categoryOrder = ["consumable", "trinket", "leveled", "artifact", ""];

    for (const item of items) {
      const cat = item.category || "";
      if (!groups[cat]) groups[cat] = { key: cat, label: this.#stashGroupLabel(cat), items: [] };
      let description = item.description;
      if (description) {
        description = await TextEditor.enrichHTML(description, { async: true }).catch(() => description);
      }
      groups[cat].items.push({
        ...item,
        isExpanded: this.#expandedDescriptions.has(item.id),
        echelonLabel: item.echelon ? `E${item.echelon}` : "",
        description,
      });
    }

    return categoryOrder
      .filter(cat => groups[cat])
      .map(cat => {
        const g = groups[cat];
        g.items.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        return g;
      });
  }

  /* -------------------------------------------------- */
  /*  Lifecycle                                         */
  /* -------------------------------------------------- */

  /** @inheritdoc */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this._attachDragHandlers();
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    // Suppress transition on initial paint so elements snap to their
    // correct collapsed/expanded state without animating in.
    for (const el of this.element.querySelectorAll(".dshideout-collapsible")) {
      el.classList.add("no-transition");
      requestAnimationFrame(() => el.classList.remove("no-transition"));
    }
    // Animate progress bars: bars render at their previous width (startPct), then a
    // double-rAF ensures the browser has painted before we set the target width so
    // the CSS transition fires from the old position → new position.
    const barsToAnimate = this.element.querySelectorAll("[data-animate-to]");
    if (barsToAnimate.length) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const bar of barsToAnimate) bar.style.width = bar.dataset.animateTo + "%";
      }));
    }
    this._attachDragHandlers();
    this._attachDropHandlers();

    // Wire GM project points editor
    if (game.user.isGM) {
      for (const input of this.element.querySelectorAll(".dshideout-points-input")) {
        input.addEventListener("change", async (e) => {
          const projectId = input.dataset.projectId;
          const newPoints = Math.max(0, parseInt(e.target.value) || 0);
          const projects = getProjects();
          const project = projects.find(p => p.id === projectId);
          if (!project) return;
          await updateProject(projectId, {
            points: newPoints,
            completed: project.goal ? newPoints >= project.goal : project.completed,
          });
          this.render({ parts: ["main"] });
        });
      }

      // Wire GM project goal editor
      for (const input of this.element.querySelectorAll(".dshideout-goal-input")) {
        input.addEventListener("change", async (e) => {
          const projectId = input.dataset.projectId;
          const rawVal = parseInt(e.target.value);
          const newGoal = (!isNaN(rawVal) && rawVal > 0) ? rawVal : null;
          const projects = getProjects();
          const project = projects.find(p => p.id === projectId);
          if (!project) return;
          await updateProject(projectId, {
            goal: newGoal,
            completed: newGoal ? project.points >= newGoal : false,
          });
          this.render({ parts: ["main"] });
        });
      }
    }

    // Wire filter/sort selects via change event.
    // data-action on <select> fires on click (before value changes), which re-renders
    // and collapses the native dropdown before the user can pick an option.
    const filterSelect = this.element.querySelector("[name='projectFilter']");
    if (filterSelect) {
      filterSelect.addEventListener("change", (e) => {
        this.#projectFilter = e.target.value || "all";
        this.render({ parts: ["main"] });
      });
    }
    const sortSelect = this.element.querySelector("[name='projectSort']");
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        this.#projectSort = e.target.value || "progress";
        this.render({ parts: ["main"] });
      });
    }

    // Wire add-follower select (GM only)
    const addFollowerSelect = this.element.querySelector("[data-add-follower-select]");
    if (addFollowerSelect) {
      addFollowerSelect.addEventListener("change", async (e) => {
        const actorId = e.target.value;
        if (!actorId) return;
        e.target.value = "";  // reset select
        await HideoutApp.#addFollowerToRoster(actorId);
        this.render({ parts: ["roster"] });
      });
    }
  }

  /* -------------------------------------------------- */
  /*  Drag & Drop                                       */
  /* -------------------------------------------------- */

  _attachDragHandlers() {
    const el = this.element;
    if (!el) return;

    // Roster actor rows
    for (const row of el.querySelectorAll("[data-drag-actor]")) {
      row.addEventListener("dragstart", this.#onDragRosterActor.bind(this), { once: false });
    }

    // Stash items drag to actor (send item)
    for (const row of el.querySelectorAll("[data-drag-stash-item]")) {
      row.addEventListener("dragstart", this.#onDragStashItem.bind(this), { once: false });
    }

    // Contributor pills drag to reassign
    for (const pill of el.querySelectorAll("[data-drag-contributor]")) {
      pill.addEventListener("dragstart", this.#onDragContributorPill.bind(this), { once: false });
    }
  }

  _attachDropHandlers() {
    const el = this.element;
    if (!el) return;

    // Cancel previous set of listeners before re-attaching; this prevents
    // stacking listeners when _onRender fires for partial re-renders (e.g.
    // render({ parts: ["main"] })) while roster hero rows remain in the DOM.
    this.#dropHandlerAbort?.abort();
    this.#dropHandlerAbort = new AbortController();
    const { signal } = this.#dropHandlerAbort;

    // Project drop zones (assign contributor)
    for (const zone of el.querySelectorAll("[data-project-drop-zone]")) {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        zone.classList.add("drag-over");
      }, { signal });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"), { signal });
      zone.addEventListener("drop", (e) => {
        zone.classList.remove("drag-over");
        e.stopPropagation();
        this.#onDropActorOnProject(e);
      }, { signal });
    }

    // Item drop zone (add to stash from sidebar or canvas) — only GMs can add
    const stashZone = el.querySelector("[data-stash-drop-zone]");
    if (stashZone && game.user.isGM) {
      stashZone.addEventListener("dragover", (e) => {
        // Reject drags that originated from our own stash (prevent disappear-on-drop-back)
        if (e.dataTransfer.types.includes("application/x-dshideout-stash")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }, { signal });
      stashZone.addEventListener("drop", this.#onDropItemToStash.bind(this), { signal });
    }

    // Project drop zone from sidebar
    const projectsZone = el.querySelector("[data-projects-drop-zone]");
    if (projectsZone) {
      projectsZone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, { signal });
      projectsZone.addEventListener("drop", this.#onDropItemAsProject.bind(this), { signal });
    }

    // Follower roster drop zone — actors from sidebar
    const followerRosterZone = el.querySelector("[data-follower-roster-drop]");
    if (followerRosterZone) {
      followerRosterZone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, { signal });
      followerRosterZone.addEventListener("drop", this.#onDropActorOnRoster.bind(this), { signal });
    }

    // Hero rows — accept stash item drags
    for (const heroRow of el.querySelectorAll("[data-hero-drop-zone]")) {
      heroRow.addEventListener("dragover", (e) => {
        // Only accept stash item drags
        if (!e.dataTransfer.types.includes("application/x-dshideout-stash")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        heroRow.classList.add("drag-over");
      }, { signal });
      heroRow.addEventListener("dragleave", () => heroRow.classList.remove("drag-over"), { signal });
      heroRow.addEventListener("drop", (e) => {
        heroRow.classList.remove("drag-over");
        this.#onDropStashItemOnHero(e, heroRow);
      }, { signal });
    }
  }

  #onDragRosterActor(event) {
    const row = event.currentTarget;
    const actorId = row.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const dragData = {
      type: "Actor",
      uuid: actor.uuid,
      id: actor.id,
      _dshideoutSource: "roster",
    };
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    event.dataTransfer.setData("application/x-dshideout-actor", JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  #onDragStashItem(event) {
    const row = event.currentTarget;
    const itemId = row.dataset.stashItemId;
    const stash = getStash();
    const stashItem = stash.find(i => i.id === itemId);
    if (!stashItem) return;

    this.#stashDragHandledInternally = false;

    // Build a compact drag ghost showing only the dragged row's icon + name
    const ghost = document.createElement("div");
    ghost.style.cssText = [
      "position:absolute", "top:-9999px", "left:-9999px",
      "display:flex", "align-items:center", "gap:6px",
      "padding:4px 8px",
      "background:var(--color-background-alt,rgba(30,30,30,0.88))",
      "color:var(--color-text-primary,#fff)",
      "border:1px solid color-mix(in srgb,currentColor 20%,transparent)",
      "border-radius:4px", "font-size:0.8rem", "white-space:nowrap",
      "pointer-events:none", "z-index:9999",
    ].join(";");
    ghost.innerHTML = `<img src="${stashItem.img}" width="20" height="20" style="border-radius:3px;object-fit:cover;flex-shrink:0;" /><span>${stashItem.name}</span>`;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 16, 16);
    requestAnimationFrame(() => document.body.removeChild(ghost));

    // Custom MIME for our own drop zones (hero rows, etc.)
    event.dataTransfer.setData("application/x-dshideout-stash", JSON.stringify({ itemId, name: stashItem.name }));
    // Standard Foundry item data so actor sheets and canvas can accept the drop.
    // Include _dshideoutStashId so our hooks can identify and handle this drag.
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Item",
      uuid: stashItem.uuid,
      _dshideoutStashId: itemId,
    }));
    event.dataTransfer.effectAllowed = "copyMove";
    // Note: stash removal is handled by #onDropStashItemOnHero (internal)
    // or by dropActorSheetData / canvas drop hooks (external). No dragend needed.
  }

  #onDragContributorPill(event) {
    event.stopPropagation();
    const pill = event.currentTarget;
    const actorId = pill.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const dragData = {
      type: "Actor",
      uuid: actor.uuid,
      id: actor.id,
      _dshideoutSource: "contributorPill",
    };
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    event.dataTransfer.setData("application/x-dshideout-actor", JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  async #onDropActorOnProject(event) {
    event.preventDefault();
    const zone = event.currentTarget;
    const projectId = zone.dataset.projectDropZone;
    if (!projectId) return;

    let dragData;
    try {
      dragData = JSON.parse(
        event.dataTransfer.getData("application/x-dshideout-actor") ||
        event.dataTransfer.getData("text/plain")
      );
    } catch {
      return;
    }

    if (!dragData?.uuid) return;
    const actor = await fromUuid(dragData.uuid);
    if (!actor || !["hero", FOLLOWER_TYPE].includes(actor.type)) return;

    // Permission check
    const isGM = game.user.isGM;
    if (!isGM) {
      // Players can only drag their own character or their mentored/unassigned followers
      const isOwnHero = actor.type === "hero" && game.user.character?.id === actor.id;
      const mentorId = actor.system.retainer?.mentor;
      const isMentoredByUser = actor.type === FOLLOWER_TYPE && mentorId && game.user.character?.id === mentorId;
      const isUnassigned = actor.type === FOLLOWER_TYPE && !mentorId;
      if (!isOwnHero && !isMentoredByUser && !isUnassigned) {
        ui.notifications.warn("You can only assign your own hero or your followers.");
        return;
      }
    }

    const projects = getProjects();
    const targetProject = projects.find(p => p.id === projectId);
    if (!targetProject || targetProject.completed) return;

    const oldProjectId = await assignContributor(actor.id, projectId);

    if (oldProjectId && oldProjectId !== projectId) {
      const oldProject = projects.find(p => p.id === oldProjectId);
      ui.notifications.info(game.i18n.format("DSHIDEOUT.Projects.ReassignWarning", {
        actor: actor.name,
        oldProject: oldProject?.name ?? "a project",
        newProject: targetProject.name,
      }));
    }

    this.render({ parts: ["roster", "main"] });
  }

  async #onDropItemToStash(event) {
    event.preventDefault();
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Stash.PlayerCannotAdd"));
      return;
    }

    // Ignore drags that originated from our own stash (they carry the custom MIME type)
    if (event.dataTransfer.types.includes("application/x-dshideout-stash")) return;

    let dragData;
    try {
      dragData = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    if (dragData?.type !== "Item") return;
    const item = await fromUuid(dragData.uuid);
    if (!item) return;
    if (item.type !== "treasure") {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Stash.NotATreasure"));
      return;
    }

    // Determine if this item is embedded on an actor (dragged from hero sheet)
    const isEmbedded = !!item.parent;
    const srcQty = item.system?.quantity ?? 1;
    let transferQty = 1;

    if (isEmbedded && srcQty > 1) {
      transferQty = await HideoutApp.#promptQuantity(srcQty, item.name,
        game.i18n.localize("DSHIDEOUT.Transfer.PartyStash"));
      if (!transferQty) return; // cancelled
    } else if (isEmbedded) {
      transferQty = 1;
    }

    // Resolve canonical source UUID for the stash (prefer compendium sourceId, then world item)
    const sourceId = item.flags?.core?.sourceId ?? null;
    const stashUuid = isEmbedded ? (sourceId ?? item.uuid) : item.uuid;

    await addStashItem({
      uuid: stashUuid,
      name: item.name,
      img: item.img,
      description: item.system.description?.value ?? "",
      category: item.system.category ?? "",
      echelon: item.system.echelon ?? 0,
    }, transferQty);

    // Remove/decrease from the source actor if it's embedded
    if (isEmbedded) {
      if (transferQty >= srcQty) {
        await item.delete();
      } else {
        await item.update({ "system.quantity": srcQty - transferQty });
      }
    }

    ui.notifications.info(game.i18n.format("DSHIDEOUT.Stash.ItemDropped", { name: item.name }));
    this.render({ parts: ["main"] });
  }

  async #onDropItemAsProject(event) {
    event.preventDefault();

    let dragData;
    try {
      dragData = JSON.parse(event.dataTransfer.getData("text/plain"));    } catch {
      return;
    }

    if (dragData?.type !== "Item") return;
    const item = await fromUuid(dragData.uuid);
    if (!item) return;
    if (item.type !== "project") {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Projects.NotAProject"));
      return;
    }

    await this._addProjectFromItem(item);
    this.render({ parts: ["main"] });
  }

  async #onDropActorOnRoster(event) {
    event.preventDefault();
    let dragData;
    try {
      dragData = JSON.parse(
        event.dataTransfer.getData("application/x-dshideout-actor") ||
        event.dataTransfer.getData("text/plain")
      );
    } catch {
      return;
    }
    if (dragData?.type !== "Actor") return;
    const actor = await fromUuid(dragData.uuid);
    if (!actor || actor.type !== FOLLOWER_TYPE) return;

    await HideoutApp.#addFollowerToRoster(actor.id);
    this.render({ parts: ["roster"] });
  }

  /** Show a numeric quantity prompt. Returns the chosen number, or null if cancelled. */
  static async #promptQuantity(maxQty, itemName, targetName) {
    let chosen = null;
    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("DSHIDEOUT.Transfer.PromptTitle", { item: itemName }) },
      content: `
        <form class="standard-form">
          <div class="form-group">
            <label>${game.i18n.format("DSHIDEOUT.Transfer.HowMany", { item: itemName, target: targetName, max: maxQty })}</label>
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
    return chosen;
  }

  async #onDropStashItemOnHero(event, heroRow) {
    event.preventDefault();
    this.#stashDragHandledInternally = true; // prevent dragend from also decreasing stash

    const actorId = heroRow.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "hero") return;

    let dragData;
    try {
      dragData = JSON.parse(event.dataTransfer.getData("application/x-dshideout-stash"));
    } catch {
      return;
    }

    if (!dragData?.itemId) return;
    const stash = getStash();
    const stashItem = stash.find(i => i.id === dragData.itemId);
    if (!stashItem) return;

    const sourceItem = await fromUuid(stashItem.uuid).catch(() => null);
    if (!sourceItem) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Transfer.SourceMissing"));
      return;
    }

    const maxQty = stashItem.quantity ?? 1;
    let transferQty = 1;
    if (maxQty > 1) {
      transferQty = await HideoutApp.#promptQuantity(maxQty, stashItem.name, actor.name);
      if (!transferQty) return; // cancelled
    }

    // Check if the actor already has an item from the same source — merge quantity instead of duplicating
    const existingItem = actor.items.find(i => {
      const srcId = i.flags?.core?.sourceId ?? null;
      if (srcId === stashItem.uuid || i.flags?.core?.sourceId === stashItem.uuid) return true;
      // Fallback: match by name + type for items given outside of this module
      return i.name === stashItem.name && i.type === (sourceItem?.type ?? "treasure");
    });

    if (existingItem && "quantity" in (existingItem.system ?? {})) {
      await existingItem.update({ "system.quantity": (existingItem.system.quantity ?? 1) + transferQty });
    } else {
      // Create item(s) on the actor
      const itemData = sourceItem.toObject();
      delete itemData._id;
      // Explicitly set sourceId so future drops can find and merge this item.
      foundry.utils.setProperty(itemData, "flags.core.sourceId", stashItem.uuid);
      if ("quantity" in (itemData.system ?? {})) {
        itemData.system.quantity = transferQty;
        await actor.createEmbeddedDocuments("Item", [itemData]);
      } else {
        const copies = Array.from({ length: transferQty }, () => foundry.utils.deepClone(itemData));
        await actor.createEmbeddedDocuments("Item", copies);
      }
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
    this.render({ parts: ["main"] });
  }

  /* -------------------------------------------------- */
  /*  Public helper (called by browser)                 */
  /* -------------------------------------------------- */

  async _addProjectFromItem(item, { additionalDetail = "" } = {}) {
    const sys = item.system;
    const result = await addProject({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      description: sys.description?.value ?? "",
      goal: sys.goal ?? null,
      type: sys.type ?? "other",
      rollCharacteristic: Array.from(sys.rollCharacteristic ?? []),
      projectSource: sys.projectSource ?? "",
      prerequisites: sys.prerequisites ?? "",
      yieldItemUuid: sys.yield?.item ?? null,
      yieldAmount: sys.yield?.amount ?? "1",
      yieldDisplay: sys.yield?.display ?? "",
      additionalDetail,
    });

    if (!result) {
      ui.notifications.warn(game.i18n.format("DSHIDEOUT.Projects.AlreadyAdded", { name: item.name }));
      return false;
    }

    ui.notifications.info(game.i18n.format("DSHIDEOUT.Projects.AddedNotice", { name: item.name }));
    this.render({ parts: ["main"] });
    return true;
  }

  async _addTreasureAsProject(item) {
    if (item.type !== "treasure") return false;
    const sys = item.system;
    if (!sys.project?.goal) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.TreasureBrowser.NoProjectData"));
      return false;
    }

    const result = await addProject({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      description: sys.description?.value ?? "",
      goal: sys.project.goal ?? null,
      type: "crafting",
      rollCharacteristic: Array.from(sys.project.rollCharacteristic ?? []),
      projectSource: sys.project.source ?? "",
      prerequisites: sys.project.prerequisites ?? "",
      yieldItemUuid: item.uuid,
      yieldAmount: sys.project.yield?.amount ?? "1",
      yieldDisplay: sys.project.yield?.display ?? "",
    });

    if (!result) {
      ui.notifications.warn(game.i18n.format("DSHIDEOUT.Projects.AlreadyAdded", { name: item.name }));
      return false;
    }

    ui.notifications.info(game.i18n.format("DSHIDEOUT.Projects.AddedNotice", { name: item.name }));
    this.render({ parts: ["main"] });
    return true;
  }

  /* -------------------------------------------------- */
  /*  Static action handlers                            */
  /* -------------------------------------------------- */

  static #onSwitchTab(event, target) {
    this.#activeTab = target.dataset.tab;
    this.render({ parts: ["main"] });
  }

  static #onToggleDescription(event, target) {
    // Don't toggle when clicking interactive elements or contributor pills (which are draggable)
    if (event.target.closest("input, button, select, a, [data-drag-contributor]")) return;

    // Find the ID: the target or its ancestor carries data-description-id
    const id = target.dataset.descriptionId
             ?? target.closest("[data-description-id]")?.dataset.descriptionId;
    if (!id) return;

    const nowExpanded = !this.#expandedDescriptions.has(id);
    if (nowExpanded) {
      this.#expandedDescriptions.add(id);
    } else {
      this.#expandedDescriptions.delete(id);
    }

    // Direct DOM toggle — no re-render needed
    const collapsible = this.element?.querySelector(`.dshideout-collapsible[data-collapsible-id="${id}"]`);
    if (collapsible) collapsible.classList.toggle("is-expanded", nowExpanded);

    const chevron = this.element?.querySelector(`[data-chevron-id="${id}"]`);
    if (chevron) {
      chevron.classList.toggle("fa-chevron-up", nowExpanded);
      chevron.classList.toggle("fa-chevron-down", !nowExpanded);
    }
  }

  static async #onRemoveProject(event, target) {
    const projectId = target.dataset.projectId;
    const projects = getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DSHIDEOUT.Projects.DeleteConfirm") },
      content: `<p>${game.i18n.format("DSHIDEOUT.Projects.DeleteConfirm", { name: project.name })}</p>`,
    });
    if (!confirmed) return;

    await removeProject(projectId);
    this.render({ parts: ["roster", "main"] });
  }

  static async #onRemoveContributor(event, target) {
    const actorId = target.dataset.actorId;
    await removeContributor(actorId);
    this.render({ parts: ["roster", "main"] });
  }

  static async #onObtainYield(event, target) {
    const projectId = target.dataset.projectId;
    const projects = getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project?.yieldItemUuid) return;

    // Animate the button sliding out before re-rendering
    const yieldBtn = this.element?.querySelector(
      `[data-action="obtainYield"][data-project-id="${projectId}"]`
    );
    if (yieldBtn) {
      yieldBtn.classList.add("dshideout-yield-sliding-out");
      await new Promise(r => setTimeout(r, 330));
    }

    const yieldItem = await fromUuid(project.yieldItemUuid);
    if (!yieldItem) {
      ui.notifications.error("Could not find the yield item.");
      return;
    }

    // Roll yield amount if it contains dice
    let quantity = 1;
    try {
      const roll = new Roll(project.yieldAmount ?? "1");
      await roll.evaluate();
      quantity = Math.max(1, roll.total);
    } catch {
      quantity = 1;
    }

    await addStashItem({
      uuid: yieldItem.uuid,
      name: yieldItem.name,
      img: yieldItem.img,
      description: yieldItem.system.description?.value ?? "",
      category: yieldItem.system.category ?? "",
      echelon: yieldItem.system.echelon ?? 0,
    }, quantity);

    await markYieldObtained(projectId);
    ui.notifications.info(`Added ${quantity}× ${yieldItem.name} to the party stash.`);
    const displayName = project.additionalDetail
      ? `${project.name} (${project.additionalDetail})` : project.name;
    await ChatMessage.create({
      content: `<p><strong>${game.i18n.localize("DSHIDEOUT.Chat.YieldObtained")}</strong> — ${game.i18n.format("DSHIDEOUT.Chat.YieldObtainedMsg", { qty: quantity, item: yieldItem.name, project: displayName })}</p>`,
      speaker: { alias: game.i18n.localize("DSHIDEOUT.Chat.Alias") },
    });
    this.render({ parts: ["main"] });
  }

  static async #onRestartProject(event, target) {
    const projectId = target.dataset.projectId;
    const projects = getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DSHIDEOUT.Projects.RestartConfirmTitle") },
      content: `<p>${game.i18n.format("DSHIDEOUT.Projects.RestartConfirm", { name: project.name })}</p>`,
    });
    if (!confirmed) return;

    await updateProject(projectId, { completed: false, points: 0, yieldObtained: false });
    await ChatMessage.create({
      content: `<p><strong>${game.i18n.localize("DSHIDEOUT.Chat.ProjectRestarted")}</strong> — ${game.i18n.format("DSHIDEOUT.Chat.ProjectRestartedMsg", { project: project.name })}</p>`,
      speaker: { alias: game.i18n.localize("DSHIDEOUT.Chat.Alias") },
    });
    this.render({ parts: ["main"] });
  }

  static async #onOpenProjectSheet(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    try {
      const item = await fromUuid(uuid);
      item?.sheet?.render({ force: true });
    } catch (err) {
      console.warn("draw-steel-hideout | Could not open project sheet:", err);
    }
  }

  static async #onIncreaseQty(event, target) {
    const itemId = target.dataset.stashItemId;
    await changeStashQuantity(itemId, 1);
    this.render({ parts: ["main"] });
  }

  static async #onDecreaseQty(event, target) {
    const itemId = target.dataset.stashItemId;
    const stash = getStash();
    const item = stash.find(i => i.id === itemId);
    if (!item) return;

    if (item.quantity <= 1) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("DSHIDEOUT.Stash.DeleteConfirm") },
        content: `<p>${game.i18n.format("DSHIDEOUT.Stash.DeleteConfirm", { name: item.name })}</p>`,
      });
      if (!confirmed) return;
      await removeStashItem(itemId);
    } else {
      await changeStashQuantity(itemId, -1);
    }

    this.render({ parts: ["main"] });
  }

  static async #onRemoveStashItem(event, target) {
    const itemId = target.dataset.stashItemId;
    const stash = getStash();
    const item = stash.find(i => i.id === itemId);
    if (!item) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DSHIDEOUT.Stash.DeleteConfirm") },
      content: `<p>${game.i18n.format("DSHIDEOUT.Stash.DeleteConfirm", { name: item.name })}</p>`,
    });
    if (!confirmed) return;

    await removeStashItem(itemId);
    this.render({ parts: ["main"] });
  }

  static async #onCreateFollower(event, target) {
    const dialog = new CreateFollowerDialog();
    await dialog.render({ force: true });
  }

  static async #onBeginCraftingFromArchive(event, target) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Archives.PlayerCannotAdd"));
      return;
    }
    const itemId = target.dataset.archiveItemId;
    const archives = getArchives();
    const entry = archives.find(i => i.id === itemId);
    if (!entry) return;

    if (!entry.hasCraftingData) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Archives.NoCraftingData"));
      return;
    }

    const item = await fromUuid(entry.uuid).catch(() => null);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("DSHIDEOUT.Transfer.SourceMissing"));
      return;
    }

    await this._addTreasureAsProject(item);
    // Switch to projects tab after starting the project
    this.#activeTab = "projects";
    this.render({ parts: ["main"] });
  }

  static async #onRemoveArchiveEntry(event, target) {
    const itemId = target.dataset.archiveItemId;
    const archives = getArchives();
    const entry = archives.find(i => i.id === itemId);
    if (!entry) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DSHIDEOUT.Archives.Remove") },
      content: `<p>${game.i18n.format("DSHIDEOUT.Archives.DeleteConfirm", { name: entry.name })}</p>`,
    });
    if (!confirmed) return;

    await removeArchiveEntry(itemId);
    this.render({ parts: ["main"] });
  }

  static async #onOpenProjectBrowser(event, target) {
    const browser = new ProjectBrowserApp({ hideoutApp: this });
    browser.render({ force: true });
  }

  static async #onOpenTreasureBrowser(event, target) {
    const browser = new TreasureBrowserApp({ hideoutApp: this });
    browser.render({ force: true });
  }

  static async #onProgressProjects(event, target) {
    const dialog = new ProgressProjectsDialog({ hideoutApp: this });
    await dialog.render({ force: true });
  }

  static async #onRemoveFromRoster(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    const name = actor?.name ?? "this follower";

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DSHIDEOUT.Roster.RemoveConfirmTitle") },
      content: `<p>${game.i18n.format("DSHIDEOUT.Roster.RemoveConfirm", { name })}</p>`,
    });
    if (!confirmed) return;

    // Remove from any project they contribute to
    await removeContributor(actorId);
    await HideoutApp.#removeFollowerFromRoster(actorId);
    this.render({ parts: ["roster", "main"] });
  }
}
