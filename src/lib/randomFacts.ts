export const randomFacts = [
  "MRI machines use quantum spin, not moving parts, to image your body.",
  "Viruses aren't alive but evolve faster than anything living.",
  "80% of Earth's volcanoes erupt underwater, unseen by humans.",
  "The Issus insect has real mechanical gears in its legs for jumping.",
  "Saturn could float in water because it's less dense than it.",
  "NASA's Voyager probes still transmit data using 1970s computers.",
  "Planet 55 Cancri e is likely made of solid diamond.",
  "Your brain rewrites memories slightly every time you recall them.",
  "Octopus arms can think and act independently from their brain.",
  "Tardigrades can survive space, radiation, and boiling water.",
  "Octopuses have three hearts — two pump blood to the gills, one to the rest of the body. When they swim, the main heart stops beating.",
  "Honey never expires. Archaeologists found 3,000-year-old honey in Egyptian tombs — still edible.",
  "Sharks existed before trees. Sharks are over 400 million years old; trees appeared ~350 million years ago.",
  "Wombat poop is cube-shaped. It prevents the poop from rolling away, helping them mark territory.",
  "The Sun makes a sound — but we can't hear it. NASA detected its vibrations using satellite data and converted them into eerie audio waves.",
  "You can smell rain before it arrives. The scent is called petrichor — caused by oils from plants and a compound called geosmin released by soil bacteria.",
  "Jellyfish are functionally immortal. The Turritopsis dohrnii species can revert back to its juvenile form indefinitely under stress.",
  "There's enough DNA in your body to stretch from the Sun to Pluto and back — 17 times.",
  "The Apollo 11 computer was weaker than a modern calculator. It ran at 0.043 MHz — your phone runs millions of times faster.",
  "NASA's Voyager 1 spacecraft still communicates from 24 billion km away — on 1970s hardware.",
  "\"Bluetooth\" is named after a Viking king, Harald Bluetooth, who united Denmark — just like the tech unites devices.",
  "Your phone has more computing power than all of NASA did during the Moon landing.",
  "Space smells like burnt steak and metal. Astronauts described the scent after spacewalks — it comes from high-energy atoms mixing with oxygen.",
  "If two pieces of metal touch in space, they fuse together permanently. It's called cold welding, and it happens because there's no air between them.",
  "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.",
  "You're bioluminescent — you literally glow. Humans emit a small amount of light, but it's 1,000 times too weak for our eyes to see.",
  "Your stomach gets a new lining every few days so it doesn't digest itself.",
  "In Japan, there's a word (tsundoku) for buying books you never read.",
  "There's a lake in Tanzania that turns animals into stone. The water's high soda and salt content preserves them in a petrified state.",
  "When you blush, your stomach also turns red. The same response that dilates blood vessels in your face affects your stomach lining too."
];

// Hydration-safe default fact for initial render across pages.
export const DEFAULT_RANDOM_FACT = randomFacts[0];

export function getRandomFact(): string {
  const randomIndex = Math.floor(Math.random() * randomFacts.length);
  return randomFacts[randomIndex];
}

