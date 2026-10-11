/**
 * ============================================================================
 *  FILE    : backend/src/utils/responseUtils.js
 *  MỤC ĐÍCH: Chuẩn hoá TOÀN BỘ phản hồi HTTP của API theo một quy ước duy nhất
 *            (mục 11.4 của đề bài):
 *              - Thành công: { status: "OK",    message, data?   }
 *              - Thất bại : { status: "ERROR", message, errors? }
 *            Ngoài ra cung cấp lớp ApiError để ném lỗi nghiệp vụ kèm mã HTTP.
 *  LƯU Ý   : File này KHÔNG phụ thuộc file nào khác trong dự án,
 *            nên import ở đâu cũng không sợ vòng lặp import.
 * ============================================================================
 */

// Kiểu nội dung JSON dùng chung cho mọi phản hồi API
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * Lớp lỗi nghiệp vụ: khi ném ra ở tầng service/controller, server sẽ trả về
 * đúng mã HTTP kèm thông báo an toàn cho người dùng.
 * Ví dụ: throw new ApiError(409, 'This email is already registered');
 */
export class ApiError extends Error {
    constructor(statusCode, message, errors = null) {   // Nhận mã HTTP, thông báo, và lỗi chi tiết theo từng field (nếu có)
        super(message);                                   // Gọi constructor của Error để gán message
        this.name = 'ApiError';                           // Đặt tên lớp lỗi để dễ phân biệt khi log
        this.statusCode = statusCode;                     // Lưu mã HTTP sẽ trả về cho client
        this.errors = errors;                             // Lưu lỗi chi tiết theo field (mặc định null)
    }
}

// Gửi một object bất kỳ dưới dạng JSON (dùng cho trường hợp đặc biệt cần toàn quyền)
export function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);               // Chuyển object thành chuỗi JSON
    res.writeHead(statusCode, {                         // Ghi status code và header phản hồi
        'Content-Type': JSON_CONTENT_TYPE,                // Kiểu nội dung là JSON UTF-8
        'Content-Length': Buffer.byteLength(body),        // Độ dài body tính theo byte (không phải số ký tự)
        'Cache-Control': 'no-store',                      // Cấm trình duyệt cache phản hồi API
    });
    res.end(body);                                      // Kết thúc và gửi dữ liệu cho client
}

// Gửi phản hồi THÀNH CÔNG theo quy ước { status, message, data }
export function sendSuccess(res, message, data = null, statusCode = 200) {
    const payload = { status: 'OK', message };          // Tạo phần thân cơ bản của phản hồi thành công
    if (data !== null) payload.data = data;             // Chỉ thêm "data" khi thực sự có dữ liệu
    sendJson(res, statusCode, payload);                 // Gửi phản hồi ra client
}

// Gửi phản hồi LỖI theo quy ước { status, message, errors }
export function sendError(res, statusCode, message, errors = null) {
    const payload = { status: 'ERROR', message };       // Tạo phần thân cơ bản của phản hồi lỗi
    if (errors) payload.errors = errors;                // Chỉ thêm "errors" khi có lỗi chi tiết theo field
    sendJson(res, statusCode, payload);                 // Gửi phản hồi ra client
}

// Chuyển một Exception bất kỳ thành phản hồi HTTP an toàn (gọi ở tầng route)
export function sendErrorFromException(res, error, logPrefix = '[api]') {
    if (error instanceof ApiError) {                    // Trường hợp lỗi đã lường trước (400/401/404/409/429...)
        sendError(res, error.statusCode, error.message, error.errors);  // Trả đúng mã và thông báo đã chuẩn hoá
        return;                                           // Kết thúc hàm
    }
    console.error(`${logPrefix} Lỗi không mong đợi:`, error);  // Lỗi hệ thống: ghi log đầy đủ ở phía server
    if (res.headersSent) {                              // Nếu phản hồi đã bắt đầu gửi đi rồi
        res.end();                                        // Chỉ kết thúc, không thể ghi thêm header nữa
        return;                                           // Kết thúc hàm
    }
    sendError(res, 500, 'Internal server error');       // Trả lỗi 500 chung, KHÔNG lộ stack trace cho client
}