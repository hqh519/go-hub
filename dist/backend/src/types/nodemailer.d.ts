/**
 * nodemailer 没有自带 TypeScript 类型声明，而本项目只用到 createTransport / sendMail /
 * verify 这三个方法 —— 与其引入 @types/nodemailer 增加一个 devDependency，
 * 不如在这里做最小声明，够用且不污染构建。
 */
declare module 'nodemailer' {
  export interface SendMailOptions {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }
  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<{ messageId?: string }>;
    verify(): Promise<boolean>;
  }
  export interface TransportOptions {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
    tls?: { rejectUnauthorized?: boolean };
  }
  export function createTransport(options: TransportOptions): Transporter;
  const _default: { createTransport: typeof createTransport };
  export default _default;
}
