/**
 * ============================================================================
 *  FILE    : backend/src/utils/httpUtils.js
 *  MỤC ĐÍCH: Các hàm phụ trợ cho tầng HTTP, hiện dùng để ĐỌC VÀ PARSE JSON BODY.
 *  YÊU CẦU ĐỀ BÀI (mục 13):
 *            - Parse JSON body an toàn (không làm sập server).
 *            - Giới hạn dung lượng body (chống gửi payload khổng lồ).
 *            - Trả lỗi 400 khi JSON sai định dạng.
 * ============================================================================
 */

import { ApiError } from './responseUtils.js';    // Dùng lớp lỗi nghiệp vụ dùng chung

// Giới hạn dung lượng body mặc định: 64 KB (quá đủ cho mọi request của dự án này)
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Đọc body của request và parse thành object JSON.
 * - Body rỗng  -> trả về {} (ví dụ POST /api/logout không cần body)
 * - JSON sai   -> ném ApiError(400)
 * - Quá lớn    -> ném ApiError(413)
 */
export async function readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
    const chunks = [];                              // Mảng chứa các mảnh dữ liệu nhận được
    let totalBytes = 0;                             // Tổng số byte đã nhận

    try {
        for await (const chunk of req) {              // Duyệt từng mảnh dữ liệu client gửi lên
            totalBytes += chunk.length;                 // Cộng dồn số byte đã nhận
            if (totalBytes > maxBytes) {                // Vượt giới hạn cho phép
                throw new ApiError(413, `Request body is too large. Maximum allowed size is ${maxBytes} bytes`);
            }
            chunks.push(chunk);                         // Lưu mảnh dữ liệu để ghép lại sau
        }
    } catch (error) {
        if (error instanceof ApiError) throw error;   // Lỗi vượt giới hạn -> ném nguyên vẹn
        throw new ApiError(400, 'Could not read the request body');   // Lỗi mạng khi đọc body
    }

    const rawBody = Buffer.concat(chunks).toString('utf8').trim();  // Ghép các mảnh thành chuỗi UTF-8
    if (rawBody === '') return {};                  // Body rỗng -> coi như object rỗng, không phải lỗi

    try {
        return JSON.parse(rawBody);                   // Parse chuỗi JSON thành object
    } catch {
        throw new ApiError(400, 'Request body must be valid JSON');   // JSON hỏng -> 400 (đúng yêu cầu mục 13)
    }
}