/**
 * ============================================================================
 *  FILE    : backend/src/middleware/authMiddleware.js
 *  MỤC ĐÍCH: Xác thực JWT cho các endpoint được bảo vệ (yêu cầu mục 9 của đề).
 *            Quy trình: đọc header Authorization -> tách Bearer token ->
 *            kiểm tra chữ ký + hạn -> tìm tài khoản trong users.csv ->
 *            đảm bảo tài khoản CÒN TỒN TẠI và ĐANG ACTIVE.
 *  SỬ DỤNG : const user = await requireAuth(ctx);   // ctx.user được gắn tự động
 * ============================================================================
 */

import { ApiError } from '../utils/responseUtils.js';                     // Lớp lỗi nghiệp vụ dùng chung
import { readBearerToken, verifyAuthToken } from '../utils/jwtUtils.js';   // Đọc + xác thực JWT
import { findUserById } from '../services/authService.js';                // Tìm user theo ID trong users.csv

/**
 * Bắt buộc request phải có JWT hợp lệ của một tài khoản đang active.
 * Trả về dòng user đầy đủ (dùng nội bộ); ném ApiError(401) nếu không hợp lệ.
 */
export async function requireAuth(ctx) {
    const authorizationHeader = ctx.req.headers.authorization;    // Đọc header "Authorization: Bearer <token>"
    const token = readBearerToken(authorizationHeader);           // Tách token khỏi header theo đúng định dạng Bearer
    if (!token) {                                                 // Không có token hoặc header sai định dạng
        throw new ApiError(401, 'Authentication token is missing. Please log in again.');
    }

    const payload = verifyAuthToken(token);                       // Kiểm tra chữ ký + hạn; ném ApiError(401) nếu sai
    const userId = typeof payload.sub === 'string' ? payload.sub : '';   // Claim "sub" chính là ID người dùng
    if (userId === '') {                                          // Chữ ký hợp lệ nhưng token thiếu claim "sub"
        throw new ApiError(401, 'Invalid session token. Please log in again.');
    }

    const userRow = await findUserById(userId);                   // Đọc lại users.csv: tài khoản còn tồn tại không?
    if (!userRow || userRow.status !== 'active') {                // Tài khoản đã bị xoá hoặc không còn active
        throw new ApiError(401, 'Your session is no longer valid. Please log in again.');
    }

    ctx.user = userRow;                                           // Gắn user vào context để controller dùng lại
    return userRow;                                               // Trả về dòng user cho nơi gọi (nếu cần)
}