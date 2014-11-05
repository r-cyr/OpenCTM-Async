'use strict';

var endian = require('./endian');

function InterleavedStreamWriter(arrayBuffer, stride) {
  this._view = new Uint8Array(arrayBuffer);
  this.buffer = this._view.buffer;
  this._offset = endian.isLittleEndian() ? 3: 0;
  this._stride = stride * 4;
}

InterleavedStreamWriter.prototype.writeByte = function(value) {
  this._view[this._offset] = value;
  this._offset += this._stride;

  if (this._offset >= this._view.length){
    this._offset -= this._view.length - 4;

    if (this._offset >= this._stride){
      this._offset -= this._stride + (endian.isLittleEndian() ? 1 : -1);
    }
  }
};

InterleavedStreamWriter.prototype.offset = function() {
  return this._offset;
};

module.exports = InterleavedStreamWriter;
