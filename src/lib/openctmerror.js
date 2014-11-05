'use strict';

function OpenCtmError(message) {
  this.name = 'OpenCtmError';
  this.message = message || 'Unknown OpenCTM Error';
}

OpenCtmError.prototype = Object.create(Error.prototype);
OpenCtmError.prototype.constructor = OpenCtmError;

module.exports = OpenCtmError;
