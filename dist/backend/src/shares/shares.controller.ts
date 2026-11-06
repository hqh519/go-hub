/**
 * 对外分享接口 —— v3.0.0
 *
 * 管理端（需登录）：/api/shares
 *   GET    /api/shares                列表（普通用户只看自己；管理员可按 username 代查）
 *   POST   /api/shares                新建 / 更新（upsert，唯一键 owner+instanceId+type+target）
 *   POST   /api/shares/batch          批量启停 / 改密码 / 删除
 *   PATCH  /api/shares/:id            改启停 / 密码 / 到期 / 备注
 *   DELETE /api/shares/:id            删除
 *
 * 公网（无需登录）：/api/shares/public
 *   GET    /api/shares/public/access  访问校验（是否存在 / 停用 / 过期 / 是否需要密码）
 *   GET    /api/shares/public/list    公开列表（结构对齐 /api/public/list）
 *
 * 密码验证通过后种 Cookie gohub_share_pw（值 = 该分享的 passwordHash，httpOnly，7 天）。
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard, currentSession, isAdminRole } from '../auth/auth.guard';
import {
  SHARE_PW_COOKIE,
  SHARE_PW_COOKIE_OPTIONS,
  SharePublicQuery,
  SharesService,
  ShareUpsertBody,
} from './shares.service';

@Controller('api/shares')
export class SharesController {
  constructor(private svc: SharesService) {}

  private actor(req: Request) {
    const session = currentSession(req);
    return { user: session?.user || '', isAdmin: isAdminRole(session?.role) };
  }

  /** 请求里携带的分享密码 Cookie（值即 passwordHash，无需再哈希） */
  private cookieHash(req: Request): string {
    const raw = req.cookies?.[SHARE_PW_COOKIE];
    if (typeof raw !== 'string' || !raw) return '';
    try {
      // cookie-parser 已解码过一次；哈希是十六进制，再解一次只为兼容手工传值
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  /** 密码验证成功时下发 Cookie（httpOnly，7 天） */
  private grant(res: Response, hash?: string): void {
    if (!hash) return;
    res.cookie(SHARE_PW_COOKIE, hash, SHARE_PW_COOKIE_OPTIONS);
  }

  // ------------------------------------------------------------------
  // 管理端
  // ------------------------------------------------------------------

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: Request, @Query() q: Record<string, string>, @Res() res: Response) {
    const actor = this.actor(req);
    if (!actor.user) return res.status(401).json({ success: false, error: '未登录' });
    return res.json(await this.svc.list(q, actor));
  }

  @Post()
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async upsert(@Body() body: ShareUpsertBody, @Req() req: Request, @Res() res: Response) {
    const actor = this.actor(req);
    if (!actor.user) return res.status(401).json({ success: false, error: '未登录' });
    const r = await this.svc.upsert(actor, body || {});
    if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
    return res.json({ success: true, data: r.item });
  }

  /** 批量操作：action = enable | disable | password | delete */
  @Post('batch')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async batch(
    @Body() body: { ids?: string[]; action?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const actor = this.actor(req);
    if (!actor.user) return res.status(401).json({ success: false, error: '未登录' });
    const r = await this.svc.batch(actor, body || {});
    if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
    return res.json({ success: true, updated: r.updated || 0 });
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  async patch(
    @Param('id') id: string,
    @Body() body: { enabled?: boolean | string; password?: string; expireAt?: string | null; note?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const actor = this.actor(req);
    if (!actor.user) return res.status(401).json({ success: false, error: '未登录' });
    const r = await this.svc.patch(id, actor, body || {});
    if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
    return res.json({ success: true, data: r.item });
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const actor = this.actor(req);
    if (!actor.user) return res.status(401).json({ success: false, error: '未登录' });
    const r = await this.svc.remove(id, actor);
    if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
    return res.json({ success: true });
  }

  // ------------------------------------------------------------------
  // 公网（无需登录；HTTP 状态恒 200，前端按 ok 判断，省掉一堆 error 分支）
  // ------------------------------------------------------------------

  /** 访问校验：ok=true 可浏览；ok=false + needPassword=true 表示要输密码 */
  @Get('public/access')
  async publicAccess(
    @Query() q: SharePublicQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.publicAccess(q, { cookieHash: this.cookieHash(req), ip: req.ip || '' });
    this.grant(res, r.setPwHash);
    // 安全：setPwHash 只用于种 Cookie，绝不能出现在响应体里（否则等于把分享密码哈希送给公网）
    const { setPwHash: _omit, ...body } = r;
    return body;
  }

  /** 公开列表：结构对齐 /api/public/list（files / directories / totalCount / …） */
  @Get('public/list')
  async publicList(@Query() q: SharePublicQuery, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.publicList(q, { cookieHash: this.cookieHash(req), ip: req.ip || '' });
    this.grant(res, r.setPwHash);
    const { setPwHash: _omit2, ...body } = r;
    return body;
  }
}
