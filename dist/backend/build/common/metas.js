"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Metas = void 0;
class Metas {
    data;
    constructor(raw) {
        try {
            this.data = raw ? JSON.parse(raw) : {};
        }
        catch {
            this.data = {};
        }
        if (typeof this.data !== 'object' || this.data === null || Array.isArray(this.data)) {
            this.data = {};
        }
    }
    static from(raw) {
        return new Metas(raw);
    }
    static of(init) {
        const m = new Metas('{}');
        m.data = { ...init };
        return m;
    }
    get(key, fallback) {
        const v = this.data[key];
        return (v === undefined ? fallback : v);
    }
    set(key, value) {
        this.data[key] = value;
        return this;
    }
    remove(key) {
        delete this.data[key];
        return this;
    }
    has(key) {
        return key in this.data;
    }
    all() {
        return { ...this.data };
    }
    toString() {
        return JSON.stringify(this.data);
    }
}
exports.Metas = Metas;
