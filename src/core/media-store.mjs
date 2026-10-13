import fs from 'node:fs';
import path from 'node:path';

export class ContentAddressedMediaStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    fs.mkdirSync(rootDir, { recursive: true });
  }
  objectPath(sha256) {
    const hash = String(sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid SHA-256.');
    return path.join(this.rootDir, `${hash}.blob`);
  }
  putFile(tempPath, sha256) {
    const target = this.objectPath(sha256);
    if (!fs.existsSync(target)) fs.renameSync(tempPath, target);
    else fs.rmSync(tempPath, { force: true });
    return target;
  }
  has(sha256) { return fs.existsSync(this.objectPath(sha256)); }
}
