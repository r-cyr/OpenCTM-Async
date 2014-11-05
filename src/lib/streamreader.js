'use strict';

var INT32_SIZE = 4,
    FLOAT32_SIZE = 4;

function StreamReader(arrayBuffer, offset) {
  this.buffer = arrayBuffer;
  this._offset = ((typeof offset) === 'undefined') ? 0 : offset;
  this._dataView = new DataView(arrayBuffer);
}

StreamReader.prototype.readByte = function() {
  var value = this._dataView.getUint8(this._offset);

  this._offset++;
  return value;
};

StreamReader.prototype.readInt32 = function() {
  var value = this._dataView.getInt32(this._offset, true);

  this._offset += INT32_SIZE;
  return value;
};

StreamReader.prototype.readFloat32 = function() {
  var value = this._dataView.getFloat32(this._offset, true);

  this._offset += FLOAT32_SIZE;
  return value;
};

StreamReader.prototype.readString = function() {
  var length = this.readInt32(),
      value = String.fromCharCode.apply(null, new Uint8Array(this.buffer, this._offset, length));

  this._offset += length;
  return value;
};

StreamReader.prototype.seek = function(offset) {
  this._offset = offset;
};

StreamReader.prototype.ignore = function(count) {
  this._offset += count;
};

StreamReader.prototype.offset = function() {
  return this._offset;
};

StreamReader.prototype.length = function() {
  return this.buffer.byteLength;
};

StreamReader.prototype.eof = function() {
  return this._offset >= this.buffer.byteLength;
};

module.exports = StreamReader;
