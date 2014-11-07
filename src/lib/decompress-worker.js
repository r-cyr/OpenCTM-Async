'use strict';

var LZMA = require('./vendor/lzma'),
    StreamReader = require('./streamreader'),
    InterleavedStreamWriter = require('./interleaved-streamwriter');

module.exports = function(self) {

  self.addEventListener('message', function (event) {
    var reader = new StreamReader(event.data.buffer, 0),
        writer = new InterleavedStreamWriter(new ArrayBuffer(event.data.decompressedSize), event.data.stride);

    LZMA.decompress(reader, reader, writer, writer.buffer.byteLength);
    self.postMessage(writer.buffer, [writer.buffer]);
    self.close();
  });

};