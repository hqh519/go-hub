import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, currentSession } from '../auth/auth.guard';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { MailService } from './mail.service';
import { appLog } from '../common/app-log';

/**
 * 邮箱配置管理（管理员）。
 *
 * 配置本身仍走 `POST /api/manage/sysConfig/security`（security.mail 段），
 * 这里只提供「读取脱敏配置 / 连通性自检 / 发测试邮件」三个动作。
 *
 *   GET  /api/manage/mail          → 脱敏配置（pass 恒为空，hasPass 表示是否已设置）
 *   POST /api/manage/mail/verify   → SMTP 连接自检
 *   POST /api/manage/mail/test     → 发一封测试邮件 { to }
 */
@Controller('api/manage/mail')
@UseGuards(AdminGuard)
export class MailController {
  constructor(private mail: MailService) {}

  @Get()
  async getConfig() {
    return { success: true, data: await this.mail.publicConfig() };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: { mail?: Record<string, unknown> }) {
    // v2.4.0：自检允许携带表单当前值（未保存也能测），pass 留空 = 用库中已存密码
    const res = await this.mail.verify((body?.mail || null) as any);
    if (res.ok) appLog.info('mail', 'SMTP 连通性自检通过');
    else appLog.warn('mail', `SMTP 连通性自检失败：${res.message}`);
    return { success: res.ok, message: res.message };
  }

  @Post('test')
  @HttpCode(200)
  async test(@Body() body: { to?: string; mail?: Record<string, unknown> }, @Req() req: Request) {
    const to = String(body?.to || '').trim();
    if (!to) throw new BadRequestException('请填写收件邮箱');
    try {
      await this.mail.sendWithOverride(
        body?.mail as any,
        to,
        '【GoHub】测试邮件',
        `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;padding:20px;color:#303133;line-height:1.8;">
           <h3 style="margin:0 0 10px;color:#1d4ed8;">GoHub 邮箱配置已生效</h3>
           <p style="margin:0 0 6px;">收到这封邮件说明 SMTP 配置可用，可以开始使用「邮箱验证 / 两步验证」相关功能。</p>
           <p style="margin:0;color:#909399;font-size:12px;">操作人：${currentSession(req)?.user || '-'} · ${new Date().toLocaleString('zh-CN')}</p>
         </div>`,
      );
      return { success: true, message: '测试邮件已发送，请查收' };
    } catch (err) {
      appLog.error('mail', `发送测试邮件失败：${(err as Error).message}`);
      return { success: false, message: (err as Error).message };
    }
  }
}
