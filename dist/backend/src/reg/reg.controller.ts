import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
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
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
    });
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

  /* ── 统计 ── */
  @Get('stats')
  async stats(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    return this.reg.stats({
      owner: viewer,
      instanceId: String(q.instanceId || ''),
      scope: q.scope || 'me',
      trackerId: q.trackerId || '',
      trackerName: q.trackerName || '',
      from: q.from || '',
      to: q.to || '',
      bucket: q.bucket || 'month',
      compare: q.compare || '',
    });
  }

  /* ── 单位 ── */
  @Get('units')
  async units(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    return this.reg.listUnits(viewer, instanceId || '');
  }

  @Post('units')
  async saveUnit(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.saveUnit(body as any, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  @Delete('units/:id')
  async removeUnit(@Req() req: Request, @Param('id') id: string) {
    const { viewer } = this.ctx(req);
    const r = await this.reg.removeUnit(id, viewer);
    if ('error' in r && r.error) {
      throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    }
    return { success: true, ...(r as any) };
  }

  /* ── 候选值 ── */
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
