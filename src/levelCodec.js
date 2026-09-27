/**
 * src/levelCodec.js — Pure base64 ↔ Float32Array codec for the terrain
 * heightmap. No three import → Node-importable for tests.
 */

export function encodeTerrain(data) {
  // data: Float32Array (RGBA per texel: height,r,g,b)
  const bytes = new Uint8Array(data.buffer.slice(0));
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

export function decodeTerrain(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
