/**
 * ============================================================================
 *  FILE    : backend/src/routes/authRoutes.js
 *  MỤC ĐÍCH: Bảng định tuyến cho các API xác thực (mục 11.1 của đề bài).
 *  CÁCH DÙNG: server.js gọi handleAuthRoutes(ctx). Hàm trả về:
 *             - true  : request đã được xử lý (khớp route, hoặc khớp path nhưng sai method)
 *             - false : không phải route của file này -> server.js tiếp tục tìm route khác
 *  CẬP NHẬT: Bước 4 thêm /api/login, /api/me (bảo vệ), /api/logout (bảo vệ).
 * ============================================================================
 */

import { sendError, sendErrorFromException } from '../utils/responseUtils.js';              // Hàm phản hồi dùng chung
import { requireAuth } from '../middleware/authMiddleware.js';                              // Middleware xác thực JWT
import {
    handleSignup,                   // Đăng ký tài khoản
    handleVerifyEmail,              // Xác thực email qua link
    handleResendVerification,       // Gửi lại email xác thực
    handleLogin,                    // Đăng nhập (Bước 4)
    handleMe,                       // Thông tin user hiện tại (Bước 4)
    handleLogout,                   // Đăng xuất (Bước 4)
} from '../controllers/authController.js';

// Bảng route: mỗi dòng là 1 cặp (method + path) gắn với hàm xử lý tương ứng.
// isProtected = true -> bắt buộc phải có JWT hợp lệ của tài khoản active trước khi vào controller.
const AUTH_ROUTES = [
    { method: 'POST', path: '/api/signup', handler: handleSignup, isProtected: false },                            // Đăng ký tài khoản
    { method: 'GET', path: '/api/verify-email', handler: handleVerifyEmail, isProtected: false },                  // Xác thực email qua link
    { method: 'POST', path: '/api/resend-verification', handler: handleResendVerification, isProtected: false },   // Gửi lại email xác thực
    { method: 'POST', path: '/api/login', handler: handleLogin, isProtected: false },                              // Đăng nhập, nhận JWT
    { method: 'GET', path: '/api/me', handler: handleMe, isProtected: true },                                      // Thông tin user đang đăng nhập
    { method: 'POST', path: '/api/logout', handler: handleLogout, isProtected: true },                             // Đăng xuất phía client
];

/**
 * Xử lý request nếu thuộc nhóm route xác thực.
 * ctx: { req, res, url, pathname, getBody }
 */
export async function handleAuthRoutes(ctx) {
    const { req, res, pathname } = ctx;                      // Lấy các thành phần cần dùng từ context

    const samePath = AUTH_ROUTES.filter((route) => route.path === pathname);   // Các route có cùng đường dẫn
    if (samePath.length === 0) return false;                 // Không phải route của file này -> nhường server.js

    const matchedRoute = samePath.find((route) => route.method === req.method);   // Tìm route đúng cả method
    if (!matchedRoute) {                                     // Đúng path nhưng sai method (ví dụ GET /api/login)
        sendError(res, 405, `Method ${req.method} is not allowed for ${pathname}. Allowed: ${samePath.map((route) => route.method).join(', ')}`);
        return true;                                           // Đã xử lý (trả 405) -> không tìm route khác
    }

    try {
        if (matchedRoute.isProtected) {                        // Endpoint được bảo vệ
            await requireAuth(ctx);                              // Bắt buộc JWT hợp lệ; ctx.user được gắn vào đây
        }
        await matchedRoute.handler(ctx);                       // Gọi controller; mọi ApiError ném ra đều xử lý ở dưới
    } catch (error) {
        sendErrorFromException(res, error, '[auth]');          // 400/401/403/409/429 giữ nguyên mã; lỗi khác -> 500 an toàn
    }
    return true;                                             // Đã xử lý xong request
}