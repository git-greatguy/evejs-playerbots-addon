"use strict";

// Chat command access: whether the caller has the staff view role that unlocks the staff
// debug commands and help text, and which commands a player account may run.

const {
  normalizeRoleValue,
  ROLEMASK_VIEW,
} = require("../../account/accountRoleProfiles");

function hasStaffDebugRole(session) {
  const roleMask = normalizeRoleValue(
    session && (
      session.accountRole ??
      session.role ??
      session.rolesAtAll
    ),
    0n,
  );
  return (roleMask & ROLEMASK_VIEW) !== 0n;
}

// Commands a player account may run: they read the caller's own state, change
// only the caller's own chat look, or check their own authority (/skinr lets a
// player work on their own designs only; the alliance commands need the CEO). Every other command is
// staff-only, so a new command stays staff-only until someone adds it here.
const PLAYER_CHAT_COMMANDS = new Set([
  "help", "commands", "commandlist", "motd", "mailme", "deer_hunter",
  "where", "session", "orbitals", "typeinfo",
  "wallet", "isk", "lp", "evermarks", "corpevermarks",
  "blue", "red", "teal", "yellow",
  "voidreplay", "skinr",
  "setalliance", "joinalliance",
  // Playerbots add-on: these handlers check the caller themselves (own
  // corporation, own fleet, the CEO or staff for the commands that need it).
  "playerbots", "bots", "botlocal", "botlocali", "fitbot", "follow", "escort", "attack",
]);

function mayRunChatCommand(session, command) {
  return PLAYER_CHAT_COMMANDS.has(command) || hasStaffDebugRole(session);
}

module.exports = {
  PLAYER_CHAT_COMMANDS,
  hasStaffDebugRole,
  mayRunChatCommand,
};
