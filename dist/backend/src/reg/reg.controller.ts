import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentSession, isAdminRole } from '../auth/auth.guard';
import { RegService } from './reg.service';

/**
 * v1.3.5.3 登记功能 API（/api/reg）
 * ---------------------------------------------------------------------------
 * 权限口径与笔记一致：所有操作按登录账户收窄（个人登记），
 * 只有统计支持 `scope=all`（同实例内按标记名做联合统计）。
 */
@Controller('api/reg')
export class RegController {
  constructor(private readonly reg: RegService) {}

  private ctx(req: Request): { viewer: string; isAdmin: boolean } {
    const session = currentSession(req);
    const viewer = String(session?.user || '');
    if (!viewer) {
      throw new HttpException({ success: false, message: '请先登录后再使用登记' }, HttpStatus.UNAUTHORIZED);
    }
    return { viewer, isAdmin: isAdminRole(session?.role) };
  }

  /* ── 登记项 ── */
  @Get('trackers')
  async trackers(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.listTrackers(viewer, instanceId || '');
  }

  @Post('trackers')
  async saveTracker(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.ensureTracker(body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, tracker: (r as any).row, locked: (r as any).locked };
  }

  /**
   * v1.3.5.7：条目管理 —— 改名称 / 类型 / 单位 / 分母。
   * 「条目」是登记自己的身份表，改这里等于改根源，关联记录按 trackerId 自动跟着变。
   */
  @Put('trackers/:id')
  async updateTracker(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.updateTracker(id, body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /** v1.3.5.7：合并条目 —— 把 sources 的记录全部并到 target，再删掉 sources */
  @Post('trackers/merge')
  async mergeTrackers(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.mergeTrackers(
      String((body as any)?.targetId || ''),
      Array.isArray((body as any)?.sourceIds) ? (body as any).sourceIds : [],
      viewer,
    );
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /** v1.3.5.8：删除条目 —— 有关联记录时拒绝（请改用合并） */
  @Delete('trackers/:id')
  async removeTracker(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.removeTracker(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /* ── 记录 ── */
  @Get('entries')
  async entries(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    return this.reg.listEntries({
      owner: viewer,
      instanceId: String(q.instanceId || ''),
      trackerId: q.trackerId || '',
      trackerName: q.trackerName || '',
      from: q.from || '',
      to: q.to || '',
      keyword: q.keyword || '',
      tag: q.tag || '',
      /* v1.3.6：回收站模式 */
      trash: q.trash === '1' || q.trash === 'true',
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
    });
  }

  /** v1.3.6：导出当前实例的登记数据（CSV，17 列） */
  @Get('export')
  async exportCsv(@Req() req: Request, @Res() res: Response, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const csv = await this.reg.exportCsv(viewer, instanceId || '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(csv);
  }

  @Post('entries')
  async createEntry(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.createEntry(body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  @Put('entries/:id')
  async updateEntry(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.updateEntry(id, body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  @Delete('entries/:id')
  async removeEntry(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.removeEntry(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /** v1.3.6：回收站 —— 恢复 */
  @Post('entries/:id/restore')
  async restoreEntry(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.restoreEntry(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /** v1.3.6：回收站 —— 彻底删除 */
  @Delete('entries/:id/purge')
  async purgeEntry(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.purgeEntry(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /** v1.3.5.9：按 id 取附件视图（表单里的缩略图） */
  @Get('attachments')
  async attachments(@Req() req: Request, @Query('ids') ids?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.attachmentViews(String(ids || '').split(','), viewer);
  }

  /* ── 统计 ── */
  @Get('stats')
  async stats(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    return this.reg.stats({
      owner: viewer,
      instanceId: String(q.instanceId || ''),
      scope: q.scope || 'me',
      type: q.type || '',
      trackerId: q.trackerId || '',
      /* v1.3.5.10：总范围的发生对象 / 关联对象 / 地点 / 标签（tags 用逗号分隔） */
      subjectName: q.subjectName || '',
      relatedName: q.relatedName || '',
      placeName: q.placeName || '',
      tags: q.tags || '',
      trackerName: q.trackerName || '',
      tag: q.tag || '',
      from: q.from || '',
      to: q.to || '',
      bucket: q.bucket || 'month',
      compare: q.compare || '',
      /* v1.3.5.8：横轴 / 纵轴 / 图例（legends 是 JSON 字符串） */
      axisX: q.axisX || '',
      axisY: q.axisY || '',
      legends: q.legends || '',
    });
  }

  /** v1.3.5.8：图例筛选项 —— 某个条目在总范围内实际用过的地点 / 人 / 标签 */
  @Get('legend-options')
  async legendOptions(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    return this.reg.legendOptions({
      owner: viewer,
      instanceId: String(q.instanceId || ''),
      scope: q.scope || 'me',
      trackerId: q.trackerId || '',
      trackerName: q.trackerName || '',
      axisX: q.axisX || '',
      from: q.from || '',
      to: q.to || '',
    });
  }

  /* ── 候选值 ── */
  @Get('tag-candidates')
  async tagCandidates(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.listTagNames(instanceId || '', viewer);
  }

  @Get('candidates')
  async candidates(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.candidates(viewer, instanceId || '');
  }

  /* ── P2：报表保存 ── */
  @Get('reports')
  async reports(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.listReports(viewer, instanceId || '');
  }

  @Post('reports')
  async saveReport(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.saveReport(body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  @Delete('reports/:id')
  async removeReport(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.removeReport(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /* ── 批量导入 ── */
  @Post('import')
  async importRows(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const rows = Array.isArray((body as any)?.rows) ? (body as any).rows : [];
    if (!rows.length) return { ok: 0, failed: [] };
    return this.reg.importRows(rows, viewer, String((body as any).instanceId || ''));
  }
}
