"use strict";

// Random corporation emblems for new playerbot corporations.
//
// A player corporation's logo in EVE is up to three stacked emblem layers,
// each a shape from the client's corporation logo library with one of its
// colours, as the in-game "Create corporation" window offers them. New bot
// corporations get a random combination instead of EveJS's single default
// shape, so they can be told apart at a glance.
//
// Set EVEJS_PLAYER_BOTS_CORPORATION_EMBLEMS=0 (or turn off "Random emblems for
// new bot corporations" in the Windows launcher) to leave new bot
// corporations on EveJS's default emblem, for example when another add-on
// supplies PNG logos instead. Corporations that already exist are never
// changed.

// Shape graphic IDs in the client's corporation logo library. 415 is the
// library's "no shape", used for empty upper layers.
const NO_SHAPE = 415;
const FIRST_SHAPE = 416;
const LAST_SHAPE = 578;
// Colour IDs in the client's corporation logo colour library.
const FIRST_COLOR = 671;
const LAST_COLOR = 685;
// How often the second and third layers are used.
const SECOND_LAYER_CHANCE = 0.65;
const THIRD_LAYER_CHANCE = 0.35;

const SHAPES = Object.freeze(Array.from({ length: LAST_SHAPE - FIRST_SHAPE + 1 }, (_, index) => FIRST_SHAPE + index));
const COLORS = Object.freeze(Array.from({ length: LAST_COLOR - FIRST_COLOR + 1 }, (_, index) => FIRST_COLOR + index));

function isEnabled(env = process.env) {
  return String(env.EVEJS_PLAYER_BOTS_CORPORATION_EMBLEMS ?? "1").trim() !== "0";
}

function pick(list, random, exclude = []) {
  const choices = list.filter((value) => !exclude.includes(value));
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

// Returns the six emblem fields for a corporation record. Layers that are
// used get distinct shapes and distinct colours so the layers stay visible.
function chooseEmblem(random = Math.random) {
  const shape1 = pick(SHAPES, random);
  const color1 = pick(COLORS, random);
  const useSecond = random() < SECOND_LAYER_CHANCE;
  const useThird = useSecond && random() < THIRD_LAYER_CHANCE;
  const shape2 = useSecond ? pick(SHAPES, random, [shape1]) : NO_SHAPE;
  const color2 = useSecond ? pick(COLORS, random, [color1]) : null;
  const shape3 = useThird ? pick(SHAPES, random, [shape1, shape2]) : NO_SHAPE;
  const color3 = useThird ? pick(COLORS, random, [color1, color2]) : null;
  return { shape1, shape2, shape3, color1, color2, color3 };
}

// Emblem fields to store on a new bot corporation, or none when turned off.
function emblemForNewCorporation(options = {}) {
  if (!isEnabled(options.env)) return {};
  return chooseEmblem(options.random);
}

module.exports = {
  COLORS,
  NO_SHAPE,
  SHAPES,
  chooseEmblem,
  emblemForNewCorporation,
  isEnabled,
};
