// Shared physical constants. Units: meters, seconds, radians, kilograms.
// Everything in the game uses a right-handed, Y-up world (three.js default).

export const GRAVITY = 9.81 * 1.12; // a touch heavier than earth for snappier airs

// ---- Skateboard geometry (a typical 8.25" x 32" street deck) ----
// Board-local frame: origin = midpoint between the four wheel contact points on the ground,
// +Z = nose, -Z = tail, +Y = up through the deck, +X = board's left when looking toward the nose.
export const BOARD = {
  length: 0.81,
  width: 0.21,
  wheelbase: 0.36, // distance between inner truck bolts ~ 14.25"
  truckAxleZ: 0.205, // |z| of the truck axles from center
  wheelRadius: 0.027, // 54mm wheels
  wheelWidth: 0.032,
  axleHalfTrack: 0.105, // |x| of wheel centers from the board centerline
  truckHeight: 0.053, // axle -> baseplate
  deckThickness: 0.012,
  deckTopY: 0.115, // height of the grip tape above the ground when riding flat
  deckBottomY: 0.103,
  kickAngle: 0.33, // nose/tail kick (radians, ~19 deg)
  kickStartZ: 0.28, // |z| where the nose/tail kick begins
  // rider foot targets, board local (x is set to 0, feet sit on the centerline)
  frontFootZ: 0.2,
  backFootZ: -0.2,
  backFootPopZ: -0.33, // back foot on the tail for popping
  pivotY: 0.08, // rotation pivot for flip tricks (≈ board center of mass)
};

// ---- Rider ----
export const RIDER = {
  height: 1.78,
  mass: 75,
  hipHeightStanding: 0.95, // above the deck
};

// Surface tags. Every collider mesh carries mesh.userData.surface = one of these.
export const SURFACES = ['concrete', 'smoothConcrete', 'asphalt', 'wood', 'metal', 'brick', 'grass', 'dirt', 'tile'];

// Rideable surfaces have low rolling resistance; others make you slow down / bail.
export const SURFACE_PROPS = {
  smoothConcrete: { roll: 0.010, rideable: true },
  concrete: { roll: 0.016, rideable: true },
  tile: { roll: 0.014, rideable: true },
  wood: { roll: 0.012, rideable: true },
  metal: { roll: 0.012, rideable: true },
  asphalt: { roll: 0.024, rideable: true },
  brick: { roll: 0.035, rideable: true },
  dirt: { roll: 0.25, rideable: true },
  grass: { roll: 0.6, rideable: true },
};

// Grindable rail kinds. Rail objects: { a: Vector3, b: Vector3, kind, radius }
// a/b = world-space endpoints of the contact line (top of a round rail, the top edge of a ledge, coping top).
export const RAIL_KINDS = {
  metal: { friction: 0.55, sound: 'metal' }, // round/square handrails, flat bars
  coping: { friction: 0.7, sound: 'metal' }, // pipe coping on transitions
  concrete: { friction: 1.2, sound: 'concrete' }, // ledge edges (waxed)
  wood: { friction: 1.0, sound: 'wood' }, // benches, picnic tables
};
