// Decision rule for the Safety setting, the default.
export const config = {
  setting: 'Safety',
  tileThreshold: 0.95, // a tile is confident above this score
  clearBelow: 1, // fewer confident tiles than this: negative
  flagAbove: 35, // more confident tiles than this: positive
  imagesPerSample: 117,
  tilesPerImage: 12,
}
