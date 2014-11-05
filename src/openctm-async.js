'use strict';

var mg2 = require('./lib/decoders/mg2'),
    OpenCtmError = require('./lib/openctmerror'),
    StreamReader = require('./lib/streamreader'),

    OPENCTM_MAGIC = 0x4D54434F,

    CompressionMethods = {
      RAW: 0x00574152,
      MG1: 0x0031474D,
      MG2: 0x0032474D
    };

var getBodyDecoder = function(compressionMethod) {
  switch(compressionMethod) {
    case CompressionMethods.MG2:
      return mg2;
      break;
  }

  throw new OpenCtmError('Unknown compression method: ' + compressionMethod);
};

var readHeader = function(reader) {
  var magicIdentifier = reader.readInt32();

  if (magicIdentifier !== OPENCTM_MAGIC) {
    throw new OpenCtmError('No OpenCTM data found');
  }

  return {
    magicIdentifier:   magicIdentifier,
    fileFormatVersion: reader.readInt32(),
    compressionMethod: reader.readInt32(),
    vertexCount:       reader.readInt32(),
    triangleCount:     reader.readInt32(),
    uvMapCount:        reader.readInt32(),
    attributeMapCount: reader.readInt32(),
    flags:             reader.readInt32(),
    fileComment:       reader.readString()
  };
};


var fromArrayBuffer = function(arrayBuffer) {
  var reader = new StreamReader(arrayBuffer),
      ctmHeader = readHeader(reader),
      decoder = getBodyDecoder(ctmHeader.compressionMethod);

  return decoder.decodeBody(ctmHeader, reader)
    .then(function(body) {
      return {
        header: ctmHeader,
        body:   body
      };
    });
};

module.exports = {
  fromArrayBuffer: fromArrayBuffer
};
