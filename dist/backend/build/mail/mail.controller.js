"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const common_2 = require("@nestjs/common");
const mail_service_1 = require("./mail.service");
const app_log_1 = require("../common/app-log");
let MailController = class MailController {
    mail;
    constructor(mail) {
        this.mail = mail;
    }
    async getConfig() {
        return { success: true, data: await this.mail.publicConfig() };
    }
    async verify(body) {
        const res = await this.mail.verify((body?.mail || null));
        if (res.ok)
            app_log_1.appLog.info('mail', 'SMTP 连通性自检通过');
        else
            app_log_1.appLog.warn('mail', `SMTP 连通性自检失败：${res.message}`);
        return { success: res.ok, message: res.message };
    }
    async test(body, req) {
        const to = String(body?.to || '').trim();
        if (!to)
            throw new common_1.BadRequestException('请填写收件邮箱');
        try {
            await this.mail.sendWithOverride(body?.mail, to, '【GoHub】测试邮件', `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;padding:20px;color:#303133;line-height:1.8;">
           <h3 style="margin:0 0 10px;color:#1d4ed8;">GoHub 邮箱配置已生效</h3>
           <p style="margin:0 0 6px;">收到这封邮件说明 SMTP 配置可用，可以开始使用「邮箱验证 / 两步验证」相关功能。</p>
           <p style="margin:0;color:#909399;font-size:12px;">操作人：${(0, auth_guard_1.currentSession)(req)?.user || '-'} · ${new Date().toLocaleString('zh-CN')}</p>
         </div>`);
            return { success: true, message: '测试邮件已发送，请查收' };
        }
        catch (err) {
            app_log_1.appLog.error('mail', `发送测试邮件失败：${err.message}`);
            return { success: false, message: err.message };
        }
    }
};
exports.MailController = MailController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MailController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Post)('verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "verify", null);
__decorate([
    (0, common_1.Post)('test'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_2.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MailController.prototype, "test", null);
exports.MailController = MailController = __decorate([
    (0, common_1.Controller)('api/manage/mail'),
    (0, common_1.UseGuards)(auth_guard_1.AdminGuard),
    __metadata("design:paramtypes", [mail_service_1.MailService])
], MailController);
