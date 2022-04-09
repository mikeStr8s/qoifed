class QOIFEncodeError {
  constructor(message) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
  }
}

// 3x3 pixel test image
const tiny_img = new Uint8Array([
  211, 34, 205, 237, 135, 177, 211, 34, 205,
  211, 34, 205, 237, 135, 177, 211, 34, 205, 
  211, 34, 205, 237, 135, 177, 211, 34, 205
]);

const QOI_HEADER_BYTES = 14;
const QOI_END_BYTES = 8;
const QOI_INDEX_SIZE = 64;
const QOI_MAX_RUN = 62;
const QOI_OP_DIFF_LOW = -3;
const QOI_OP_DIFF_HIGH = 2;
const QOI_OP_LUMA_LOW = -9;
const QOI_OP_LUMA_HIGH = 8;
const QOI_OP_LUMA_GLOW = -33;
const QOI_OP_LUMA_GHIGH = 32;
const QOI_OP_LUMA_GREEN_BIAS = 32;
const QOI_OP_LUMA_BIAS = 8;

function encode(pixelData, description) {
  const width = description.width;
  const height = description.height;
  const channels = description.channels;
  const colorspace = description.colorspace;

  if (width < 1 || width > 4294967295) {
    throw new QOIFEncodeError('Invalid image width');
  }

  if (height < 1 || height > 4294967295) {
    throw new QOIFEncodeError('Invalid image width');
  }

  if (channels !== 3 && channels !== 4) {
    throw new QOIFEncodeError('Invalid image channels');
  }

  if (colorspace !== 0 && channels !== 1) {
    throw new QOIFEncodeError('Invalid image colorspace');
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 255;
  let pr = red;
  let pg = green;
  let pb = blue;
  let pa = alpha;

  const pixelLength = width * height * channels;
  const pixelEnd = pixelLength - channels;  // index of the final pixel
  const uncompressedMax = width * height * channels + QOI_HEADER_BYTES + QOI_END_BYTES;

  const results = new Uint8Array(uncompressedMax);
  const index = new Uint8Array(QOI_INDEX_SIZE * 4);

  let run = 0;
  let p = 0;

  // QOI magic "qoif"
  results[p++] = 0x71;
  results[p++] = 0x6F;
  results[p++] = 0x69;
  results[p++] = 0x66;

  results[p++] = width >> 24;
  results[p++] = width >> 16;
  results[p++] = width >> 8;
  results[p++] = width;

  results[p++] = height >> 24;
  results[p++] = height >> 16;
  results[p++] = height >> 8;
  results[p++] = height;

  results[p++] = channels;
  results[p++] = colorspace;

  for (let pixelIdx = 0; pixelIdx <= pixelLength; pixelIdx += channels) {
    if (channels === 4) {
      red   = pixelData[pixelIdx];
      green = pixelData[pixelIdx + 1];
      blue  = pixelData[pixelIdx + 2];
      alpha = pixelData[pixelIdx + 3];
    } else {
      red   = pixelData[pixelIdx];
      green = pixelData[pixelIdx + 1];
      blue  = pixelData[pixelIdx + 2];
    }

    if (pixelIsRepeating(red, green, blue, alpha, pr, pg, pb, pa)) {
      run++;

      // reached the max run length or reached the end of the pixel color data
      if (run === QOI_MAX_RUN || pixelIdx === pixelEnd) {
        results[p++] = encodeRun(run);
        run = 0;
      }
    } else {
      if (run > 0) {
        results[p++] = encodeRun(run);
        run = 0;
      }

      index_position = hashPixelData(red, green, blue, alpha);

      if (index[index_position] === red && index[index_position + 1] === green && index[index_position + 2] === blue && index[index_position + 3] === alpha) {
        results[p++] = index_position / 4;
      } else {
        index[index_position]     = red;
        index[index_position + 1] = green;
        index[index_position + 2] = blue;
        index[index_position + 3] = alpha;

        if (alpha === pa) {
          let dr = calculateWrappingDifference(red, pr);    // red pixel difference
          let dg = calculateWrappingDifference(green, pg);  // green pixel difference
          let db = calculateWrappingDifference(blue, pb);   // blue pixel difference

          let dr_dg = dr - dg;  // difference of red based on the difference of green
          let db_dg = db - dg;  // difference of blue based on the difference of green

          if (pixelInRange(dr, dg, db, QOI_OP_DIFF_LOW, QOI_OP_DIFF_HIGH)) {
            results[p++] = encodeDiff(dr, dg, db);
          } else if (pixelInRange(dr_dg, dg, db_dg, QOI_OP_LUMA_LOW, QOI_OP_LUMA_HIGH, QOI_OP_LUMA_GLOW, QOI_OP_LUMA_GHIGH)) {
            results[p++] = encodeLumaGreen(dg);
            results[p++] = encodeLumaRedBlue(dr_dg, db_dg);
          } else {
            results[p++] = 0b11111110;
            results[p++] = red;
            results[p++] = green;
            results[p++] = blue;
          }
        } else {
          results[p++] = 0b11111111;
          results[p++] = red;
          results[p++] = green;
          results[p++] = blue;
          results[p++] = alpha;
        }
      }
    }

    pr = red;
    pg = green;
    pb = blue;
    pa = alpha;
  }

  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 0;
  results[p++] = 1;

  return results.buffer.slice(p);
}

function decode() {
  return 'Decoding';
}

/**
 * Checks to see if the current pixel values are the same as the previous pixel
 * 
 * @param {int} red Red channel pixel value
 * @param {int} green Green channel pixel value
 * @param {int} blue Blue channel pixel value
 * @param {int} alpha Alpha channel pixel value
 * @param {int} pr Previous pixel's red channel value
 * @param {int} pg Previous pixel's green channel value
 * @param {int} pb Previous pixel's blue channel value
 * @param {int} pa Previous pixel's alpha channel value
 * @returns Boolean value; true if pixel is same as previous pixel value
 */
function pixelIsRepeating(red, green, blue, alpha, pr, pg, pb, pa) {
 return pr === red && pg === green && pb === blue && pa === alpha;
}

function pixelInRange(red, green, blue, low, high) {
  return red > low && red < high && green > low && green < high && blue > low && blue < high;
}

function pixelInRange(red, green, blue, low, high, glow, ghigh) {
  return red > low && red < high && green > glow && green < ghigh && blue > low && blue < high;
}

/**
 * Hashes pixel channels together to get an index position for the
 * seen pixels index.
 * 
 * @param {int} red Red channel pixel value
 * @param {int} green Green channel pixel value
 * @param {int} blue Blue channel pixel value
 * @param {int} alpha Alpha channel value
 * @returns Index position to store seen pixel value
 */
function hashPixelData(red, green, blue, alpha) {
  return ((red * 3 + green * 5 + blue * 7 + alpha * 11) % 64) * 4;
}

/**
 * Encode the 8-bit value for the QOI_OP_RUN "chunk"
 * 
 * @param {int} run Number of identical pixels in a row
 * @returns 8-bit QOI_OP_RUN representation
 */
function encodeRun(run) {
  return 0b11000000 | (run - 1);
}

function encodeDiff(red, green, blue) {
  return 0b01000000 | (red + 2) << 4 | (green + 2) << 2 | (blue + 2);
}

function encodeLumaGreen(green) {
  return 0b10000000 | (green + QOI_OP_LUMA_GREEN_BIAS);
}

function encodeLumaRedBlue(red, blue) {
  return 0b00000000 | (red + QOI_OP_LUMA_BIAS) << 4 | (blue + QOI_OP_LUMA_BIAS);
}

function calculateWrappingDifference(current, previous) {
  let diff = current - previous;
  return diff & 0b10000000 ? (diff - 256) % 256 : (diff + 256) % 256;
}

export { encode, decode };