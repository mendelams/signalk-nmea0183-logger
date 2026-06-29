'use strict';

/**
 * NMEA0183 XOR checksum validation and generation.
 * Checksum is calculated by XOR-ing all characters between $ (or !) and *.
 */

function validateChecksum(sentence) {
  const s = sentence.trim();
  const star = s.indexOf('*');
  if (star < 1 || star + 3 > s.length) return false;
  let cs = 0;
  for (let i = 1; i < star; i++) cs ^= s.charCodeAt(i);
  const expected = parseInt(s.substring(star + 1, star + 3), 16);
  return !isNaN(expected) && cs === expected;
}

function generateChecksum(sentence) {
  let cs = 0;
  for (let i = 1; i < sentence.length; i++) cs ^= sentence.charCodeAt(i);
  return sentence + '*' + cs.toString(16).toUpperCase().padStart(2, '0');
}

module.exports = { validateChecksum, generateChecksum };
