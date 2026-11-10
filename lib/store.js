// Stockage Baara — fichier JSON local (disque persistant de la VM Boxd), écriture atomique.
// MemoryStore pour les tests.
const fs = require("fs");
const path = require("path");

class FileStore {
  constructor(filePath) { this.path = filePath; this.state = null; }
  async load(force) {
    if (this.state && !force) return this.state;
    try { const parsed = JSON.parse(fs.readFileSync(this.path, "utf8")); if (parsed && parsed.users) this.state = parsed; } catch (e) { /* premier démarrage */ }
    if (!this.state) this.state = { users: {}, seq: 1 };
    return this.state;
  }
  async sync() { this.state = null; await this.load(true); }
  async persist() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.path);
  }
  async check() { const stamp = Date.now(); await this.load(true); this.state.check = stamp; await this.persist(); this.state = null; const fresh = await this.load(true); return fresh.check === stamp; }
  async getUser(id) { const st = await this.load(); return st.users[id] || null; }
  async upsertUser(user) { const st = await this.load(); st.users[user.id] = user; await this.persist(); return user; }
  async listUsers() { const st = await this.load(); return Object.values(st.users); }
  async stats() { const st = await this.load(); return { users: Object.keys(st.users).length }; }
}

class MemoryStore {
  constructor() { this.users = new Map(); this.state = { users: {}, seq: 1 }; }
  async load() { return this.state; }
  async sync() {}
  async persist() {}
  async check() { return true; }
  async getUser(id) { return this.users.get(id) || null; }
  async upsertUser(user) { this.users.set(user.id, user); return user; }
  async listUsers() { return [...this.users.values()]; }
  async stats() { return { users: this.users.size }; }
}

function createStore(env) {
  if (env.FILE_STORE_PATH) return new FileStore(env.FILE_STORE_PATH);
  return new MemoryStore();
}
module.exports = { FileStore, MemoryStore, createStore };
