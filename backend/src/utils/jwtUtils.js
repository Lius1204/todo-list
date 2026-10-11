/**
 * ============================================================================
 *  FILE    : backend/src/utils/jwtUtils.js
 *  MỤC ĐÍCH: Ký và xác thực JWT cho chức năng đăng nhập.
 *  LƯU Ý QUAN TRỌNG: các biến môi trường được đọc BÊN TRONG hàm (lazy),
 *            không đọc ở cấp module. Vì ES Module nạp import TRƯỚC khi chạy
 *            process.loadEnvFile() trong server.js, đọc sớm sẽ nhận undefined.
 * ============================================================================
 */

import jwt from 'jsonwebtoken';                          // Thư viện JWT đã cài ở Bước 1
import { ApiError } from './responseUtils.js';           // Lớp lỗi nghiệp vụ dùng chung

const DEFAULT_EXPIRES_DAYS = 3;                          // Giá trị mặc định nếu .env không cấu hình
const ALGORITHM = 'HS256';                               // Thuật toán ký: HMAC-SHA256 (đối xứng, phù hợp dự án nhỏ)

// Đọc khoá bí mật từ biến môi trường (đọc muộn để chắc chắn .env đã được nạp)
function readJwtSecret() {
    const secret = process.env.JWT_SECRET;                 // Lấy khoá bí mật từ biến môi trường
    if (typeof secret !== 'string' || secret.length === 0) {   // Chưa cấu hình khoá
        throw new Error('JWT_SECRET is missing. Please configure it in the .env file.');   // Lỗi cấu hình, không phải lỗi người dùng
    }
    return secret;                                         // Trả khoá bí mật cho nơi gọi
}

// Đọc số ngày sống của token từ .env; giá trị sai thì quay về mặc định 3 ngày
export function getJwtExpiresDays() {
    const rawValue = process.env.JWT_EXPIRES_DAYS;         // Lấy giá trị thô trong .env
    if (rawValue === undefined || String(rawValue).trim() === '') return DEFAULT_EXPIRES_DAYS;   // Không cấu hình -> dùng mặc định
    const days = Number(rawValue);                         // Chuyển sang dạng số
    if (!Number.isFinite(days) || days <= 0) {             // Giá trị không hợp lệ (ví dụ "abc" hoặc -1)
        console.warn(`[jwt] JWT_EXPIRES_DAYS không hợp lệ ("${rawValue}"), dùng mặc định ${DEFAULT_EXPIRES_DAYS} ngày.`);
        return DEFAULT_EXPIRES_DAYS;                         // Quay về mặc định để server vẫn chạy được
    }
    return days;                                           // Giá trị hợp lệ
}

// Ký token đăng nhập cho một user; chỉ chứa sub (ID user), không chứa dữ liệu nhạy cảm
export function signAuthToken(userId) {
    if (typeof userId !== 'string' || userId.length === 0) {   // Chặn ID không hợp lệ
        throw new Error('signAuthToken: userId must be a non-empty string');    // Lỗi lập trình
    }
    const expiresInSeconds = Math.floor(getJwtExpiresDays() * 24 * 60 * 60);   // Đổi số ngày trong .env thành giây
    return jwt.sign({}, readJwtSecret(), {                 // Payload rỗng vì mọi thông tin cần thiết nằm trong claim chuẩn
        subject: userId,                                     // Claim "sub" = ID người dùng (đúng yêu cầu mục 9.2 của đề)
        expiresIn: expiresInSeconds,                         // Hạn sống của token, lấy từ JWT_EXPIRES_DAYS
        algorithm: ALGORITHM,                                // Ghi rõ thuật toán ký
    });
}

// Xác thực token; ném ApiError(401) nếu token thiếu, sai chữ ký hoặc đã hết hạn
export function verifyAuthToken(token) {
    if (typeof token !== 'string' || token.length === 0) {   // Client không gửi token
        throw new ApiError(401, 'Authentication token is missing');
    }
    const secret = readJwtSecret();                          // Đọc khoá TRƯỚC try/catch để lỗi cấu hình không bị hiểu nhầm là token sai
    try {
        return jwt.verify(token, secret, { algorithms: [ALGORITHM] });   // Kiểm tra chữ ký + hạn + thuật toán
    } catch (error) {
        if (error.name === 'TokenExpiredError') {              // Token hết hạn
            throw new ApiError(401, 'Session token has expired. Please log in again.');
        }
        throw new ApiError(401, 'Invalid session token. Please log in again.');   // Token sai chữ ký hoặc bị sửa
    }
}

// Đọc token từ header "Authorization: Bearer <token>"; trả null nếu header không đúng dạng
export function readBearerToken(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') return null;      // Không có header -> không có token
    const parts = authorizationHeader.trim().split(/\s+/);         // Tách theo khoảng trắng: ["Bearer", "<token>"]
    if (parts.length !== 2) return null;                           // Sai định dạng
    if (parts[0].toLowerCase() !== 'bearer') return null;          // Không phải Bearer
    return parts[1].length > 0 ? parts[1] : null;                  // Trả token, hoặc null nếu rỗng
}