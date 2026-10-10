/* ZIP 编码及目录写入核对；不操作页面或生成整理规则。 */
(() => {
  // Uncompressed ZIP keeps exports dependency-free and readable by standard unzip tools.
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    const crc32 = bytes => {
      let crc = 0xffffffff;
      for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
      return (crc ^ 0xffffffff) >>> 0;
    };
    for (const file of files) {
      const name = encoder.encode(file.path), data = encoder.encode(file.content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), header = new DataView(local.buffer);
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true);
      header.setUint16(12, 0x21, true); header.setUint32(14, crc, true); header.setUint32(18, data.length, true); header.setUint32(22, data.length, true); header.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), entry = new DataView(central.buffer);
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(14, 0x21, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); central.set(name, 46);
      chunks.push(local, data); directory.push(central); offset += local.length + data.length;
    }
    const size = directory.reduce((sum, bytes) => sum + bytes.length, 0), end = new Uint8Array(22), footer = new DataView(end.buffer);
    footer.setUint32(0, 0x06054b50, true); footer.setUint16(8, files.length, true); footer.setUint16(10, files.length, true); footer.setUint32(12, size, true); footer.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + end.length); let position = 0;
    for (const bytes of [...chunks, ...directory, end]) { result.set(bytes, position); position += bytes.length; }
    return result;
  }
  async function writeFiles(directory, files) {
    for (const file of files) {
      const parts = file.path.split("/"); let target = directory;
      for (const folder of parts.slice(0, -1)) target = await target.getDirectoryHandle(folder, { create: true });
      const handle = await target.getFileHandle(parts.at(-1), { create: true });
      const stream = await handle.createWritable(); await stream.write(file.content); await stream.close();
      if ((await (await handle.getFile()).text()) !== file.content) throw new Error(`文件写入核对失败：${file.path}`);
    }
  }
  const api = { zip, writeFiles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NoteFiles = api;
})();
