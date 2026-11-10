"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const auth_controller_1 = require("./auth/auth.controller");
const auth_guard_1 = require("./auth/auth.guard");
const channels_controller_1 = require("./channels/channels.controller");
const upload_controller_1 = require("./upload/upload.controller");
const upload_service_1 = require("./upload/upload.service");
const files_controller_1 = require("./files/files.controller");
const users_controller_1 = require("./users/users.controller");
const token_api_controller_1 = require("./tokens/token-api.controller");
const webdav_controller_1 = require("./webdav/webdav.controller");
const webdav_admin_controller_1 = require("./webdav/webdav-admin.controller");
const webdav_self_controller_1 = require("./webdav/webdav-self.controller");
const settings_service_1 = require("./settings/settings.service");
const sysconfig_service_1 = require("./settings/sysconfig.service");
const storage_channel_service_1 = require("./storage/storage-channel.service");
const compat_controller_1 = require("./compat/compat.controller");
const access_controller_1 = require("./access/access.controller");
const access_service_1 = require("./access/access.service");
const mail_controller_1 = require("./mail/mail.controller");
const mail_service_1 = require("./mail/mail.service");
const instances_module_1 = require("./instances/instances.module");
const shares_module_1 = require("./shares/shares.module");
const localfiles_controller_1 = require("./localfiles/localfiles.controller");
const notes_controller_1 = require("./notes/notes.controller");
const notes_service_1 = require("./notes/notes.service");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [instances_module_1.InstancesModule, shares_module_1.SharesModule],
        controllers: [
            auth_controller_1.AuthController,
            channels_controller_1.ChannelsController,
            channels_controller_1.ChannelAllowedController,
            channels_controller_1.ChannelManageController,
            channels_controller_1.StorageSettingsController,
            upload_controller_1.UploadController,
            files_controller_1.LinkController,
            files_controller_1.ManageController,
            files_controller_1.UserConfigController,
            users_controller_1.UsersController,
            users_controller_1.AvatarController,
            token_api_controller_1.TokenApiController,
            webdav_controller_1.WebDavController,
            webdav_admin_controller_1.WebDavAdminController,
            webdav_self_controller_1.WebDavSelfController,
            compat_controller_1.PublicCompatController,
            compat_controller_1.ManageCompatController,
            access_controller_1.AccessController,
            access_controller_1.AccessAdminController,
            mail_controller_1.MailController,
            localfiles_controller_1.LocalFilesController,
            notes_controller_1.NotesController,
        ],
        providers: [
            settings_service_1.SettingsService,
            sysconfig_service_1.SysConfigService,
            channels_controller_1.ChannelsService,
            storage_channel_service_1.StorageChannelService,
            upload_service_1.UploadService,
            auth_guard_1.OptionalAuthGuard,
            access_service_1.AccessService,
            mail_service_1.MailService,
            notes_service_1.NotesService,
        ],
    })
], AppModule);
