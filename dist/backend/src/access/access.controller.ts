import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminGuard, currentSession } from '../auth/auth.guard';
import { AccessService, shouldRecordPath } from './access.service';
import { appLog } from '../common/app-log';

/** 从请求里取客户端 IP（与 main.ts 的 clientIp 同一规则） */
function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket?.remoteAddress || '';
  return String(ip).replace(/^::ffff:/, '');
}

/**
 * 访问记录上报（公开接口，不需要登录）。
 *
 *   POST /api/access/visit  { path, title?, referer? } → { id }
 *   POST /api/access/stay   { id, stayMs }
 *
 * 设计取舍：
 *   · visit 只认「站内路径」，其它参数一律以服务端能拿到的为准（IP / UA 由请求头决定，
 *     前端传什么都不采信），避免被伪造刷库；
 *   · stay 用 sendBeacon 在页面隐藏 / 路由切换时发，响应体不重要，只回 success。
 */
@Controller('api/access')
export class AccessController {
  constructor(private access: AccessService) {}

  @Post('visit')
  @HttpCode(200)
  async visit(
    @Body() body: { path?: string; title?: string; referer?: string },
    @Req() req: Request,
  ) {
    const path = String(body.path || '').split('?')[0].slice(0, 500);
    if (!path || !path.startsWith('/')) return { success: true, data: { id: '' } };
    // 静态资源 / 接口轮询不算页面访问
    if (!shouldRecordPath(path)) return { success: true, data: { id: '' } };

    const session = currentSession(req);
    const id = await this.access.record({
      ip: clientIp(req),
      path,
      title: body.title || '',
      referer: body.referer || (req.headers.referer as string) || '',
      username: session?.user || '',
      ua: String(req.headers['user-agent'] || ''),
      method: 'GET',
      status: 200,
      kind: 'page',
    });
    return { success: true, data: { id } };
  }

  @Post('stay')
  @HttpCode(200)
  async stay(@Body() body: { id?: string; stayMs?: number }) {
    const ok = await this.access.stay(String(body.id || ''), Number(body.stayMs || 0));
    return { success: ok };
  }
}

/**
 * 访问记录管理（管理员）。
 *
 *   GET    /api/manage/access            ?keyword&start&end&kind&page&pageSize
 *   GET    /api/manage/access/summary
 *   GET    /api/manage/access/recent?take=20
 *   DELETE /api/manage/access            { ids: [] }
 *   DELETE /api/manage/access/all
 */
@Controller('api/manage/access')
@UseGuards(AdminGuard)
export class AccessAdminController {
  constructor(private access: AccessService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const data = await this.access.list(q);
    return { success: true, data };
  }

  @Get('summary')
  async summary() {
    return { success: true, data: await this.access.summary() };
  }

  @Get('recent')
  async recent(@Query('take') take?: string) {
    return { success: true, data: await this.access.recent(Number(take) || 20) };
  }

  @Delete()
  async remove(@Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    if (!ids.length) throw new BadRequestException('缺少 ids');
    const count = await this.access.remove(ids);
    appLog.warn('access', `删除访问记录 ${count} 条`, JSON.stringify(ids.slice(0, 20)));
    return { success: true, data: { deleted: count } };
  }

  @Delete('all')
  async clearAll(@Res({ passthrough: true }) _res: Response) {
    const count = await this.access.clear();
    appLog.warn('access', `清空全部访问记录（${count} 条）`);
    return { success: true, data: { deleted: count } };
  }
}
