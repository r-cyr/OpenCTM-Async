!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.CTMAsync=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn) {
    var keys = [];
    var wkey;
    var cacheKeys = Object.keys(cache);
    
    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        if (cache[key].exports === fn) {
            wkey = key;
            break;
        }
    }
    
    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            Function(['require','module','exports'], '(' + fn + ')(self)'),
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
    
    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        Function(['require'],'require(' + stringify(wkey) + ')(self)'),
        scache
    ];
    
    var src = '(' + bundleFn + ')({'
        + Object.keys(sources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;
    return new Worker(window.URL.createObjectURL(
        new Blob([src], { type: 'text/javascript' })
    ));
};

},{}],2:[function(require,module,exports){
'use strict';

var work = require('webworkify'),
    OpenCtmError = require('./../openctmerror'),

    MG2_MAGIC            = 0x4832474D,
    MG2_VERTEX_MAGIC     = 0x54524556,
    MG2_GRID_INDEX_MAGIC = 0x58444947,
    MG2_INDEX_MAGIC      = 0x58444E49,
    MG2_NORMAL_MAGIC     = 0x4D524F4E,
    MG2_UVMAP_MAGIC      = 0x43584554,
    MG2_ATTRMAP_MAGIC    = 0x52545441,

    LZMA_PROPERTIES_SIZE = 5;

var readHeader = function(reader) {
  var identifier = reader.readInt32();

  if (identifier !== MG2_MAGIC) {
    throw new OpenCtmError('Cannot read MG2 header');
  }

  return {
    identifier:      identifier,
    vertexPrecision: reader.readFloat32(),
    normalPrecision: reader.readFloat32(),
    lowerBoundX:     reader.readFloat32(),
    lowerBoundY:     reader.readFloat32(),
    lowerBoundZ:     reader.readFloat32(),
    higherBoundX:    reader.readFloat32(),
    higherBoundY:    reader.readFloat32(),
    higherBoundZ:    reader.readFloat32(),
    gridDivX:        reader.readInt32(),
    gridDivY:        reader.readInt32(),
    gridDivZ:        reader.readInt32()
  };
};

var decodeBody = function(ctmHeader, reader) {
  var mg2Header = readHeader(reader),
      uvMaps = [],
      attrMaps = [],
      sectionIdentifier,
      packedSize,
      rawVertices,
      gridIndices,
      vertices,
      indices,
      rawNormals,
      normals,
      options,
      currentOffset;

  while (!reader.eof()) {
    sectionIdentifier = reader.readInt32();

    switch (sectionIdentifier) {
      case MG2_VERTEX_MAGIC:
        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        rawVertices = readRawVertices(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize));
        break;
      case MG2_GRID_INDEX_MAGIC:
        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        gridIndices = readGridIndices(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize));
        break;
      case MG2_INDEX_MAGIC:
        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        indices = readIndices(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize));
        break;
      case MG2_NORMAL_MAGIC:
        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        rawNormals = readNormals(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize));
        break;
      case MG2_UVMAP_MAGIC:
        options = {
          name: reader.readString(),
          filename: reader.readString(),
          precision: reader.readFloat32()
        };

        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        uvMaps.push(readUvMap(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize), options));
        break;
      case MG2_ATTRMAP_MAGIC:
        options = {
          name: reader.readString(),
          precision: reader.readFloat32()
        };

        packedSize = reader.readInt32();
        currentOffset = reader.offset();
        attrMaps.push(readAttrMap(ctmHeader, reader.buffer.slice(currentOffset, currentOffset + LZMA_PROPERTIES_SIZE + packedSize), options));
        break;
      default:
        throw new OpenCtmError("Unknown section: " + sectionIdentifier.toString(16));
        break;
    }

    reader.ignore(packedSize + LZMA_PROPERTIES_SIZE);
  }

  vertices = Promise.all([rawVertices, gridIndices])
    .then(function(result) {
      return restoreVertices(mg2Header, result[0], result[1]);
    });

  if (rawNormals) {
    normals = Promise.all([rawNormals, vertices, indices])
      .then(function (result) {
        return restoreNormals(result[0], calcSmoothNormals(result[2], result[1]), mg2Header.normalPrecision);
      });
  } else {
    normals = Promise.resolve(null);
  }

  return Promise.all([vertices, indices, normals, Promise.all(uvMaps), Promise.all(attrMaps)])
    .then(function(result) {
      var body = {
        vertices: result[0],
        indices: result[1],
        uvMaps: result[3],
        attrMaps: result[4]
      };

      if (result[2]) {
        body.normals = result[2];
      }

      return body;
    });
};

var decompress = function(buffer, decompressedSize, stride) {
  return new Promise(function(resolve, reject) {
    var worker = work(require('./../decompress-worker.js'));

    worker.addEventListener('message', function(event) {
      resolve(event.data);
    });

    worker.addEventListener('error', function(event) {
      reject(event);
    });

    worker.postMessage({ buffer: buffer, decompressedSize: decompressedSize, stride: stride });
  });
};

var readRawVertices = function(ctmHeader, buffer) {
  return decompress(buffer, ctmHeader.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT, 3)
    .then(function(decompressedBuffer) {
      return new Float32Array(decompressedBuffer);
    });
};

var readGridIndices = function(ctmHeader, buffer) {
  return decompress(buffer, ctmHeader.vertexCount * Uint32Array.BYTES_PER_ELEMENT, 1)
    .then(function(decompressedBuffer) {
      var gridIndices = new Uint32Array(decompressedBuffer),
          i;

      for (i = 1; i < gridIndices.length; i++) {
        gridIndices[i] += gridIndices[i - 1];
      }

      return gridIndices;
    });
};

var restoreVertices = function(mg2Header, rawVertices, gridIndices) {
  var intVertices = new Uint32Array(rawVertices.buffer, rawVertices.byteOffset, rawVertices.length),
      gridDivY = mg2Header.gridDivX,
      gridDivZ = gridDivY * mg2Header.gridDivY,
      sizeX = (mg2Header.higherBoundX - mg2Header.lowerBoundX) / mg2Header.gridDivX,
      sizeY = (mg2Header.higherBoundY - mg2Header.lowerBoundY) / mg2Header.gridDivY,
      sizeZ = (mg2Header.higherBoundZ - mg2Header.lowerBoundZ) / mg2Header.gridDivZ,
      prevGridIdx = 0x7fffffff,
      prevDelta = 0,
      x, y, z,
      i, j,
      gridIdx,
      delta;

  for (i = 0, j = 0; i < gridIndices.length; j += 3){
    x = gridIdx = gridIndices[i++];

    z = ~~(x / gridDivZ);
    x -= ~~(z * gridDivZ);
    y = ~~(x / gridDivY);
    x -= ~~(y * gridDivY);

    delta = intVertices[j];

    if (gridIdx === prevGridIdx){
      delta += prevDelta;
    }

    rawVertices[j]     = mg2Header.lowerBoundX + x * sizeX + mg2Header.vertexPrecision * delta;
    rawVertices[j + 1] = mg2Header.lowerBoundY + y * sizeY + mg2Header.vertexPrecision * intVertices[j + 1];
    rawVertices[j + 2] = mg2Header.lowerBoundZ + z * sizeZ + mg2Header.vertexPrecision * intVertices[j + 2];

    prevGridIdx = gridIdx;
    prevDelta = delta;
  }

  return rawVertices;
};

var readIndices = function(ctmHeader, buffer) {
  return decompress(buffer, ctmHeader.triangleCount * 3 * Uint32Array.BYTES_PER_ELEMENT, 3)
    .then(function(decompressedBuffer) {
      var indices = new Uint32Array(decompressedBuffer),
          i;

      if (indices.length > 0){
        indices[2] += indices[0];
        indices[1] += indices[0];
      }

      for (i = 3; i < indices.length; i += 3){
        indices[i] += indices[i - 3];

        if (indices[i] === indices[i - 3]) {
          indices[i + 1] += indices[i - 2];
        } else {
          indices[i + 1] += indices[i];
        }

        indices[i + 2] += indices[i];
      }

      return indices;
    });
};

var readNormals = function(ctmHeader, buffer) {
  return decompress(buffer, ctmHeader.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT, 3)
    .then(function(decompressedBuffer) {
      return new Float32Array(decompressedBuffer);
    });
};

var calcSmoothNormals = function(indices, vertices){
  var smooth = new Float32Array(vertices.length),
      indx, indy, indz,
      nx, ny, nz,
      v1x, v1y, v1z,
      v2x, v2y, v2z,
      length,
      i, k;

  for (i = 0, k = indices.length; i < k;){
    indx = indices[i++] * 3;
    indy = indices[i++] * 3;
    indz = indices[i++] * 3;

    v1x = vertices[indy]     - vertices[indx];
    v2x = vertices[indz]     - vertices[indx];
    v1y = vertices[indy + 1] - vertices[indx + 1];
    v2y = vertices[indz + 1] - vertices[indx + 1];
    v1z = vertices[indy + 2] - vertices[indx + 2];
    v2z = vertices[indz + 2] - vertices[indx + 2];

    nx = v1y * v2z - v1z * v2y;
    ny = v1z * v2x - v1x * v2z;
    nz = v1x * v2y - v1y * v2x;

    length = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (length > 1e-10) {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    smooth[indx]     += nx;
    smooth[indx + 1] += ny;
    smooth[indx + 2] += nz;
    smooth[indy]     += nx;
    smooth[indy + 1] += ny;
    smooth[indy + 2] += nz;
    smooth[indz]     += nx;
    smooth[indz + 1] += ny;
    smooth[indz + 2] += nz;
  }

  for (i = 0, k = smooth.length; i < k; i += 3) {
    length = Math.sqrt(smooth[i] * smooth[i] + smooth[i + 1] * smooth[i + 1] + smooth[i + 2] * smooth[i + 2]);

    if(length > 1e-10) {
      smooth[i]     /= length;
      smooth[i + 1] /= length;
      smooth[i + 2] /= length;
    }
  }

  return smooth;
};

var restoreNormals = function(normals, smooth, precision) {
  var PI_DIV_2 = 3.141592653589793238462643 * 0.5,
      intNormals = new Uint32Array(normals.buffer, normals.byteOffset, normals.length),
      ro,
      phi,
      theta,
      sinPhi,
      nx, ny, nz,
      by, bz,
      length,
      i;

  for (i = 0; i < normals.length; i += 3) {
    ro = intNormals[i] * precision;
    phi = intNormals[i + 1];

    if (phi === 0) {
      normals[i]     = smooth[i]     * ro;
      normals[i + 1] = smooth[i + 1] * ro;
      normals[i + 2] = smooth[i + 2] * ro;
    } else {
      if (phi <= 4) {
        theta = (intNormals[i + 2] - 2) * PI_DIV_2;
      } else {
        theta = ( (intNormals[i + 2] * 4 / phi) - 2) * PI_DIV_2;
      }

      phi *= precision * PI_DIV_2;
      sinPhi = ro * Math.sin(phi);

      nx = sinPhi * Math.cos(theta);
      ny = sinPhi * Math.sin(theta);
      nz = ro * Math.cos(phi);

      bz = smooth[i + 1];
      by = smooth[i] - smooth[i + 2];

      length = Math.sqrt(2 * bz * bz + by * by);

      if (length > 1e-20) {
        by /= length;
        bz /= length;
      }

      normals[i]     = smooth[i]     * nz + (smooth[i + 1] * bz - smooth[i + 2] * by) * ny - bz * nx;
      normals[i + 1] = smooth[i + 1] * nz - (smooth[i + 2]      + smooth[i]   ) * bz  * ny + by * nx;
      normals[i + 2] = smooth[i + 2] * nz + (smooth[i]     * by + smooth[i + 1] * bz) * ny + bz * nx;
    }
  }

  return normals;
};

var readUvMap = function(ctmHeader, buffer, info) {
  return decompress(buffer, ctmHeader.vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT, 2)
    .then(function(decompressedBuffer) {
      var uvMap = new Float32Array(decompressedBuffer);

      restoreMap(uvMap, 2, info.precision);

      return {
        uv: uvMap,
        name: info.name,
        filename: info.filename,
        precision: info.precision
      };
    });
};

var readAttrMap = function(ctmHeader, buffer, info) {
  return decompress(buffer, ctmHeader.vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT, 4)
    .then(function(decompressedBuffer) {
      var attrMap = new Float32Array(decompressedBuffer);

      restoreMap(attrMap, 4, info.precision);

      return {
        attr: attrMap,
        name: info.name
      };
    });
};

var restoreMap = function(map, count, precision){
  var intMap = new Uint32Array(map.buffer, map.byteOffset, map.length),
      delta,
      value,
      i, j;

  for (i = 0; i < count; ++ i) {
    delta = 0;

    for (j = i; j < map.length; j += count) {
      value = intMap[j];

      delta += value & 1? -((value + 1) >> 1): value >> 1;

      map[j] = delta * precision;
    }
  }
};

module.exports = {
  decodeBody: decodeBody
};

},{"./../decompress-worker.js":3,"./../openctmerror":6,"webworkify":1}],3:[function(require,module,exports){
'use strict';

var LZMA = require('./vendor/lzma'),
    StreamReader = require('./streamreader'),
    InterleavedStreamWriter = require('./interleaved-streamwriter');

module.exports = function(self) {

  self.addEventListener('message', function (event) {
    var reader = new StreamReader(event.data.buffer, 0),
        writer = new InterleavedStreamWriter(new ArrayBuffer(event.data.decompressedSize), event.data.stride);

    LZMA.decompress(reader, reader, writer, writer.buffer.byteLength);
    self.postMessage(writer.buffer);
  });

};
},{"./interleaved-streamwriter":5,"./streamreader":7,"./vendor/lzma":8}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
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

},{"./endian":4}],6:[function(require,module,exports){
'use strict';

function OpenCtmError(message) {
  this.name = 'OpenCtmError';
  this.message = message || 'Unknown OpenCTM Error';
}

OpenCtmError.prototype = Object.create(Error.prototype);
OpenCtmError.prototype.constructor = OpenCtmError;

module.exports = OpenCtmError;

},{}],7:[function(require,module,exports){
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

},{}],8:[function(require,module,exports){
var LZMA = LZMA || {};

LZMA.OutWindow = function(){
  this._windowSize = 0;
};

LZMA.OutWindow.prototype.create = function(windowSize){
  if ( (!this._buffer) || (this._windowSize !== windowSize) ){
    this._buffer = [];
  }
  this._windowSize = windowSize;
  this._pos = 0;
  this._streamPos = 0;
};

LZMA.OutWindow.prototype.flush = function(){
  var size = this._pos - this._streamPos;
  if (size !== 0){
    while(size --){
      this._stream.writeByte(this._buffer[this._streamPos ++]);
    }
    if (this._pos >= this._windowSize){
      this._pos = 0;
    }
    this._streamPos = this._pos;
  }
};

LZMA.OutWindow.prototype.releaseStream = function(){
  this.flush();
  this._stream = null;
};

LZMA.OutWindow.prototype.setStream = function(stream){
  this.releaseStream();
  this._stream = stream;
};

LZMA.OutWindow.prototype.init = function(solid){
  if (!solid){
    this._streamPos = 0;
    this._pos = 0;
  }
};

LZMA.OutWindow.prototype.copyBlock = function(distance, len){
  var pos = this._pos - distance - 1;
  if (pos < 0){
    pos += this._windowSize;
  }
  while(len --){
    if (pos >= this._windowSize){
      pos = 0;
    }
    this._buffer[this._pos ++] = this._buffer[pos ++];
    if (this._pos >= this._windowSize){
      this.flush();
    }
  }
};

LZMA.OutWindow.prototype.putByte = function(b){
  this._buffer[this._pos ++] = b;
  if (this._pos >= this._windowSize){
    this.flush();
  }
};

LZMA.OutWindow.prototype.getByte = function(distance){
  var pos = this._pos - distance - 1;
  if (pos < 0){
    pos += this._windowSize;
  }
  return this._buffer[pos];
};

LZMA.RangeDecoder = function(){
};

LZMA.RangeDecoder.prototype.setStream = function(stream){
  this._stream = stream;
};

LZMA.RangeDecoder.prototype.releaseStream = function(){
  this._stream = null;
};

LZMA.RangeDecoder.prototype.init = function(){
  var i = 5;

  this._code = 0;
  this._range = -1;
  
  while(i --){
    this._code = (this._code << 8) | this._stream.readByte();
  }
};

LZMA.RangeDecoder.prototype.decodeDirectBits = function(numTotalBits){
  var result = 0, i = numTotalBits, t;

  while(i --){
    this._range >>>= 1;
    t = (this._code - this._range) >>> 31;
    this._code -= this._range & (t - 1);
    result = (result << 1) | (1 - t);

    if ( (this._range & 0xff000000) === 0){
      this._code = (this._code << 8) | this._stream.readByte();
      this._range <<= 8;
    }
  }

  return result;
};

LZMA.RangeDecoder.prototype.decodeBit = function(probs, index){
  var prob = probs[index],
      newBound = (this._range >>> 11) * prob;

  if ( (this._code ^ 0x80000000) < (newBound ^ 0x80000000) ){
    this._range = newBound;
    probs[index] += (2048 - prob) >>> 5;
    if ( (this._range & 0xff000000) === 0){
      this._code = (this._code << 8) | this._stream.readByte();
      this._range <<= 8;
    }
    return 0;
  }

  this._range -= newBound;
  this._code -= newBound;
  probs[index] -= prob >>> 5;
  if ( (this._range & 0xff000000) === 0){
    this._code = (this._code << 8) | this._stream.readByte();
    this._range <<= 8;
  }
  return 1;
};

LZMA.initBitModels = function(probs, len){
  while(len --){
    probs[len] = 1024;
  }
};

LZMA.BitTreeDecoder = function(numBitLevels){
  this._models = [];
  this._numBitLevels = numBitLevels;
};

LZMA.BitTreeDecoder.prototype.init = function(){
  LZMA.initBitModels(this._models, 1 << this._numBitLevels);
};

LZMA.BitTreeDecoder.prototype.decode = function(rangeDecoder){
  var m = 1, i = this._numBitLevels;

  while(i --){
    m = (m << 1) | rangeDecoder.decodeBit(this._models, m);
  }
  return m - (1 << this._numBitLevels);
};

LZMA.BitTreeDecoder.prototype.reverseDecode = function(rangeDecoder){
  var m = 1, symbol = 0, i = 0, bit;

  for (; i < this._numBitLevels; ++ i){
    bit = rangeDecoder.decodeBit(this._models, m);
    m = (m << 1) | bit;
    symbol |= bit << i;
  }
  return symbol;
};

LZMA.reverseDecode2 = function(models, startIndex, rangeDecoder, numBitLevels){
  var m = 1, symbol = 0, i = 0, bit;

  for (; i < numBitLevels; ++ i){
    bit = rangeDecoder.decodeBit(models, startIndex + m);
    m = (m << 1) | bit;
    symbol |= bit << i;
  }
  return symbol;
};

LZMA.LenDecoder = function(){
  this._choice = [];
  this._lowCoder = [];
  this._midCoder = [];
  this._highCoder = new LZMA.BitTreeDecoder(8);
  this._numPosStates = 0;
};

LZMA.LenDecoder.prototype.create = function(numPosStates){
  for (; this._numPosStates < numPosStates; ++ this._numPosStates){
    this._lowCoder[this._numPosStates] = new LZMA.BitTreeDecoder(3);
    this._midCoder[this._numPosStates] = new LZMA.BitTreeDecoder(3);
  }
};

LZMA.LenDecoder.prototype.init = function(){
  var i = this._numPosStates;
  LZMA.initBitModels(this._choice, 2);
  while(i --){
    this._lowCoder[i].init();
    this._midCoder[i].init();
  }
  this._highCoder.init();
};

LZMA.LenDecoder.prototype.decode = function(rangeDecoder, posState){
  if (rangeDecoder.decodeBit(this._choice, 0) === 0){
    return this._lowCoder[posState].decode(rangeDecoder);
  }
  if (rangeDecoder.decodeBit(this._choice, 1) === 0){
    return 8 + this._midCoder[posState].decode(rangeDecoder);
  }
  return 16 + this._highCoder.decode(rangeDecoder);
};

LZMA.Decoder2 = function(){
  this._decoders = [];
};

LZMA.Decoder2.prototype.init = function(){
  LZMA.initBitModels(this._decoders, 0x300);
};

LZMA.Decoder2.prototype.decodeNormal = function(rangeDecoder){
  var symbol = 1;

  do{
    symbol = (symbol << 1) | rangeDecoder.decodeBit(this._decoders, symbol);
  }while(symbol < 0x100);

  return symbol & 0xff;
};

LZMA.Decoder2.prototype.decodeWithMatchByte = function(rangeDecoder, matchByte){
  var symbol = 1, matchBit, bit;

  do{
    matchBit = (matchByte >> 7) & 1;
    matchByte <<= 1;
    bit = rangeDecoder.decodeBit(this._decoders, ( (1 + matchBit) << 8) + symbol);
    symbol = (symbol << 1) | bit;
    if (matchBit !== bit){
      while(symbol < 0x100){
        symbol = (symbol << 1) | rangeDecoder.decodeBit(this._decoders, symbol);
      }
      break;
    }
  }while(symbol < 0x100);

  return symbol & 0xff;
};

LZMA.LiteralDecoder = function(){
};

LZMA.LiteralDecoder.prototype.create = function(numPosBits, numPrevBits){
  var i;

  if (this._coders
    && (this._numPrevBits === numPrevBits)
    && (this._numPosBits === numPosBits) ){
    return;
  }
  this._numPosBits = numPosBits;
  this._posMask = (1 << numPosBits) - 1;
  this._numPrevBits = numPrevBits;

  this._coders = [];

  i = 1 << (this._numPrevBits + this._numPosBits);
  while(i --){
    this._coders[i] = new LZMA.Decoder2();
  }
};

LZMA.LiteralDecoder.prototype.init = function(){
  var i = 1 << (this._numPrevBits + this._numPosBits);
  while(i --){
    this._coders[i].init();
  }
};

LZMA.LiteralDecoder.prototype.getDecoder = function(pos, prevByte){
  return this._coders[( (pos & this._posMask) << this._numPrevBits)
    + ( (prevByte & 0xff) >>> (8 - this._numPrevBits) )];
};

LZMA.Decoder = function(){
  this._outWindow = new LZMA.OutWindow();
  this._rangeDecoder = new LZMA.RangeDecoder();
  this._isMatchDecoders = [];
  this._isRepDecoders = [];
  this._isRepG0Decoders = [];
  this._isRepG1Decoders = [];
  this._isRepG2Decoders = [];
  this._isRep0LongDecoders = [];
  this._posSlotDecoder = [];
  this._posDecoders = [];
  this._posAlignDecoder = new LZMA.BitTreeDecoder(4);
  this._lenDecoder = new LZMA.LenDecoder();
  this._repLenDecoder = new LZMA.LenDecoder();
  this._literalDecoder = new LZMA.LiteralDecoder();
  this._dictionarySize = -1;
  this._dictionarySizeCheck = -1;

  this._posSlotDecoder[0] = new LZMA.BitTreeDecoder(6);
  this._posSlotDecoder[1] = new LZMA.BitTreeDecoder(6);
  this._posSlotDecoder[2] = new LZMA.BitTreeDecoder(6);
  this._posSlotDecoder[3] = new LZMA.BitTreeDecoder(6);
};

LZMA.Decoder.prototype.setDictionarySize = function(dictionarySize){
  if (dictionarySize < 0){
    return false;
  }
  if (this._dictionarySize !== dictionarySize){
    this._dictionarySize = dictionarySize;
    this._dictionarySizeCheck = Math.max(this._dictionarySize, 1);
    this._outWindow.create( Math.max(this._dictionarySizeCheck, 4096) );
  }
  return true;
};

LZMA.Decoder.prototype.setLcLpPb = function(lc, lp, pb){
  var numPosStates = 1 << pb;

  if (lc > 8 || lp > 4 || pb > 4){
    return false;
  }

  this._literalDecoder.create(lp, lc);

  this._lenDecoder.create(numPosStates);
  this._repLenDecoder.create(numPosStates);
  this._posStateMask = numPosStates - 1;

  return true;
};

LZMA.Decoder.prototype.init = function(){
  var i = 4;

  this._outWindow.init(false);

  LZMA.initBitModels(this._isMatchDecoders, 192);
  LZMA.initBitModels(this._isRep0LongDecoders, 192);
  LZMA.initBitModels(this._isRepDecoders, 12);
  LZMA.initBitModels(this._isRepG0Decoders, 12);
  LZMA.initBitModels(this._isRepG1Decoders, 12);
  LZMA.initBitModels(this._isRepG2Decoders, 12);
  LZMA.initBitModels(this._posDecoders, 114);

  this._literalDecoder.init();

  while(i --){
    this._posSlotDecoder[i].init();
  }

  this._lenDecoder.init();
  this._repLenDecoder.init();
  this._posAlignDecoder.init();
  this._rangeDecoder.init();
};

LZMA.Decoder.prototype.decode = function(inStream, outStream, outSize){
  var state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, nowPos64 = 0, prevByte = 0,
      posState, decoder2, len, distance, posSlot, numDirectBits;

  this._rangeDecoder.setStream(inStream);
  this._outWindow.setStream(outStream);

  this.init();

  while(outSize < 0 || nowPos64 < outSize){
    posState = nowPos64 & this._posStateMask;

    if (this._rangeDecoder.decodeBit(this._isMatchDecoders, (state << 4) + posState) === 0){
      decoder2 = this._literalDecoder.getDecoder(nowPos64 ++, prevByte);

      if (state >= 7){
        prevByte = decoder2.decodeWithMatchByte(this._rangeDecoder, this._outWindow.getByte(rep0) );
      }else{
        prevByte = decoder2.decodeNormal(this._rangeDecoder);
      }
      this._outWindow.putByte(prevByte);

      state = state < 4? 0: state - (state < 10? 3: 6);

    }else{

      if (this._rangeDecoder.decodeBit(this._isRepDecoders, state) === 1){
        len = 0;
        if (this._rangeDecoder.decodeBit(this._isRepG0Decoders, state) === 0){
          if (this._rangeDecoder.decodeBit(this._isRep0LongDecoders, (state << 4) + posState) === 0){
            state = state < 7? 9: 11;
            len = 1;
          }
        }else{
          if (this._rangeDecoder.decodeBit(this._isRepG1Decoders, state) === 0){
            distance = rep1;
          }else{
            if (this._rangeDecoder.decodeBit(this._isRepG2Decoders, state) === 0){
              distance = rep2;
            }else{
              distance = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = distance;
        }
        if (len === 0){
          len = 2 + this._repLenDecoder.decode(this._rangeDecoder, posState);
          state = state < 7? 8: 11;
        }
      }else{
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;

        len = 2 + this._lenDecoder.decode(this._rangeDecoder, posState);
        state = state < 7? 7: 10;

        posSlot = this._posSlotDecoder[len <= 5? len - 2: 3].decode(this._rangeDecoder);
        if (posSlot >= 4){

          numDirectBits = (posSlot >> 1) - 1;
          rep0 = (2 | (posSlot & 1) ) << numDirectBits;

          if (posSlot < 14){
            rep0 += LZMA.reverseDecode2(this._posDecoders,
                rep0 - posSlot - 1, this._rangeDecoder, numDirectBits);
          }else{
            rep0 += this._rangeDecoder.decodeDirectBits(numDirectBits - 4) << 4;
            rep0 += this._posAlignDecoder.reverseDecode(this._rangeDecoder);
            if (rep0 < 0){
              if (rep0 === -1){
                break;
              }
              return false;
            }
          }
        }else{
          rep0 = posSlot;
        }
      }

      if (rep0 >= nowPos64 || rep0 >= this._dictionarySizeCheck){
        return false;
      }

      this._outWindow.copyBlock(rep0, len);
      nowPos64 += len;
      prevByte = this._outWindow.getByte(0);
    }
  }

  this._outWindow.flush();
  this._outWindow.releaseStream();
  this._rangeDecoder.releaseStream();

  return true;
};

LZMA.Decoder.prototype.setDecoderProperties = function(properties){
  var value, lc, lp, pb, dictionarySize;

  if (properties.size < 5){
    return false;
  }

  value = properties.readByte();
  lc = value % 9;
  value = ~~(value / 9);
  lp = value % 5;
  pb = ~~(value / 5);

  if ( !this.setLcLpPb(lc, lp, pb) ){
    return false;
  }

  dictionarySize = properties.readByte();
  dictionarySize |= properties.readByte() << 8;
  dictionarySize |= properties.readByte() << 16;
  dictionarySize += properties.readByte() * 16777216;

  return this.setDictionarySize(dictionarySize);
};

LZMA.decompress = function(properties, inStream, outStream, outSize){
  var decoder = new LZMA.Decoder();

  if ( !decoder.setDecoderProperties(properties) ){
    throw "Incorrect stream properties";
  }

  if ( !decoder.decode(inStream, outStream, outSize) ){
    throw "Error in data stream";
  }

  return true;
};

module.exports = LZMA;

},{}],9:[function(require,module,exports){
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

},{"./lib/decoders/mg2":2,"./lib/openctmerror":6,"./lib/streamreader":7}]},{},[9])(9)
});