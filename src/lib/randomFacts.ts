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
  "Tardigrades can survive space, radiation, and boiling water."
];

export function getRandomFact(): string {
  const randomIndex = Math.floor(Math.random() * randomFacts.length);
  return randomFacts[randomIndex];
}

