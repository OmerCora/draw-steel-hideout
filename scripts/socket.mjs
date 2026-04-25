/**
 * Draw Steel – Hideout
 * Socket relay: lets non-GM clients write world-scoped settings via the GM.
 *
 * Architecture:
 *   - GMs write directly via `game.settings.set`.
 *   - Players emit a socket request; every active GM performs the write.
 *     (Multiple GMs writing the same value is idempotent.)
 *   - When the world setting is written, Foundry broadcasts the new value
 *     to every client and fires the `updateSetting` hook on every client,
 *     which we wire to `dshideout:refresh` in module.mjs.
 *   - As a robustness backup, the GM also emits an explicit
 *     `refreshHideout` socket message after writing, in case the
 *     `updateSetting` hook does not fire on a remote client.
 */

import { MODULE_ID, SETTINGS } from "./config.mjs";

const SOCKET_NAME = `module.${MODULE_ID}`;

/** All world-setting keys this module owns (used by the updateSetting hook). */
export const HIDEOUT_SETTING_KEYS = new Set([
  SETTINGS.PROJECTS,
  SETTINGS.STASH,
  SETTINGS.FOLLOWERS,
  SETTINGS.ARCHIVES,
]);

// ── Permission helper ─────────────────────────────────────────────────────────

/**
 * Returns true if the current user meets the minimum role required to use
 * the Hideout's write operations.
 * @returns {boolean}
 */
export function hasHideoutPermission() {
  const required = game.settings.get(MODULE_ID, SETTINGS.MINIMUM_ROLE);
  return game.user.role >= required;
}

// ── Socket setup ──────────────────────────────────────────────────────────────

/**
 * Register the socket listener. Call once from the `ready` hook on every
 * client. Each client both:
 *   - listens for incoming relay requests (only GMs act on them)
 *   - listens for explicit refresh broadcasts (everyone reacts)
 */
export function registerSocket() {
  game.socket.on(SOCKET_NAME, async (data) => {
    // Log EVERY incoming message so we can prove the socket is open on this client.
    console.log(`%c${MODULE_ID} | socket recv`, "color:#7af", data);

    if (!data || typeof data !== "object") return;

    // Explicit refresh broadcast — any client (including the originating
    // GM) re-renders by firing the local refresh hook.
    if (data.action === "refreshHideout") {
      Hooks.callAll("dshideout:refresh");
      return;
    }

    // Relay write — only GMs perform the actual setting write.
    if (data.action === "updateSetting") {
      if (!game.user.isGM) return;
      console.log(`%c${MODULE_ID} | GM relaying write for "${data.key}" from user ${data.fromUserId ?? "?"}`, "color:#7f7;font-weight:bold");
      try {
        await game.settings.set(data.moduleId, data.key, data.value);
        // Backup broadcast in case `updateSetting` hook does not fire on
        // remote clients (e.g. older Foundry builds, race conditions).
        game.socket.emit(SOCKET_NAME, { action: "refreshHideout" });
        // Also refresh locally — the GM is also a client.
        Hooks.callAll("dshideout:refresh");
        console.log(`%c${MODULE_ID} | GM write complete for "${data.key}"`, "color:#7f7");
      } catch (err) {
        console.error(`${MODULE_ID} | Socket relay write failed for "${data.key}":`, err);
      }
    }
  });

  console.log(
    `%c${MODULE_ID} | Socket listener REGISTERED v2 on "${SOCKET_NAME}" — user="${game.user.name}", isGM=${game.user.isGM}`,
    "color:#fc4;font-weight:bold;font-size:1.05em"
  );
}

// ── Relay helper ──────────────────────────────────────────────────────────────

/**
 * Write a world-scoped setting from any user.
 *
 * - GMs write directly. Foundry broadcasts the new value to all clients.
 * - Players emit a relay request. Every active GM performs the write
 *   (idempotent — same value), and Foundry then broadcasts the new value
 *   to every client (including the originating player). The GM also
 *   emits an explicit `refreshHideout` socket as a backup.
 *
 * This call returns immediately for players (no ack waiting). The UI will
 * refresh once the GM's write propagates back via `updateSetting` and/or
 * `refreshHideout`.
 *
 * @param {string} key    Setting key (from SETTINGS)
 * @param {string} value  Serialised value (JSON string)
 * @returns {Promise<void>}
 */
export async function saveWorldSetting(key, value) {
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, key, value);
    // Backup broadcast — ensures every client refreshes even if a remote
    // client's `updateSetting` hook doesn't fire for whatever reason.
    game.socket.emit(SOCKET_NAME, { action: "refreshHideout" });
    return;
  }

  // Non-GM: relay to the GM(s). Fire-and-forget.
  console.log(`${MODULE_ID} | Player relay emit for "${key}" (user="${game.user.name}")`);
  game.socket.emit(SOCKET_NAME, {
    action: "updateSetting",
    moduleId: MODULE_ID,
    key,
    value,
    fromUserId: game.user.id,
  });
}
