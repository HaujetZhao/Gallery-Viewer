// MP3 ID3v2 文本帧解析(TIT2/TPE1/TALB 等)。搬自源码 js/id3-parser.js,纯逻辑。
// 与 thumbnail-strategies.extractAudioCover(APIC 封面)独立,不合并。

function decodeTextFrame(data, offset, size) {
  if (size <= 1) return '';
  const encoding = data[offset];
  let text = '';
  const pos = offset + 1;
  const end = offset + size;
  try {
    switch (encoding) {
      case 0: // ISO-8859-1
        for (let i = pos; i < end && data[i] !== 0; i++) text += String.fromCharCode(data[i]);
        break;
      case 1: {
        // UTF-16 with BOM
        if (pos + 1 < end) {
          const bom = (data[pos] << 8) | data[pos + 1];
          const littleEndian = bom === 0xfffe;
          let p = pos + 2;
          const chars = [];
          for (let i = p; i < end - 1; i += 2) {
            if (data[i] === 0 && data[i + 1] === 0) break;
            chars.push(littleEndian ? (data[i + 1] << 8) | data[i] : (data[i] << 8) | data[i + 1]);
          }
          text = String.fromCharCode(...chars);
        }
        break;
      }
      case 2: // UTF-16BE without BOM
        for (let i = pos; i < end - 1; i += 2) {
          if (data[i] === 0 && data[i + 1] === 0) break;
          text += String.fromCharCode((data[i] << 8) | data[i + 1]);
        }
        break;
      case 3: {
        // UTF-8
        const bytes = [];
        for (let i = pos; i < end && data[i] !== 0; i++) bytes.push(data[i]);
        text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        break;
      }
    }
  } catch (e) {
    console.error('解码文本失败:', e);
  }
  return text.trim();
}

export async function extractID3Tags(file) {
  try {
    const raw = await file.handle.getFile();
    const maxSize = Math.min(raw.size, 5 * 1024 * 1024); // 只读前 5MB
    const buf = await raw.slice(0, maxSize).arrayBuffer();
    const u8 = new Uint8Array(buf);

    // ID3v2 头: 'ID3' = 0x49 0x44 0x33
    if (!(u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33)) return null;

    const version = u8[3]; // 3=v2.3, 4=v2.4
    const tagSize =
      ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);

    const textFrames = {
      TIT2: 'title',
      TPE1: 'artist',
      TALB: 'album',
      TYER: 'year',
      TCON: 'genre',
      TPE2: 'albumArtist',
      TCOM: 'composer',
      TRCK: 'track',
      TPOS: 'disc',
      COMM: 'comment',
    };

    const tags = {};
    let offset = 10;
    const tagEnd = 10 + tagSize;
    while (offset < tagEnd - 10) {
      const frameId = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
      if (frameId === '\0\0\0\0') break;
      let frameSize;
      if (version === 4) {
        frameSize =
          ((u8[offset + 4] & 0x7f) << 21) |
          ((u8[offset + 5] & 0x7f) << 14) |
          ((u8[offset + 6] & 0x7f) << 7) |
          (u8[offset + 7] & 0x7f);
      } else {
        frameSize = (u8[offset + 4] << 24) | (u8[offset + 5] << 16) | (u8[offset + 6] << 8) | u8[offset + 7];
      }
      if (textFrames[frameId]) {
        const text = decodeTextFrame(u8, offset + 10, frameSize);
        if (text) tags[textFrames[frameId]] = text;
      }
      offset += 10 + frameSize;
    }
    return tags;
  } catch (e) {
    console.error('解析 ID3 标签失败:', e);
    return null;
  }
}
