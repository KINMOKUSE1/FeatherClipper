// WBI 的 MD5 请求签名；按 RFC 1321 计算摘要，不加载远程脚本。
function courseWbiMd5(text) {
  const input = new TextEncoder().encode(text);
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, input.length * 8, true);
  view.setUint32(bytes.length - 4, Math.floor(input.length / 0x20000000), true);
  const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const phase = i >> 4;
      const f = phase === 0 ? (b & c) | (~b & d) : phase === 1 ? (d & b) | (~d & c) : phase === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = phase === 0 ? i : phase === 1 ? (5 * i + 1) % 16 : phase === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const sum = (a + f + constants[i] + view.getInt32(offset + word * 4, true)) | 0;
      const shift = shifts[phase][i % 4];
      [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  }
  return state.map(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}
function courseWbiQuery(params, imgKey, subKey, wts = Math.floor(Date.now() / 1000)) {
  if (![imgKey, subKey].every(key => /^[a-f0-9]{32}$/i.test(key))) throw new Error("B站签名信息无效，请重新读取");
  const order = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  const keys = imgKey + subKey;
  const mixin = order.map(index => keys[index]).join("").slice(0, 32);
  const values = { ...params, wts };
  const query = Object.keys(values).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]).replace(/[!'()*]/g, ""))}`).join("&");
  return `${query}&w_rid=${courseWbiMd5(query + mixin)}`;
}
