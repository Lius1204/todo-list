/**
 * ============================================================================
 *  FILE    : backend/src/services/emailService.js
 *  MỤC ĐÍCH: Gửi email xác thực tài khoản qua Gmail SMTP bằng Nodemailer.
 *  NGUYÊN TẮC (mục 8 của đề bài):
 *            - KHÔNG giả vờ gửi thành công. Hàm chỉ xong khi Nodemailer xác nhận.
 *            - KHÔNG log token xác thực hay App Password.
 *            - Cấu hình SMTP đọc từ .env, kiểm tra ngay trước khi gửi (lazy).
 *  GHI CHÚ : Không cache transporter, mỗi lần gửi tạo kết nối mới để phản ánh
 *            đúng cấu hình .env hiện tại và tránh giữ kết nối TLS lâu.
 * ============================================================================
 */

import nodemailer from 'nodemailer';              // Thư viện gửi email đã cài ở Bước 1

// Các biến môi trường bắt buộc để gửi được email
const REQUIRED_ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'APP_BASE_URL'];
const SMTP_TIMEOUT_MS = 10000;                    // Timeout 10 giây cho mỗi bước kết nối/gửi (tránh treo vô hạn)

// Trả về danh sách các biến môi trường email còn thiếu
export function getMissingEmailConfigKeys() {
    return REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);   // Lọc ra biến chưa được khai báo
}

// Kiểm tra nhanh xem đã đủ cấu hình email chưa (dùng để cảnh báo, không ném lỗi)
export function isEmailConfigured() {
    return getMissingEmailConfigKeys().length === 0;               // Đủ hết biến -> đã cấu hình
}

// Đọc và kiểm tra cấu hình SMTP; ném lỗi rõ ràng nếu thiếu hoặc sai
function readEmailConfig() {
    const missingKeys = getMissingEmailConfigKeys();               // Các biến còn thiếu
    if (missingKeys.length > 0) {                                  // Thiếu cấu hình -> không thể gửi
        throw new Error(`Missing email configuration in .env: ${missingKeys.join(', ')}`);
    }
    const port = Number(process.env.SMTP_PORT);                    // Cổng SMTP là chuỗi trong .env -> đổi sang số
    if (!Number.isInteger(port) || port < 1 || port > 65535) {     // Cổng không hợp lệ
        throw new Error('SMTP_PORT must be a valid port number (1-65535)');
    }
    return {
        host: process.env.SMTP_HOST,                                          // Ví dụ: smtp.gmail.com
        port,                                                                 // 465 (TLS ngầm) hoặc 587 (STARTTLS)
        user: process.env.SMTP_USER,                                          // Địa chỉ Gmail dùng để gửi
        appPassword: process.env.SMTP_APP_PASSWORD,                           // App Password 16 ký tự (không log giá trị này)
        baseUrl: String(process.env.APP_BASE_URL).replace(/\/+$/, ''),        // Bỏ dấu "/" ở cuối để ghép URL đẹp
    };
}

// Tạo transporter Nodemailer theo cấu hình hiện tại
function createTransporter(config) {
    return nodemailer.createTransport({
        host: config.host,                            // Máy chủ SMTP
        port: config.port,                            // Cổng SMTP
        secure: config.port === 465,                  // Cổng 465 = TLS ngầm; cổng 587 = STARTTLS
        auth: { user: config.user, pass: config.appPassword },   // Đăng nhập bằng Gmail App Password
        connectionTimeout: SMTP_TIMEOUT_MS,           // Timeout khi mở kết nối TCP
        greetingTimeout: SMTP_TIMEOUT_MS,             // Timeout khi chờ lời chào của server SMTP
        socketTimeout: SMTP_TIMEOUT_MS,               // Timeout khi chờ dữ liệu qua socket
    });
}

// Tạo URL xác thực trỏ về chính ứng dụng (dùng trong nội dung email)
export function buildVerificationUrl(verificationToken) {
    const config = readEmailConfig();                                              // Lấy APP_BASE_URL từ .env
    return `${config.baseUrl}/api/verify-email?token=${encodeURIComponent(verificationToken)}`;   // Mã hoá token trong URL
}

// Escape ký tự HTML để nội dung email không bị phá vỡ cấu trúc
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({   // Thay từng ký tự đặc biệt bằng thực thể HTML
        '&': '&amp;',    // Dấu và
        '<': '&lt;',     // Mở thẻ
        '>': '&gt;',     // Đóng thẻ
        '"': '&quot;',   // Nháy kép
        "'": '&#39;',    // Nháy đơn
    }[character]));
}

/**
 * Gửi email xác thực tài khoản.
 * THÀNH CÔNG: trả về { messageId, accepted } sau khi SMTP xác nhận.
 * THẤT BẠI  : NÉM LỖI (nơi gọi phải tự bắt và ghi log, tuyệt đối không báo thành công).
 */
export async function sendVerificationEmail({ toEmail, recipientName, verificationToken, expiresInMinutes }) {
    const config = readEmailConfig();                                                     // Đọc cấu hình SMTP (ném lỗi nếu thiếu)
    const verificationUrl = buildVerificationUrl(verificationToken);                       // Tạo link xác thực
    const safeName = escapeHtml(recipientName);                                            // Tên người nhận đã escape
    const safeUrl = escapeHtml(verificationUrl);                                           // Link đã escape để nhúng vào HTML
    const subject = 'Verify your Todo list account';                                       // Tiêu đề email

    // Nội dung dạng text thuần: cho mail client không hiển thị HTML
    const textBody = [
        `Hello ${recipientName},`,
        '',
        'Thank you for signing up for Todo list.',
        'Please verify your email address by opening this link:',
        verificationUrl,
        '',
        `This link expires in ${expiresInMinutes} minutes.`,
        'If you did not create this account, you can safely ignore this email.',
    ].join('\n');

    // Nội dung dạng HTML: có nút bấm rõ ràng (dùng style inline vì mail client không nạp file CSS ngoài)
    const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px;">Todo list</h2>
      <p>Hello ${safeName},</p>
      <p>Thank you for signing up for <strong>Todo list</strong>. Please confirm your email address to activate your account.</p>
      <p style="margin: 20px 0;">
        <a href="${safeUrl}" style="background: #2563eb; color: #ffffff; padding: 11px 18px; border-radius: 8px; text-decoration: none; font-weight: bold;">Verify my email</a>
      </p>
      <p>If the button does not work, copy and paste this link into your browser:<br />
        <span style="word-break: break-all; color: #2563eb;">${safeUrl}</span>
      </p>
      <p>This link expires in <strong>${expiresInMinutes} minutes</strong>.</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not create this account, you can safely ignore this email.</p>
    </div>
  `;

    const transporter = createTransporter(config);                                        // Tạo kết nối SMTP theo cấu hình
    const info = await transporter.sendMail({                                             // Gửi email; ném lỗi nếu SMTP từ chối
        from: `"Todo list" <${config.user}>`,                                               // Người gửi hiển thị trong hộp thư
        to: toEmail,                                                                        // Người nhận
        subject,                                                                            // Tiêu đề
        text: textBody,                                                                     // Bản text thuần
        html: htmlBody,                                                                     // Bản HTML
    });

    return { messageId: info.messageId, accepted: info.accepted };                        // Trả về thông tin SMTP đã xác nhận
}

/**
 * Kiểm tra kết nối SMTP ngay lập tức (dùng cho script chẩn đoán và README).
 * Trả về true nếu đăng nhập Gmail SMTP thành công, ném lỗi nếu thất bại.
 */
export async function verifySmtpConnection() {
    const config = readEmailConfig();                     // Đọc cấu hình SMTP từ .env
    const transporter = createTransporter(config);        // Tạo transporter tạm để kiểm tra
    await transporter.verify();                           // Đăng nhập thử vào máy chủ SMTP
    return true;                                          // Kết nối OK
}