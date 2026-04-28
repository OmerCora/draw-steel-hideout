/**
 * Draw Steel – Hideout
 * Project state manager.
 *
 * Projects are persisted as a world-scoped Setting (JSON array).
 * All mutations go through this module — never write the setting directly.
 */

import { MODULE_ID, SETTINGS } from "../config.mjs";
import { saveWorldSetting } from "../socket.mjs";

// ── Typedefs ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HideoutProject
 * @property {string}   id                Unique module-generated ID.
 * @property {string}   uuid              Source item UUID (compendium or world).
 * @property {string}   name              Display name.
 * @property {string}   img               Icon path.
 * @property {string}   description       HTML description.
 * @property {number|null} goal           Point goal (null = no goal set).
 * @property {number}   points            Accumulated project points.
 * @property {string}   type              "crafting" | "research" | "other"
 * @property {string[]} rollCharacteristic Characteristic keys for rolls.
 * @property {string}   projectSource     Source material text.
 * @property {string}   prerequisites     Prerequisite text.
 * @property {string[]} contributorIds    Actor IDs of contributors.
 * @property {boolean}  completed         Whether the project is done.
 * @property {boolean}  hasEvent          Whether a pending event exists.
 * @property {string|null} yieldItemUuid  UUID of the yield item (for crafting).
 * @property {string}   yieldAmount       Die formula for yield (e.g. "1d3").
 * @property {string}   yieldDisplay      Display text for yield.
 * @property {boolean}  yieldObtained     Whether yield was already sent to stash.
 * @property {string}   additionalDetail  Optional user-entered detail appended to display name.
 * @property {string[]} keywords          Localized keyword labels (e.g. for treasure-as-project).
 * @property {string}   eventsMode        "disabled" | "milestone" | "d6" | "guaranteed". Default "disabled".
 * @property {string|null} eventTableUuid UUID of the RollTable to roll for events (null = use default).
 * @property {boolean}  postEventsPrivate Post event chat messages as Private-to-GM. Default true.
 * @property {number[]} eventsTriggeredMilestones  Milestone fractions already triggered (e.g. [0.5]).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @returns {HideoutProject[]} */
function _loadProjects() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTINGS.PROJECTS);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

/** @param {HideoutProject[]} projects */
async function _saveProjects(projects) {
  await saveWorldSetting(SETTINGS.PROJECTS, JSON.stringify(projects));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return all tracked projects.
 * @returns {HideoutProject[]}
 */
export function getProjects() {
  return _loadProjects();
}

/**
 * Add a new project from an Item (compendium or world).
 * @param {object} itemData  Snapshot of the item's data.
 * @returns {Promise<HideoutProject|null>} The new project, or null if already tracked.
 */
export async function addProject(itemData) {
  const projects = _loadProjects();

  /** @type {HideoutProject} */
  const project = {
    id: foundry.utils.randomID(),
    uuid: itemData.uuid,
    name: itemData.name,
    img: itemData.img ?? "icons/svg/item-bag.svg",
    description: itemData.description ?? "",
    goal: itemData.goal ?? null,
    points: 0,
    type: itemData.type ?? "other",
    rollCharacteristic: itemData.rollCharacteristic ?? [],
    projectSource: itemData.projectSource ?? "",
    prerequisites: itemData.prerequisites ?? "",
    contributorIds: [],
    completed: false,
    hasEvent: false,
    yieldItemUuid: itemData.yieldItemUuid ?? null,
    yieldAmount: itemData.yieldAmount ?? "1",
    yieldDisplay: itemData.yieldDisplay ?? "",
    yieldObtained: false,
    additionalDetail: itemData.additionalDetail ?? "",
    keywords: itemData.keywords ?? [],
    eventsMode: itemData.eventsMode ?? "disabled",
    eventTableUuid: itemData.eventTableUuid ?? null,
    postEventsPrivate: itemData.postEventsPrivate ?? true,
    eventsTriggeredMilestones: [],
    individuallyRolledIds: [],
  };

  projects.push(project);
  await _saveProjects(projects);
  return project;
}

/**
 * Remove a project by its module ID.
 * @param {string} projectId
 */
export async function removeProject(projectId) {
  const projects = _loadProjects().filter(p => p.id !== projectId);
  await _saveProjects(projects);
}

/**
 * Update a project's fields.
 * @param {string} projectId
 * @param {Partial<HideoutProject>} changes
 */
export async function updateProject(projectId, changes) {
  const projects = _loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return;
  foundry.utils.mergeObject(projects[idx], changes);
  await _saveProjects(projects);
}

/**
 * Add points to a project and mark completed if goal reached.
 * @param {string} projectId
 * @param {number} points
 * @returns {Promise<{project: HideoutProject, justCompleted: boolean}>}
 */
export async function addProjectPoints(projectId, points) {
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return null;

  const wasCompleted = project.completed;
  project.points = (project.points ?? 0) + points;

  const justCompleted = !wasCompleted && !!project.goal && project.points >= project.goal;
  if (justCompleted) project.completed = true;

  await _saveProjects(projects);
  return { project, justCompleted };
}

/**
 * Assign a contributor to a project.
 * If the actor is already contributing to another project, remove them from it first.
 * @param {string} actorId
 * @param {string} projectId
 * @returns {Promise<string|null>} The old project ID if they were moved, else null.
 */
export async function assignContributor(actorId, projectId) {
  const projects = _loadProjects();
  let oldProjectId = null;

  for (const project of projects) {
    if (project.id === projectId) continue;
    const idx = project.contributorIds.indexOf(actorId);
    if (idx !== -1) {
      project.contributorIds.splice(idx, 1);
      oldProjectId = project.id;
    }
  }

  const target = projects.find(p => p.id === projectId);
  if (target && !target.contributorIds.includes(actorId)) {
    target.contributorIds.push(actorId);
  }

  await _saveProjects(projects);
  return oldProjectId;
}

/**
 * Remove a contributor from whatever project they are in.
 * @param {string} actorId
 */
export async function removeContributor(actorId) {
  const projects = _loadProjects();
  for (const project of projects) {
    const idx = project.contributorIds.indexOf(actorId);
    if (idx !== -1) project.contributorIds.splice(idx, 1);
  }
  await _saveProjects(projects);
}

/**
 * Find which project an actor is contributing to.
 * @param {string} actorId
 * @returns {HideoutProject|null}
 */
export function getContributingProject(actorId) {
  return _loadProjects().find(p => p.contributorIds.includes(actorId)) ?? null;
}

/**
 * Mark a contributor as having rolled individually for the given project.
 * @param {string} projectId
 * @param {string} actorId
 */
export async function markIndividualRoll(projectId, actorId) {
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  const list = Array.isArray(project.individuallyRolledIds) ? project.individuallyRolledIds : [];
  if (!list.includes(actorId)) list.push(actorId);
  project.individuallyRolledIds = list;
  await _saveProjects(projects);
}

/**
 * Returns true if the contributor has already rolled individually for this project.
 * @param {string} projectId
 * @param {string} actorId
 * @returns {boolean}
 */
export function hasIndividualRoll(projectId, actorId) {
  const project = _loadProjects().find(p => p.id === projectId);
  if (!project) return false;
  return Array.isArray(project.individuallyRolledIds)
    && project.individuallyRolledIds.includes(actorId);
}

/**
 * Reset individual-roll state for every project.
 */
export async function clearAllIndividualRolls() {
  const projects = _loadProjects();
  let changed = false;
  for (const project of projects) {
    if (project.individuallyRolledIds?.length) {
      project.individuallyRolledIds = [];
      changed = true;
    }
  }
  if (changed) await _saveProjects(projects);
}

/**
 * Remove a single contributor's individual-roll mark for a project.
 * @param {string} projectId
 * @param {string} actorId
 */
export async function unmarkIndividualRoll(projectId, actorId) {
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project || !Array.isArray(project.individuallyRolledIds)) return;
  const idx = project.individuallyRolledIds.indexOf(actorId);
  if (idx === -1) return;
  project.individuallyRolledIds.splice(idx, 1);
  await _saveProjects(projects);
}

/**
 * Mark a project's yield as obtained (for crafting projects with item yield).
 * Also resets points to 0 and clears completion so the project can be re-run.
 * @param {string} projectId
 */
export async function markYieldObtained(projectId) {
  await updateProject(projectId, {
    yieldObtained: false,
    points: 0,
    completed: false,
    eventsTriggeredMilestones: [],
  });
}
