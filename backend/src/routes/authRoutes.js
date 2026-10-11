/**
 * ============================================================================
 *  FILE    : backend/src/routes/authRoutes.js
 *  MỤC ĐÍCH: Bảng định tuyến cho các API xác thực (mục 11.1 của đề bài).
 *  CÁCH DÙNG: server.js gọi handleAuthRoutes(ctx). Hàm trả về:
 *             - true  : request đã được xử lý (khớp route, hoặc khớp path nhưng sai method)
 *             - false : không phải route của file này -> server.js tiếp tục tìm route khác
 * ============================================================================
 */

import { sendError, sendErrorFromException } from '../utils/responseUtils.js';              // Hàm phản hồi dùng chung
import { handleSignup, handleVerifyEmail, handleResendVerification } from '../controllers/authController.js';   // Các controller

// Bảng route: mỗi dòng là 1 cặp (method + path) gắn với hàm xử lý tương ứng
const AUTH_ROUTES = [
    { method: 'POST', path: '/api/signup', handler: handleSignup },                           // Đăng ký tài khoản
    { method: 'GET', path: '/api/verify-email', handler: handleVerifyEmail },                 // Xác thực email qua link
    { method: 'POST', path: '/api/resend-verification', handler: handleResendVerification },  // Gửi lại email xác thực
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
    if (!matchedRoute) {                                     // Đúng path nhưng sai method (ví dụ POST /api/verify-email)
        sendError(res, 405, `Method ${req.method} is not allowed for ${pathname}. Allowed: ${samePath.map((route) => route.method).join(', ')}`);
        return true;                                           // Đã xử lý (trả 405) -> không tìm route khác
    }

    try {
        await matchedRoute.handler(ctx);                       // Gọi controller; mọi lỗi ApiError ném ra đều được xử lý dưới
    } catch (error) {
        sendErrorFromException(res, error, '[auth]');          // 400/409/429 giữ nguyên mã; lỗi khác -> 500 an toàn
    }
    return true;                                             // Đã xử lý xong request
}