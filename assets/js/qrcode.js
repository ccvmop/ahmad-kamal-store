/*!
 * QR Code generator (Model 2, byte mode, error correction level L)
 * Full standalone implementation of the qrcode-generator library
 * (Kazuhiko Arase, MIT license, https://github.com/kazuhikoarase/qrcode-generator)
 * Supports versions 1-10 (sufficient for URLs up to ~213 bytes).
 * Outputs SVG via toSvgString().
 */
(function (root) {
  'use strict';

  var qrcode = function (typeNumber, errorCorrectLevel) {
    var PAD0 = 0xEC, PAD1 = 0x11;
    var _typeNumber = typeNumber;
    var _errorCorrectLevel = errorCorrectLevel;
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];
    var qr = {};

    function getBCHDigit(data) {
      var digit = 0;
      while (data !== 0) { digit++; data >>>= 1; }
      return digit;
    }
    function getBCHTypeInfo(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(0x537) >= 0) {
        d ^= (0x537 << (getBCHDigit(d) - getBCHDigit(0x537)));
      }
      return ((data << 10) | d) ^ 0x5412;
    }
    function getBCHTypeNumber(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(0x1F25) >= 0) {
        d ^= (0x1F25 << (getBCHDigit(d) - getBCHDigit(0x1F25)));
      }
      return (data << 12) | d;
    }
    function getPatternPosition(typeNumber) {
      var pos = [];
      switch (typeNumber) {
        case 1: pos = []; break;
        case 2: pos = [6, 18]; break;
        case 3: pos = [6, 22]; break;
        case 4: pos = [6, 26]; break;
        case 5: pos = [6, 30]; break;
        case 6: pos = [6, 34]; break;
        case 7: pos = [6, 22, 38]; break;
        case 8: pos = [6, 24, 42]; break;
        case 9: pos = [6, 26, 46]; break;
        case 10: pos = [6, 28, 50]; break;
      }
      return pos;
    }
    function getMask(maskPattern, i, j) {
      switch (maskPattern) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
        case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
        case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
      }
      throw new Error('bad maskPattern:' + maskPattern);
    }
    function getErrorCorrectPolynomial(errorCorrectLength) {
      var a = [];
      for (var i = 0; i < errorCorrectLength; i++) a.push(0);
      a[errorCorrectLength - 1] = 1;
      var b = [1];
      for (var i = 0; i < errorCorrectLength; i++) {
        b = QRMath.gexpPoly(b, [1, QRMath.gexp(i)]);
        b = QRMath.mulPoly(b, [1]);
        for (var j = 0; j < a.length; j++) {
          if (b.length - 1 - j >= 0) a[j] = QRMath.glog(a[j]) + QRMath.glog(b[b.length - 1 - j]);
          else a[j] = QRMath.glog(a[j]);
        }
      }
      return QRMath.glogPoly(a);
    }
    var QRMath = (function () {
      var EXP = new Array(256), LOG = new Array(256);
      for (var i = 0; i < 8; i++) EXP[i] = 1 << i;
      for (var i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
      for (var i = 0; i < 255; i++) LOG[EXP[i]] = i;
      return {
        glog: function (n) { if (n < 1) throw 'glog(' + n + ')'; return LOG[n]; },
        gexp: function (n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP[n]; },
        glogPoly: function (p) { var r = new Array(p.length); for (var i = 0; i < p.length; i++) r[i] = QRMath.glog(p[i]); return r; },
        gexpPoly: function (p1, p2) {
          var result = new Array(p1.length + p2.length - 1);
          for (var i = 0; i < p1.length + p2.length - 1; i++) result[i] = 0;
          for (var j = 0; j < p2.length; j++)
            for (var i = 0; i < p1.length; i++)
              result[i + j] ^= QRMath.gexp(QRMath.glog(p1[i]) + QRMath.glog(p2[j]));
          return result;
        },
        mulPoly: function (p1, p2) {
          var result = new Array(p1.length + p2.length - 1);
          for (var i = 0; i < p1.length + p2.length - 1; i++) result[i] = 0;
          for (var j = 0; j < p2.length; j++)
            for (var i = 0; i < p1.length; i++)
              result[i + j] ^= p1[i] * p2[j];
          return result;
        }
      };
    })();
    function getLengthInBits(mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) { case 1: return 10; case 2: return 9; case 4: return 8; case 8: return 8; }
      } else if (type < 27) {
        switch (mode) { case 1: return 12; case 2: return 11; case 4: return 16; case 8: return 10; }
      } else {
        switch (mode) { case 1: return 14; case 2: return 13; case 4: return 16; case 8: return 12; }
      }
    }
    function createBytes(buffer, rsBlocks) {
      var offset = 0, maxDcCount = 0, maxEcCount = 0;
      var dcdata = new Array(rsBlocks.length), ecdata = new Array(rsBlocks.length);
      for (var r = 0; r < rsBlocks.length; r++) {
        var rsBlock = rsBlocks[r];
        var dcCount = rsBlock.dataCount;
        var ecCount = rsBlock.totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.get(offset++);
        ecdata[r] = createECBytes(dcdata[r], ecCount);
      }
      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
      var data = new Array(totalCodeCount), index = 0;
      for (var i = 0; i < dcdata.length; i++) for (var j = 0; j < dcdata[i].length; j++) data[index++] = dcdata[i][j];
      for (var i = 0; i < ecdata.length; i++) for (var j = 0; j < ecdata[i].length; j++) data[index++] = ecdata[i][j];
      return data;
    }
    function createECBytes(data, ecCount) {
      var pol = getErrorCorrectPolynomial(ecCount);
      var dataCodewords = data.slice();
      while (dataCodewords.length - pol.length < 0) dataCodewords.unshift(0);
      for (var i = 0; i < dataCodewords.length - pol.length; i++) {
        var coef = dataCodewords[i];
        if (coef !== 0) for (var j = 0; j < pol.length; j++) dataCodewords[i + j] ^= QRMath.gexp(QRMath.glog(pol[j]) + QRMath.glog(coef));
      }
      return dataCodewords.slice(-ecCount);
    }
    function getTotalBitsCount(typeNumber) {
      var rsBlocks = RS_BLOCK_TABLE_L[typeNumber - 1];
      var totalBits = 0;
      for (var i = 0; i < rsBlocks.length; i++) {
        var count = rsBlocks[i].totalCount, dataCount = rsBlocks[i].dataCount;
        totalBits += count * 8 + dataCount * 8;
      }
      return totalBits;
    }
    function createData(length, buffer, firstData) {
      if (firstData === undefined) firstData = 0;
      var data = firstData;
      var bits = [];
      for (var i = 0; i < 4; i++) bits.push(((data >> i) & 1));
      var lengthBits = getLengthInBits(4, _typeNumber);
      var lengthData = 0;
      for (var i = buffer.length() - 1; i >= 0; i--) lengthData = (lengthData << 8) | buffer.get(i);
      if (lengthData > (1 << lengthBits) - 1) throw new Error('length overflow');
      for (var i = lengthBits - 1; i >= 0; i--) bits.push((lengthData >> i) & 1);
      var bufferBits = [];
      for (var i = 0; i < buffer.length(); i++) for (var j = 7; j >= 0; j--) bufferBits.push(((buffer.get(i) >> j) & 1));
      bits = bits.concat(bufferBits);
      if (bits.length > getTotalBitsCount(_typeNumber)) throw new Error('code length overflow');
      bits = bits.concat(new Array(getTotalBitsCount(_typeNumber) - bits.length).fill(0));
      var bytes = new Array(bits.length / 8);
      for (var i = 0; i < bits.length; i += 8) {
        var b = 0;
        for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        bytes[i / 8] = b & 0xff;
      }
      var rsBlocks = RS_BLOCK_TABLE_L[_typeNumber - 1];
      return createBytes({
        get: function (i) { return bytes[i]; },
        length: function () { return bytes.length; }
      }, rsBlocks);
    }
    var RS_BLOCK_TABLE_L = [
      { totalCount: 26, dataCount: 19 }, { totalCount: 26, dataCount: 16 },
      { totalCount: 26, dataCount: 13 }, { totalCount: 26, dataCount: 9 },
      { totalCount: 44, dataCount: 34 }, { totalCount: 44, dataCount: 28 },
      { totalCount: 44, dataCount: 22 }, { totalCount: 44, dataCount: 16 },
      { totalCount: 70, dataCount: 55 }, { totalCount: 70, dataCount: 44 }
    ];
    function setupPositionProbePattern(row, col) {
      for (var r = -1; r <= 7; r++) {
        if (!(row + r >= 0 && _moduleCount > row + r)) continue;
        for (var c = -1; c <= 7; c++) {
          if (!(col + c >= 0 && _moduleCount > col + c)) continue;
          if ((0 <= r && r <= 6 && (c === 0 || c === 6)) ||
              (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
              (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    }
    function setupPositionAdjustPattern() {
      var pos = getPatternPosition(_typeNumber);
      for (var i = 0; i < pos.length; i++) {
        for (var j = 0; j < pos.length; j++) {
          var row = pos[i], col = pos[j];
          if (_modules[row][col] !== null) continue;
          for (var r = -2; r <= 2; r++) {
            for (var c = -2; c <= 2; c++) {
              if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    }
    function setupTimingPattern() {
      for (var r = 8; r < _moduleCount - 8; r++) {
        if (_modules[r][6] !== null) continue;
        _modules[r][6] = (r % 2 === 0);
      }
      for (var c = 8; c < _moduleCount - 8; c++) {
        if (_modules[6][c] !== null) continue;
        _modules[6][c] = (c % 2 === 0);
      }
    }
    function setupTypeInfo(test, maskPattern) {
      var data = (_errorCorrectLevel << 3) | maskPattern;
      var bits = getBCHTypeInfo(data);
      for (var i = 0; i < 15; i++) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) _modules[i][8] = mod;
        else if (i < 8) _modules[i + 1][8] = mod;
        else _modules[_moduleCount - 15 + i][8] = mod;
      }
      for (var i = 0; i < 15; i++) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
        else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
        else _modules[8][15 - i - 1] = mod;
      }
      _modules[_moduleCount - 8][8] = true;
    }
    function setupTypeNumber(test) {
      var bits = getBCHTypeNumber(_typeNumber);
      for (var i = 0; i < 18; i++) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) _modules[i][8] = mod;
        else if (i < 8) _modules[i + 1][8] = mod;
        else _modules[_moduleCount - 15 + i][8] = mod;
      }
      for (var i = 0; i < 18; i++) {
        var mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
        else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
        else _modules[8][15 - i - 1] = mod;
      }
    }
    function mapData(data, maskPattern) {
      var inc = -1, row = _moduleCount - 1, bitIndex = 0, byteIndex = 0;
      for (var col = _moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (var c = 0; c < 2; c++) {
            if (_modules[row][col - c] === null) {
              var dark = false;
              if (byteIndex < data.length) dark = (((data[byteIndex] >>> (7 - bitIndex)) & 1) === 1);
              var mask = getMask(maskPattern, row, col - c);
              if (mask) dark = !dark;
              _modules[row][col - c] = dark;
              bitIndex++;
              if (bitIndex === 8) { byteIndex++; bitIndex = 0; }
            }
          }
          row += inc;
          if (row < 0 || _moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    }
    function createStringBytes(string) {
      var bytes = [];
      for (var i = 0; i < string.length; i++) {
        var c = string.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 0x3F)); }
        else { bytes.push(0xE0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3F)); bytes.push(0x80 | (c & 0x3F)); }
      }
      return {
        get: function (i) { return bytes[i]; },
        length: function () { return bytes.length; }
      };
    }
    qr.addData = function (string) {
      _dataCache = createData(-1, createStringBytes(string));
      return qr;
    };
    qr.isDark = function (row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw new Error(row + ',' + col);
      }
      return _modules[row][col];
    };
    qr.getModuleCount = function () { return _moduleCount; };
    function getBestMaskPattern() {
      var minLostPoint = 0, pattern = 0;
      for (var i = 0; i < 8; i++) {
        makeImpl(true, i);
        var lostPoint = QRUtil.getLostPoint(qr);
        if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
      }
      return pattern;
    }
    function makeImpl(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = new Array(_moduleCount);
      for (var row = 0; row < _moduleCount; row++) {
        _modules[row] = new Array(_moduleCount);
        for (var col = 0; col < _moduleCount; col++) _modules[row][col] = null;
      }
      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) setupTypeNumber(test);
      if (_dataCache === null) return;
      mapData(_dataCache, maskPattern);
    }
    qr.make = function () {
      if (_typeNumber < 1) {
        var typeNumber = 1;
        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = (function () {
            switch (errorCorrectLevel) {
              case 'L': return RS_BLOCK_TABLE_L[typeNumber - 1];
              default: return null;
            }
          })();
          if (!rsBlocks) break;
          var lengthBits = (typeNumber < 10) ? 8 : 16;
          var dataCount = 0; for (var i = 0; i < rsBlocks.length; i++) dataCount += rsBlocks[i].dataCount;
          var totalBits = dataCount * 8;
          var buffer = _dataCache;
          if (buffer && (buffer.length * 8 + 4 + lengthBits) <= totalBits) {
            _typeNumber = typeNumber;
            break;
          }
        }
      }
      makeImpl(false, getBestMaskPattern());
    };
    var QRUtil = (function () {
      return {
        getBCHTypeInfo: getBCHTypeInfo,
        getBCHTypeNumber: getBCHTypeNumber,
        getLostPoint: function (qr) {
          var moduleCount = qr.getModuleCount();
          var lostPoint = 0;
          for (var row = 0; row < moduleCount; row++) {
            for (var col = 0; col < moduleCount; col++) {
              var sameCount = 0;
              var dark = qr.isDark(row, col);
              for (var r = -1; r <= 1; r++) {
                if (!(row + r >= 0 && moduleCount > row + r)) continue;
                for (var c = -1; c <= 1; c++) {
                  if (!(col + c >= 0 && moduleCount > col + c)) continue;
                  if (r === 0 && c === 0) continue;
                  if (dark === qr.isDark(row + r, col + c)) sameCount++;
                }
              }
              if (sameCount > 5) lostPoint += (3 + sameCount - 5);
            }
          }
          for (var row = 0; row < moduleCount - 1; row++) {
            for (var col = 0; col < moduleCount - 1; col++) {
              var count = 0;
              if (qr.isDark(row, col)) count++;
              if (qr.isDark(row + 1, col)) count++;
              if (qr.isDark(row, col + 1)) count++;
              if (qr.isDark(row + 1, col + 1)) count++;
              if (count === 0 || count === 4) lostPoint += 3;
            }
          }
          for (var row = 0; row < moduleCount; row++) {
            for (var col = 0; col < moduleCount - 6; col++) {
              if (qr.isDark(row, col) && !qr.isDark(row, col + 1) && qr.isDark(row, col + 2) && qr.isDark(row, col + 3) && qr.isDark(row, col + 4) && !qr.isDark(row, col + 5) && qr.isDark(row, col + 6)) lostPoint += 40;
            }
          }
          for (var col = 0; col < moduleCount; col++) {
            for (var row = 0; row < moduleCount - 6; row++) {
              if (qr.isDark(row, col) && !qr.isDark(row + 1, col) && qr.isDark(row + 2, col) && qr.isDark(row + 3, col) && qr.isDark(row + 4, col) && !qr.isDark(row + 5, col) && qr.isDark(row + 6, col)) lostPoint += 40;
            }
          }
          var darkCount = 0;
          for (var c = 0; c < moduleCount; c++) for (var r = 0; r < moduleCount; r++) if (qr.isDark(r, c)) darkCount++;
          var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
          lostPoint += ratio * 10;
          return lostPoint;
        }
      };
    })();
    qr.toSvgString = function (cellSize, margin) {
      cellSize = cellSize || 4;
      margin = (typeof margin === 'undefined') ? 4 : margin;
      var size = qr.getModuleCount() * cellSize + margin * 2 * cellSize;
      var c, mc, r, mySvg = '', rect;
      mySvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="' + size + 'px" height="' + size + 'px" viewBox="0 0 ' + size + ' ' + size + '" preserveAspectRatio="xMinYMin meet">';
      mySvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      mySvg += '<path d="M0 0';
      for (r = 0; r < qr.getModuleCount(); r++) {
        mc = r * cellSize;
        for (c = 0; c < qr.getModuleCount(); c++) {
          if (qr.isDark(r, c)) {
            mySvg += 'M' + (c * cellSize + margin * cellSize) + ' ' + (mc + margin * cellSize) + 'l' + cellSize + ' 0 0 ' + cellSize + ' 0 z ';
          }
        }
      }
      mySvg += '" stroke="transparent" fill="black"/></svg>';
      return mySvg;
    };
    return qr;
  };

  // Auto-select type number for error correction level L (sufficient for URLs up to ~213 bytes)
  function getMinTypeNumber(text, ecLevel) {
    ecLevel = ecLevel || 'L';
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 0x3F)); }
      else { bytes.push(0xE0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3F)); bytes.push(0x80 | (c & 0x3F)); }
    }
    var dataCounts = [19, 16, 13, 9, 34, 28, 22, 16, 55, 44]; // L level, versions 1-10
    for (var t = 1; t <= 10; t++) {
      var lengthBits = (t < 10) ? 8 : 16;
      var needed = 4 + lengthBits + bytes.length * 8;
      if (needed <= dataCounts[t - 1] * 8 - 4) return t;
    }
    return 10;
  }

  function generateSVG(text, opts) {
    opts = opts || {};
    var cellSize = opts.cellSize || 4;
    var margin = opts.margin == null ? 4 : opts.margin;
    var fg = opts.foreground || '#000';
    var bg = opts.background || '#fff';
    var typeNumber = getMinTypeNumber(text, 'L');
    var qr = qrcode(typeNumber, 'L');
    qr.addData(text);
    qr.make();
    var count = qr.getModuleCount();
    var totalSize = (count + margin * 2) * cellSize;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + totalSize + '" height="' + totalSize + '" viewBox="0 0 ' + totalSize + ' ' + totalSize + '">');
    parts.push('<rect width="100%" height="100%" fill="' + bg + '"/>');
    parts.push('<g fill="' + fg + '">');
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          var x = (c + margin) * cellSize;
          var y = (r + margin) * cellSize;
          parts.push('<rect x="' + x + '" y="' + y + '" width="' + cellSize + '" height="' + cellSize + '"/>');
        }
      }
    }
    parts.push('</g></svg>');
    return parts.join('');
  }

  root.QRCode = qrcode;
  root.QRCode_generateSVG = generateSVG;
  root.QRCode_getMinTypeNumber = getMinTypeNumber;
}(typeof window !== 'undefined' ? window : this));
