// Customization catalog shared by the character model, the board model and the customize UI.
// Appearance objects are plain JSON (saved to localStorage). Colors are CSS hex strings.

export const SKIN_TONES = ['#f6d7c3', '#eac0a2', '#d9a47f', '#c18a63', '#a0694a', '#7d4f36', '#5c3a28', '#3f2a1f'];

export const HAIR_STYLES = [
  { id: 'buzz', name: 'Buzz Cut' },
  { id: 'short', name: 'Short Messy' },
  { id: 'swoop', name: 'Side Swoop' },
  { id: 'long', name: 'Shoulder Length' },
  { id: 'bun', name: 'Top Knot' },
  { id: 'curly', name: 'Curly Fro' },
  { id: 'mohawk', name: 'Mohawk' },
  { id: 'braids', name: 'Braids' },
  { id: 'bald', name: 'Bald' },
];
export const HAIR_COLORS = ['#1b1512', '#3b2618', '#6a4426', '#a8743f', '#d9b56c', '#e8e0cf', '#b23a2a', '#3a6fd8', '#e05bb0', '#5fcf6a'];

export const FACIAL_HAIR = [
  { id: 'none', name: 'None' },
  { id: 'stubble', name: 'Stubble' },
  { id: 'mustache', name: 'Mustache' },
  { id: 'beard', name: 'Full Beard' },
];

export const HEADWEAR = [
  { id: 'none', name: 'None' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'cap', name: 'Cap' },
  { id: 'capBack', name: 'Backwards Cap' },
  { id: 'bucket', name: 'Bucket Hat' },
  { id: 'helmet', name: 'Helmet' },
];

export const EYEWEAR = [
  { id: 'none', name: 'None' },
  { id: 'sunglasses', name: 'Sunglasses' },
  { id: 'glasses', name: 'Glasses' },
];

export const TOPS = [
  { id: 'tee', name: 'T-Shirt' },
  { id: 'longsleeve', name: 'Long Sleeve' },
  { id: 'hoodie', name: 'Hoodie' },
  { id: 'flannel', name: 'Flannel' },
  { id: 'tank', name: 'Tank Top' },
  { id: 'jacket', name: 'Coach Jacket' },
];
export const TOP_GRAPHICS = [
  { id: 'none', name: 'Blank' },
  { id: 'logo', name: 'SK8.IO Logo' },
  { id: 'stripe', name: 'Chest Stripe' },
  { id: 'pocket', name: 'Pocket' },
  { id: 'flame', name: 'Flames' },
  { id: 'wheel', name: 'Wheel Badge' },
];

export const BOTTOMS = [
  { id: 'jeans', name: 'Baggy Jeans' },
  { id: 'slim', name: 'Slim Jeans' },
  { id: 'chinos', name: 'Chinos' },
  { id: 'cargo', name: 'Cargo Pants' },
  { id: 'shorts', name: 'Shorts' },
];

export const SHOES = [
  { id: 'cupsole', name: 'Cupsole' },
  { id: 'vulc', name: 'Vulc Low' },
  { id: 'hightop', name: 'High Top' },
];

export const CLOTH_COLORS = [
  '#f2f2f0', '#1c1c1e', '#3d3f45', '#8a8d93', '#1f3a5f', '#2f5d8a', '#6fa8dc', '#2e4d36', '#5b7f3a', '#8f9a5b',
  '#c9b48a', '#a5793d', '#6b3d22', '#7a1f24', '#c0392b', '#e67e22', '#f1c40f', '#d35a9a', '#6c3fa0', '#14a39a',
];

export const DECK_GRAPHICS = [
  { id: 'plain', name: 'Blank Stain' },
  { id: 'logo', name: 'SK8.IO' },
  { id: 'stripes', name: 'Racing Stripes' },
  { id: 'checker', name: 'Checker' },
  { id: 'flames', name: 'Flames' },
  { id: 'gradient', name: 'Sunset Fade' },
  { id: 'camo', name: 'Camo' },
  { id: 'wood', name: 'Natural Ply' },
  { id: 'eye', name: 'Third Eye' },
  { id: 'palms', name: 'Palms' },
];
export const GRIP_STYLES = [
  { id: 'black', name: 'Black' },
  { id: 'clear', name: 'Clear' },
  { id: 'cutout', name: 'Cutout Logo' },
  { id: 'split', name: 'Split Color' },
];
export const TRUCK_FINISHES = [
  { id: 'raw', name: 'Raw', color: '#b8bcc2' },
  { id: 'black', name: 'Black', color: '#2a2b2e' },
  { id: 'gold', name: 'Gold', color: '#c9a646' },
  { id: 'white', name: 'White', color: '#e9e9e9' },
  { id: 'red', name: 'Red', color: '#a8322b' },
];
export const WHEEL_COLORS = ['#f4f1e6', '#f3d250', '#e0574f', '#4aa3df', '#2b2b2b', '#7bd67a', '#f0a3c4', '#ff8a2a'];
export const WHEEL_SIZES = [52, 54, 56, 58]; // mm

export const DEFAULT_APPEARANCE = {
  skin: SKIN_TONES[2],
  hairStyle: 'short',
  hairColor: HAIR_COLORS[1],
  facialHair: 'none',
  headwear: 'beanie',
  headwearColor: '#1c1c1e',
  eyewear: 'none',
  top: 'tee',
  topColor: '#f2f2f0',
  topGraphic: 'logo',
  topGraphicColor: '#c0392b',
  bottom: 'jeans',
  bottomColor: '#2f5d8a',
  shoes: 'cupsole',
  shoeColor: '#1c1c1e',
  shoeSoleColor: '#f2f2f0',
  build: 0.5, // 0 = skinny, 1 = stocky
  height: 0.5, // 0 = short (1.65m), 1 = tall (1.92m)
};

export const DEFAULT_BOARD = {
  deckGraphic: 'logo',
  deckColor: '#c0392b',
  deckAccent: '#f2f2f0',
  grip: 'black',
  truckFinish: 'raw',
  wheelColor: '#f4f1e6',
  wheelSize: 54,
};

export function randomAppearance() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    skin: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES).id,
    hairColor: pick(HAIR_COLORS),
    facialHair: pick(FACIAL_HAIR).id,
    headwear: pick(HEADWEAR).id,
    headwearColor: pick(CLOTH_COLORS),
    eyewear: Math.random() < 0.7 ? 'none' : pick(EYEWEAR).id,
    top: pick(TOPS).id,
    topColor: pick(CLOTH_COLORS),
    topGraphic: pick(TOP_GRAPHICS).id,
    topGraphicColor: pick(CLOTH_COLORS),
    bottom: pick(BOTTOMS).id,
    bottomColor: pick(CLOTH_COLORS),
    shoes: pick(SHOES).id,
    shoeColor: pick(CLOTH_COLORS),
    shoeSoleColor: Math.random() < 0.7 ? '#f2f2f0' : pick(CLOTH_COLORS),
    build: Math.random(),
    height: Math.random(),
  };
}

export function randomBoard() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    deckGraphic: pick(DECK_GRAPHICS).id,
    deckColor: pick(CLOTH_COLORS),
    deckAccent: pick(CLOTH_COLORS),
    grip: pick(GRIP_STYLES).id,
    truckFinish: pick(TRUCK_FINISHES).id,
    wheelColor: pick(WHEEL_COLORS),
    wheelSize: pick(WHEEL_SIZES),
  };
}
