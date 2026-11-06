/**
 * Metas —— 每张表的扩展数据访问器（zblog/Typecho Metas 风格）。
 * 数据库中以 JSON 字符串存储，通过本类类型化读写。
 *
 *   const metas = Metas.from(record.metas);
 *   metas.get<string[]>('tags');
 *   metas.set('note', 'xxx');
 *   await prisma.fileRecord.update({ data: { metas: metas.toString() } });
 *
 * 纪律：会用于查询/筛选/排序的字段必须独立成列，metas 只放长尾扩展。
 */
export class Metas {
  private data: Record<string, unknown>;

  private constructor(raw: string | null | undefined) {
    try {
      this.data = raw ? JSON.parse(raw) : {};
    } catch {
      this.data = {};
    }
    if (typeof this.data !== 'object' || this.data === null || Array.isArray(this.data)) {
      this.data = {};
    }
  }

  static from(raw: string | null | undefined): Metas {
    return new Metas(raw);
  }

  static of(init: Record<string, unknown>): Metas {
    const m = new Metas('{}');
    m.data = { ...init };
    return m;
  }

  get<T>(key: string, fallback?: T): T {
    const v = this.data[key];
    return (v === undefined ? fallback : v) as T;
  }

  set(key: string, value: unknown): this {
    this.data[key] = value;
    return this;
  }

  remove(key: string): this {
    delete this.data[key];
    return this;
  }

  has(key: string): boolean {
    return key in this.data;
  }

  all(): Record<string, unknown> {
    return { ...this.data };
  }

  toString(): string {
    return JSON.stringify(this.data);
  }
}
