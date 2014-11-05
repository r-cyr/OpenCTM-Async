'use strict';

var IS_LITTLE_ENDIAN_ARCHITECTURE = (function() {
  var bytes = new Uint8Array(2),
      int = new Uint16Array(bytes.buffer);

  bytes[0] = 1;

  return int[0] === 1;
})();

var isLittleEndian = function() {
  return IS_LITTLE_ENDIAN_ARCHITECTURE;
};

var isBigEndian = function() {
  return !IS_LITTLE_ENDIAN_ARCHITECTURE;
};

module.exports = {
  isLittleEndian: isLittleEndian,
  isBigEndian: isBigEndian
};
