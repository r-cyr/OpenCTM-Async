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
