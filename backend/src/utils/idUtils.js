/**
 * ============================================================================
 *  FILE    : backend/src/utils/idUtils.js
 *  MỤC ĐÍCH: Sinh ID duy nhất cho user và task.
 *  LƯU Ý  : ID sinh ngẫu nhiên bằng crypto (an toàn), KHÔNG phụ thuộc số dòng
 *           trong CSV, nên thêm/xoá dòng không bao giờ làm trùng ID
 *           (đúng yêu cầu mục 6.3 của đề).
 * ============================================================================
 */

import crypto from 'node:crypto';                 // Module crypto có sẵn của Node.js

const RANDOM_BYTES = 8;                           // 8 byte ngẫu nhiên -> 16 ký tự hex

// Sinh ID dạng "<tiền tố>_<16 ký tự hex ngẫu nhiên>", ví dụ: user_9f3a1c2b7d4e5f60
export function generateId(prefix) {
    const randomPart = crypto.randomBytes(RANDOM_BYTES).toString('hex');  // Chuỗi hex ngẫu nhiên
    return `${prefix}_${randomPart}`;                                     // Ghép tiền tố với phần ngẫu nhiên
}

// Sinh ID cho user mới
export function generateUserId() {
    return generateId('user');                      // Ví dụ: user_1a2b3c4d5e6f7081
}

// Sinh ID cho task mới
export function generateTaskId() {
    return generateId('task');                      // Ví dụ: task_0f9e8d7c6b5a4321
}