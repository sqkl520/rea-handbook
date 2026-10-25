// 读 ASAR 头部，带完整校验。
//
// 这几个脚本原先各自 openSync + readUInt32LE(12) 就当长度用，
// 传进来一个非 asar 文件时会拿到垃圾长度去 Buffer.alloc：轻则 JSON 解析报错，
// 重则直接抛 "Cannot create a string longer than 0x1fffffe8"。
// 那正是本手册警告读者的那条错误——工具自己不该制造它。
const fs = require('fs');

function readAsarHeader(path) {
  if (!fs.existsSync(path)) {
    const e = new Error('file not found: ' + path);
    e.userFacing = true;
    throw e;
  }
  if (fs.statSync(path).isDirectory()) {
    const e = new Error('expected an .asar file, got a directory: ' + path);
    e.userFacing = true;
    throw e;
  }
  const fileSize = fs.statSync(path).size;
  const fd = fs.openSync(path, 'r');
  try {
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    if (n < 16 || head.readUInt32LE(0) !== 4) {
      const e = new Error('not an asar archive (bad header magic): ' + path);
      e.userFacing = true;
      throw e;
    }
    const jsonLen = head.readUInt32LE(12);
    // 上限不能只靠 fileSize：一个 1.5 GB 的文件配一个 1.5 GB 的假 jsonLen 仍会通过，
    // 然后 Buffer.alloc 把进程吃到 OOM。真实 asar 头部通常 < 3 MB，给 64 MiB 足够宽松。
    const MAX_HEADER = 67108864;
    if (jsonLen <= 0 || jsonLen > MAX_HEADER || 16 + jsonLen > fileSize) {
      const e = new Error(
        `not an asar archive (header length ${jsonLen} out of range for a ${fileSize}-byte file): ` + path
      );
      e.userFacing = true;
      throw e;
    }
    const headerBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, headerBuf, 0, jsonLen, 16);
    let header;
    try {
      header = JSON.parse(headerBuf.toString('utf8'));
    } catch {
      const e = new Error('not an asar archive (header is not valid JSON): ' + path);
      e.userFacing = true;
      throw e;
    }
    // 数据区 = 8 字节 size pickle + 完整 header pickle
    const baseOffset = 8 + head.readUInt32LE(4);
    return { fd, header, jsonLen, baseOffset, fileSize };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

/** 统一入口：失败时打一行人话并 exit(2)，不甩栈。 */
function openAsar(path) {
  try {
    return readAsarHeader(path);
  } catch (err) {
    if (err.userFacing) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

module.exports = { readAsarHeader, openAsar };
