/**
 * 一次性数据修复脚本：按扩展名回填 FileRecord.mime
 *
 * 背景：
 *   早期版本直接采用客户端上传的 Content-Type。curl / 部分浏览器对
 *   mp4、mp3、m4a 等会统一发送 application/octet-stream，导致库中这些
 *   记录的 mime 不正确，进而使「随机图 API 的 ?category=video|audio 筛选」
 *   与「视频按 MIME 分流」失效。本脚本按扩展名重新计算并回填。
 *
 * 用法（在 backend 目录下执行）：
 *   node scripts/fix-mime.js
 *
 * 幂等：已正确的记录会被跳过，可重复执行。
 */

const { PrismaClient } = require('@prisma/client');

const EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
};

const prisma = new PrismaClient();

(async () => {
  try {
    const rows = await prisma.fileRecord.findMany({
      select: { id: true, name: true, originalName: true, mime: true },
    });

    let fixed = 0;
    const changed = [];
    for (const r of rows) {
      const ext = (r.originalName.split('.').pop() || '').toLowerCase();
      const want = EXT_MIME[ext];
      if (!want || want === r.mime) continue;
      await prisma.fileRecord.update({ where: { id: r.id }, data: { mime: want } });
      changed.push(`  ${r.name}  ${r.mime || '(空)'} → ${want}  (${r.originalName})`);
      fixed += 1;
    }

    console.log(`扫描 ${rows.length} 条记录，修正 ${fixed} 条：`);
    changed.forEach((l) => console.log(l));
    if (fixed === 0) console.log('  （无需修正，数据已符合预期）');
  } catch (err) {
    console.error('修复失败：', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
