/**
 * ============================================================================
 *  FILE    : backend/src/controllers/authController.js
 *  MỤC ĐÍCH: Tầng controller của nhóm API xác thực - nhận request, gọi service,
 *            trả phản hồi theo đúng quy ước JSON của dự án.
 *  ENDPOINT:
 *            - POST /api/signup                : đăng ký tài khoản mới
 *            - GET  /api/verify-email?token=... : kích hoạt tài khoản (trả HTML)
 *            - POST /api/resend-verification   : gửi lại email xác thực
 *            - POST /api/login                 : đăng nhập, nhận JWT (Bước 4)
 *            - GET  /api/me                    : thông tin user đang đăng nhập (Bước 4, bảo vệ)
 *            - POST /api/logout                : xác nhận đăng xuất phía client (Bước 4, bảo vệ)
 * ============================================================================
 */

import { ApiError, sendSuccess } from '../utils/responseUtils.js';                          // Quy ước phản hồi dùng chung
import { assertJsonObject } from '../utils/validationUtils.js';                             // Kiểm tra body là object JSON
import { registerUser, toPublicUser, verifyEmailToken, resendVerificationEmail, loginUser } from '../services/authService.js';   // Nghiệp vụ xác thực

// Đường dẫn trang Login (dùng cho nút trong trang HTML kết quả xác thực)
const LOGIN_PAGE_URL = '/page/login.html';

// Escape ký tự HTML để thông báo không phá vỡ cấu trúc trang
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',    // Dấu và
        '<': '&lt;',     // Mở thẻ
        '>': '&gt;',     // Đóng thẻ
        '"': '&quot;',   // Nháy kép
        "'": '&#39;',    // Nháy đơn
    }[character]));
}

// Gửi một trang HTML hoàn chỉnh cho trình duyệt
function sendHtml(res, statusCode, htmlText) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',                        // Kiểu nội dung HTML UTF-8
        'Content-Length': Buffer.byteLength(htmlText),                     // Độ dài theo byte
        'Cache-Control': 'no-store',                                       // Không cache trang kết quả
    });
    res.end(htmlText);                                                   // Gửi nội dung ra trình duyệt
}

/**
 * Trang HTML kết quả xác thực email (thành công / thất bại).
 * GHI CHÚ: style viết inline vì đây là trang do server sinh ra, không nằm trong frontend/.
 */
function renderVerifyResultPage({ isSuccess, title, message }) {
    const accentColor = isSuccess ? '#15803d' : '#b91c1c';               // Màu xanh cho thành công, đỏ cho lỗi
    const icon = isSuccess ? '✅' : '⚠️';                                // Biểu tượng tương ứng
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo list - Email verification</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f2f4f7; font-family: Arial, Helvetica, sans-serif; color: #1f2937; }
    .card { width: 420px; padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .icon { font-size: 34px; margin: 8px 0; }
    h2 { margin: 0 0 12px; font-size: 19px; color: ${accentColor}; }
    p { margin: 0 0 18px; font-size: 15px; line-height: 1.6; }
    a.button { display: inline-block; padding: 11px 18px; font-weight: 600; color: #ffffff; background: #2563eb; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Todo list</h1>
    <div class="icon">${icon}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    <a class="button" href="${LOGIN_PAGE_URL}">Go to Login</a>
  </main>
</body>
</html>`;
}

// --- POST /api/signup: đăng ký tài khoản mới ---
export async function handleSignup({ res, getBody }) {
    const body = await getBody();                            // Đọc và parse JSON body của request
    assertJsonObject(body);                                  // Body phải là object JSON (không phải mảng/chuỗi)

    const { user } = await registerUser({                    // Gọi nghiệp vụ đăng ký (đã lưu xong khi hàm trả về)
        name: body.name,                                       // Tên hiển thị từ client
        email: body.email,                                     // Email từ client
        password: body.password,                               // Mật khẩu từ client
    });

    // Phản hồi 201: tài khoản đã được lưu an toàn, email đang được gửi ở chế độ nền.
    // KHÔNG trả passwordSalt/passwordHash/verificationToken và KHÔNG khẳng định email đã gửi xong.
    sendSuccess(
        res,
        'Account created. Please check your inbox and open the verification link to activate your account (the email may take a few seconds to arrive).',
        { ...toPublicUser(user), status: user.status },        // Dữ liệu an toàn: id, name, email, status = pending
        201,                                                   // 201 = tạo mới thành công
    );
}

// --- GET /api/verify-email?token=... : kích hoạt tài khoản, trả về trang HTML ---
export async function handleVerifyEmail({ res, url }) {
    const token = url.searchParams.get('token');             // Lấy token từ query string của URL

    try {
        const user = await verifyEmailToken(token);                                     // Kích hoạt tài khoản (bước 3 trong luồng)
        sendHtml(res, 200, renderVerifyResultPage({                                     // Trả trang HTML thành công
            isSuccess: true,
            title: 'Email verified',
            message: `Your account (${user.email}) is now active. You can log in now.`,
        }));
    } catch (error) {
        if (error instanceof ApiError) {                                                // Lỗi nghiệp vụ (token sai/hết hạn/đã dùng)
            sendHtml(res, error.statusCode, renderVerifyResultPage({                      // Trả trang HTML thất bại kèm mã lỗi
                isSuccess: false,
                title: 'Verification failed',
                message: `${error.message} You can request a new verification email from the Login page.`,
            }));
            return;                                                                       // Kết thúc hàm xử lý
        }
        throw error;                                                                     // Lỗi hệ thống -> để server.js trả JSON 500
    }
}

// --- POST /api/resend-verification: gửi lại email xác thực ---
export async function handleResendVerification({ res, getBody }) {
    const body = await getBody();                            // Đọc JSON body
    assertJsonObject(body);                                  // Body phải là object JSON

    const result = await resendVerificationEmail(body.email);   // Gọi nghiệp vụ gửi lại (có rate limit 60 giây)

    // Ghi log phía server để dễ demo; KHÔNG đưa thông tin này vào response (tránh lộ email tồn tại hay không)
    console.log(`[auth] Yêu cầu gửi lại email xác thực: email đã được xếp hàng gửi = ${result.sent}`);

    // Trả message CHUNG cho mọi trường hợp: không tiết lộ tài khoản có tồn tại hay không
    sendSuccess(res, result.message, null, 200);
}

// --- POST /api/login: đăng nhập và nhận JWT (Bước 4) ---
export async function handleLogin({ res, getBody }) {
    const body = await getBody();                            // Đọc JSON body của request
    assertJsonObject(body);                                  // Body phải là object JSON

    const { token, user } = await loginUser({                // Kiểm tra thông tin đăng nhập (ném ApiError 401/403 nếu sai)
        email: body.email,                                     // Email người dùng nhập
        password: body.password,                               // Mật khẩu người dùng nhập
    });

    sendSuccess(res, 'Login successful', {                   // Phản hồi thành công theo quy ước chung
        token,                                                 // JWT để frontend lưu vào localStorage
        user: toPublicUser(user),                              // Thông tin công khai: id, name, email (KHÔNG có hash/salt)
    }, 200);
}

// --- GET /api/me: thông tin user đang đăng nhập (đã qua middleware requireAuth) ---
export async function handleMe({ res, user }) {
    sendSuccess(res, 'Authenticated user profile', toPublicUser(user), 200);   // Chỉ trả id/name/email
}

// --- POST /api/logout: xác nhận đăng xuất phía client (Bước 4) ---
export async function handleLogout({ res, user }) {
    console.log(`[auth] Người dùng ${user.id} yêu cầu đăng xuất (client sẽ xoá token khỏi localStorage).`);
    // GHI CHÚ (mục 9 - Logout limitation): JWT stateless nên server KHÔNG thể thu hồi token.
    // Message nói rõ điều này để không hứa hẹn điều hệ thống không làm được.
    sendSuccess(
        res,
        'Logged out on this client. The browser must delete its stored token. Note: this stateless JWT cannot be revoked on the server, so a copied token remains valid until it expires.',
        null,
        200,
    );
}