/**
 * ============================================================================
 *  FILE    : backend/src/utils/validationUtils.js
 *  MỤC ĐÍCH: Kiểm tra và chuẩn hoá toàn bộ dữ liệu đầu vào của API.
 *            Mọi quy tắc nghiệp vụ (email, mật khẩu, tên, nội dung task) tập
 *            trung ở đây vì "backend là nơi kiểm tra có thẩm quyền" - frontend
 *            chỉ kiểm tra trước cho trải nghiệm người dùng đẹp hơn.
 *  QUY ƯỚC : Hàm assert... sẽ NÉM ApiError(400) khi dữ liệu sai,
 *            và TRẢ VỀ dữ liệu ĐÃ CHUẨN HOÁ khi dữ liệu hợp lệ.
 * ============================================================================
 */

import { ApiError } from './responseUtils.js';                 // Dùng lớp lỗi nghiệp vụ dùng chung

// --- Các giới hạn, đúng theo yêu cầu đề bài ---
export const MIN_PASSWORD_LENGTH = 8;                          // Mật khẩu tối thiểu 8 ký tự
export const MAX_PASSWORD_LENGTH = 20;                         // Mật khẩu tối đa 20 ký tự
export const MAX_TASK_CONTENT_LENGTH = 100;                    // Nội dung task tối đa 100 ký tự
export const MAX_NAME_LENGTH = 50;                             // Tên hiển thị tối đa 50 ký tự
export const MAX_EMAIL_LENGTH = 254;                           // Độ dài tối đa của email theo chuẩn thực tế

// --- Các mẫu (pattern) dùng để kiểm tra ---
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;            // Có đúng 1 dấu @, không khoảng trắng, có phần tên miền
const UPPERCASE_PATTERN = /[A-Z]/;                             // Có ít nhất 1 chữ in hoa
const LOWERCASE_PATTERN = /[a-z]/;                             // Có ít nhất 1 chữ in thường
const SPECIAL_CHARACTER_PATTERN = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?`~]/;   // Có ít nhất 1 ký tự đặc biệt

// Chuẩn hoá email: cắt khoảng trắng 2 đầu + chuyển hết về chữ thường
export function normalizeEmail(value) {
    return String(value ?? '').trim().toLowerCase();             // String(...) để không sập nếu client gửi số hoặc null
}

// Kiểm tra email (dùng cho cả signup và login), trả về email đã chuẩn hoá
export function assertValidEmail(value) {
    const email = normalizeEmail(value);                         // Bước 1: chuẩn hoá về dạng so sánh được
    if (email.length === 0) {                                    // Bước 2: bỏ trống email
        throw new ApiError(400, 'Email is required');              // Báo lỗi thiếu dữ liệu
    }
    if (email.length > MAX_EMAIL_LENGTH) {                       // Bước 3: email dài bất thường
        throw new ApiError(400, `Email must not exceed ${MAX_EMAIL_LENGTH} characters`);
    }
    if (!EMAIL_PATTERN.test(email)) {                            // Bước 4: sai định dạng
        throw new ApiError(400, 'Email address format is not valid');
    }
    return email;                                                // Hợp lệ -> trả về dạng đã chuẩn hoá
}

// Kiểm tra tên hiển thị, trả về tên đã cắt khoảng trắng
export function assertValidName(value) {
    const name = String(value ?? '').trim();                     // Chuẩn hoá: bỏ khoảng trắng đầu/cuối
    if (name.length === 0) {                                     // Bỏ trống tên
        throw new ApiError(400, 'Display name is required');       // Báo lỗi
    }
    if (name.length > MAX_NAME_LENGTH) {                         // Tên quá dài
        throw new ApiError(400, `Display name must not exceed ${MAX_NAME_LENGTH} characters`);
    }
    return name;                                                 // Hợp lệ -> trả về tên đã chuẩn hoá
}

// Kiểm tra mật khẩu khi ĐĂNG KÝ: đúng đủ 5 quy tắc trong đề bài
export function assertValidPassword(value) {
    const password = typeof value === 'string' ? value : '';     // Chỉ nhận kiểu chuỗi, các kiểu khác coi như rỗng
    if (password.length === 0) {                                 // Bỏ trống mật khẩu
        throw new ApiError(400, 'Password is required');           // Báo lỗi
    }
    if (password.length < MIN_PASSWORD_LENGTH) {                 // Quy tắc 1: độ dài tối thiểu
        throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {                 // Quy tắc 2: độ dài tối đa
        throw new ApiError(400, `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
    }
    if (!UPPERCASE_PATTERN.test(password)) {                     // Quy tắc 3: có chữ in hoa
        throw new ApiError(400, 'Password must contain at least one uppercase letter');
    }
    if (!LOWERCASE_PATTERN.test(password)) {                     // Quy tắc 4: có chữ in thường
        throw new ApiError(400, 'Password must contain at least one lowercase letter');
    }
    if (!SPECIAL_CHARACTER_PATTERN.test(password)) {              // Quy tắc 5: có ký tự đặc biệt
        throw new ApiError(400, 'Password must contain at least one special character');
    }
    return password;                                             // Hợp lệ -> trả về nguyên mật khẩu
}

// Kiểm tra mật khẩu khi ĐĂNG NHẬP: chỉ cần có dữ liệu, KHÔNG kiểm tra độ mạnh
// (vì tài khoản cũ có thể được tạo trước khi quy tắc thay đổi)
export function assertLoginPassword(value) {
    const password = typeof value === 'string' ? value : '';     // Chỉ nhận kiểu chuỗi
    if (password.length === 0) {                                 // Bỏ trống mật khẩu
        throw new ApiError(400, 'Password is required');           // Báo lỗi thiếu dữ liệu
    }
    return password;                                             // Hợp lệ -> trả về mật khẩu
}

// Kiểm tra nội dung task, trả về nội dung đã cắt khoảng trắng 2 đầu
export function assertValidTaskContent(value) {
    const rawContent = typeof value === 'string' ? value : '';   // Chỉ nhận kiểu chuỗi
    const content = rawContent.trim();                           // Bỏ khoảng trắng đầu/cuối
    if (content.length === 0) {                                  // Rỗng sau khi trim -> không hợp lệ
        throw new ApiError(400, 'Task content must not be empty');
    }
    if (content.length > MAX_TASK_CONTENT_LENGTH) {              // Vượt 100 ký tự -> không hợp lệ
        throw new ApiError(400, `Task content must be between 1 and ${MAX_TASK_CONTENT_LENGTH} characters`);
    }
    return content;                                              // Hợp lệ -> trả về nội dung đã chuẩn hoá
}

// Kiểm tra một field bắt buộc phải là boolean thật (true/false của JS)
export function assertBoolean(value, fieldName) {
    if (typeof value !== 'boolean') {                            // Nhận cả chuỗi "true" là sai -> chặn ngay
        throw new ApiError(400, `${fieldName} must be a boolean value`);
    }
    return value;                                                // Hợp lệ -> trả về giá trị boolean
}

// Kiểm tra một field là chuỗi (ví dụ assignedTo), trả về chuỗi đã cắt khoảng trắng
export function assertStringField(value, fieldName) {
    if (typeof value !== 'string') {                             // Sai kiểu dữ liệu
        throw new ApiError(400, `${fieldName} must be a string`);
    }
    return value.trim();                                         // Chuỗi rỗng "" vẫn hợp lệ (nghĩa là bỏ gán)
}

// Kiểm tra body request phải là object JSON (không phải mảng, null hay chuỗi)
export function assertJsonObject(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {   // Loại bỏ mọi dạng dữ liệu khác
        throw new ApiError(400, 'Request body must be a JSON object');
    }
    return body;                                                 // Hợp lệ -> trả về chính body
}

// Kiểm tra request PATCH chỉ chứa các field được phép sửa
export function assertOnlyAllowedFields(body, allowedFields) {
    const keys = Object.keys(body);                                            // Danh sách field client gửi lên
    const unknownFields = keys.filter((key) => !allowedFields.includes(key));   // Lọc ra field không nằm trong danh sách cho phép
    if (unknownFields.length > 0) {                                            // Có field lạ (ví dụ "id", "createdBy")
        throw new ApiError(400, `Unsupported field(s): ${unknownFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`);
    }
    return body;                                                 // Hợp lệ -> trả về body
}

// Kiểm tra body có chứa một field cụ thể hay không (dùng cho PATCH: chỉ cập nhật field được gửi lên)
export function hasField(body, fieldName) {
    return Object.prototype.hasOwnProperty.call(body, fieldName);   // So sánh chính xác field của object, không lấy từ prototype
}