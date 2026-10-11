/**
 * ============================================================================
 *  FILE    : backend/src/server.js
 *  MỤC ĐÍCH: HTTP server chính của ứng dụng Todo list.
 *            - Phục vụ file tĩnh (HTML, CSS, JS) trong thư mục frontend/
 *            - Xử lý các request API dưới tiền tố /api
 *            - KHÔNG dùng Express hay framework backend nào (đúng yêu cầu đề)
 *  YÊU CẦU : Node.js >= 20.12 (dùng process.loadEnvFile + ES Module)
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// PHẦN 1: IMPORT CÁC MODULE CÓ SẴN CỦA NODE.JS
// ---------------------------------------------------------------------------
import http from 'node:http';        // Module http: tạo web server thuần của Node.js
import fsp from 'node:fs/promises';  // Module fs (bản Promise): đọc file bất đồng bộ
import path from 'node:path';
import { ensureAllCsvFiles } from './utils/csvUtils.js';  // (MỚI - Bước 2A) Khởi tạo file CSV khi chạy server   // Module path: ghép và chuẩn hoá đường dẫn an toàn

// ---------------------------------------------------------------------------
// PHẦN 2: XÁC ĐỊNH ĐƯỜNG DẪN GỐC CỦA DỰ ÁN
// ---------------------------------------------------------------------------
const SRC_DIR = import.meta.dirname;                     // Thư mục chứa file này = backend/src
const PROJECT_ROOT = path.resolve(SRC_DIR, '..', '..');  // Lùi 2 cấp -> thư mục gốc dự án
const ENV_FILE = path.join(PROJECT_ROOT, '.env');        // Đường dẫn file cấu hình .env
const STATIC_ROOT = path.join(PROJECT_ROOT, 'frontend'); // Thư mục frontend được phép truy cập
const DEFAULT_PAGE = '/page/login.html';                 // Trang mặc định khi vào đường dẫn "/"

// ---------------------------------------------------------------------------
// PHẦN 3: NẠP BIẾN MÔI TRƯỜNG TỪ FILE .env
// ---------------------------------------------------------------------------
try {
    process.loadEnvFile(ENV_FILE);   // Đọc file .env và gán vào process.env (Node >= 20.12)
} catch {
    console.warn('[config] Không tìm thấy file .env - sẽ dùng biến môi trường của hệ điều hành.');
}

// ---------------------------------------------------------------------------
// PHẦN 4: ĐỌC VÀ KIỂM TRA CẤU HÌNH BẮT BUỘC
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);   // Cổng server, mặc định 3000
const JWT_SECRET = process.env.JWT_SECRET || ''; // Khoá bí mật để ký JWT (bắt buộc)

// Nếu PORT không phải số hợp lệ thì dừng ngay để tránh lỗi khó hiểu
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error('[config] LỖI: PORT trong file .env phải là số từ 1 đến 65535.');
    process.exit(1);                                             // Thoát chương trình, mã lỗi 1
}

// Nếu thiếu JWT_SECRET thì dừng server và in hướng dẫn tạo (không in giá trị bí mật)
if (!JWT_SECRET) {
    console.error('[config] LỖI: Chưa khai báo JWT_SECRET trong file .env.');
    console.error(`[config] Tạo nhanh bằng lệnh: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    process.exit(1);                                             // Dừng server vì thiếu cấu hình bắt buộc
}

// Danh sách biến cần cho chức năng gửi email xác thực (dùng từ Bước 3)
const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'APP_BASE_URL'];
const missingSmtpKeys = SMTP_KEYS.filter((key) => !process.env[key]);  // Lọc ra biến còn thiếu
if (missingSmtpKeys.length > 0) {                                      // Nếu còn thiếu thì chỉ cảnh báo
    console.warn(`[config] Cảnh báo: còn thiếu biến SMTP: ${missingSmtpKeys.join(', ')} (cần ở Bước 3).`);
}

// ---------------------------------------------------------------------------
// PHẦN 5: BẢNG ÁNH XẠ LOẠI FILE -> CONTENT-TYPE
// ---------------------------------------------------------------------------
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',          // Trang HTML, UTF-8 để hiện tiếng Việt đúng
    '.css': 'text/css; charset=utf-8',            // File style
    '.js': 'text/javascript; charset=utf-8',      // File script frontend
    '.json': 'application/json; charset=utf-8',   // Dữ liệu JSON
    '.png': 'image/png',                          // Ảnh PNG
    '.jpg': 'image/jpeg',                         // Ảnh JPG
    '.jpeg': 'image/jpeg',                        // Ảnh JPEG
    '.svg': 'image/svg+xml',                      // Ảnh vector SVG
    '.ico': 'image/x-icon',                       // Icon favicon
    '.txt': 'text/plain; charset=utf-8',          // File text thuần
};

// ---------------------------------------------------------------------------
// PHẦN 6: CÁC HÀM GỬI PHẢN HỒI (dùng chung cho toàn server)
// ---------------------------------------------------------------------------
// Gửi phản hồi dạng JSON theo đúng quy ước của dự án
function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);                          // Chuyển object thành chuỗi JSON
    res.writeHead(statusCode, {                                    // Ghi status code và header
        'Content-Type': MIME_TYPES['.json'],                         // Kiểu nội dung là JSON
        'Content-Length': Buffer.byteLength(body),                   // Độ dài body tính theo byte
        'Cache-Control': 'no-store',                                 // Không cho trình duyệt cache API
    });
    res.end(body);                                                 // Kết thúc và gửi dữ liệu đi
}

// Gửi phản hồi dạng text thuần (dùng cho lỗi 404/403 của file tĩnh)
function sendText(res, statusCode, message) {
    res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.txt'] });  // Khai báo nội dung text
    res.end(message);                                                   // Gửi nội dung ra client
}

// ---------------------------------------------------------------------------
// PHẦN 7: PHỤC VỤ FILE TĨNH + CHỐNG PATH TRAVERSAL
// ---------------------------------------------------------------------------
// Chuyển URL thành đường dẫn file tuyệt đối; trả về null nếu đường dẫn không hợp lệ
function resolveStaticPath(urlPath) {
    let decodedPath = '';                                        // Biến chứa URL sau khi giải mã
    try {
        decodedPath = decodeURIComponent(urlPath);                 // Giải mã %20, %C3%A9... trong URL
        const absolutePath = path.resolve(STATIC_ROOT, '.' + decodedPath);   // Ghép và chuẩn hoá đường dẫn
        // Chỉ chấp nhận file nằm TRONG thư mục frontend (chặn kiểu ../../.env)
        if (absolutePath !== STATIC_ROOT && !absolutePath.startsWith(STATIC_ROOT + path.sep)) {
            return null;                                             // Đường dẫn vượt phạm vi -> từ chối
        }
        return absolutePath;                                       // Đường dẫn hợp lệ
    } catch {
        return null;                                               // URL sai định dạng -> từ chối
    }
}

// Đọc file tĩnh từ đĩa và trả về cho trình duyệt
async function serveStaticFile(req, res, pathname) {
    const filePath = resolveStaticPath(pathname);                // Lấy đường dẫn file an toàn
    if (!filePath) {                                             // Nếu đường dẫn không hợp lệ
        sendText(res, 403, '403 Forbidden');                       // Trả lỗi 403 (bị chặn)
        return;                                                    // Kết thúc hàm
    }
    let fileBuffer;                                              // Biến chứa nội dung file
    try {
        const stats = await fsp.stat(filePath);                    // Lấy thông tin file (kiểm tra tồn tại)
        if (!stats.isFile()) {                                     // Nếu là thư mục chứ không phải file
            sendText(res, 404, '404 Not Found');                     // Trả lỗi 404
            return;                                                  // Kết thúc hàm
        }
        fileBuffer = await fsp.readFile(filePath);                 // Đọc toàn bộ file vào bộ nhớ
    } catch {
        sendText(res, 404, '404 Not Found');                       // File không tồn tại -> lỗi 404
        return;                                                    // Kết thúc hàm
    }
    const extension = path.extname(filePath).toLowerCase();      // Lấy phần mở rộng, ví dụ ".css"
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';  // Chọn content-type phù hợp
    res.writeHead(200, {                                         // Trả status 200 kèm header
        'Content-Type': contentType,                               // Kiểu nội dung của file
        'Content-Length': fileBuffer.length,                       // Độ dài file theo byte
        'Cache-Control': 'no-cache',                               // Không cache để sửa code thấy ngay
    });
    if (req.method === 'HEAD') {                                 // Nếu client chỉ hỏi header (HEAD)
        res.end();                                                 // Kết thúc, không gửi nội dung file
        return;                                                    // Kết thúc hàm
    }
    res.end(fileBuffer);                                         // Gửi nội dung file cho trình duyệt
}

// ---------------------------------------------------------------------------
// PHẦN 8: XỬ LÝ API (hiện chỉ có endpoint kiểm tra server còn sống)
// ---------------------------------------------------------------------------
async function handleApiRequest(req, res, pathname) {
    // GET /api/health : endpoint phụ trợ để test nhanh server bằng Postman/trình duyệt
    if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {                                       // Trả về JSON theo quy ước chung
            status: 'OK',                                            // Trạng thái thành công
            message: 'Server is running',                            // Thông báo cho người dùng
            data: {                                                  // Dữ liệu kèm theo
                nodeVersion: process.version,                          // Phiên bản Node.js đang chạy
                uptimeSeconds: Math.round(process.uptime()),           // Số giây server đã chạy
            },
        });
        return;                                                    // Kết thúc hàm xử lý
    }
    // Các endpoint khác sẽ được thêm ở Bước 3, 4, 5 (auth, users, tasks)
    sendJson(res, 404, {                                         // Không khớp endpoint nào -> 404
        status: 'ERROR',                                           // Trạng thái lỗi
        message: `API endpoint not found: ${req.method} ${pathname}`,  // Nêu rõ method + đường dẫn
    });
}

// ---------------------------------------------------------------------------
// PHẦN 9: HÀM XỬ LÝ CHÍNH CHO MỌI REQUEST
// ---------------------------------------------------------------------------
async function requestHandler(req, res) {
    try {
        const url = new URL(req.url, 'http://localhost');          // Phân tích URL để lấy path và query
        const pathname = url.pathname;                             // Ví dụ: /page/login.html
        if (pathname === '/api' || pathname.startsWith('/api/')) { // Nếu là request API
            await handleApiRequest(req, res, pathname);              // Chuyển cho phần xử lý API
            return;                                                  // Kết thúc hàm
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {       // File tĩnh chỉ cho phép GET/HEAD
            sendJson(res, 405, {                                     // Sai method -> báo 405
                status: 'ERROR',
                message: 'Method not allowed for static files',
            });
            return;                                                  // Kết thúc hàm
        }
        if (pathname === '/') {                                    // Nếu người dùng vào trang chủ
            res.writeHead(302, { Location: DEFAULT_PAGE });          // Điều hướng sang trang Login
            res.end();                                               // Kết thúc phản hồi
            return;                                                  // Kết thúc hàm
        }
        await serveStaticFile(req, res, pathname);                 // Còn lại: phục vụ file tĩnh
    } catch (error) {                                            // Bắt mọi lỗi bất ngờ của request
        console.error('[server] Lỗi không mong đợi:', error);      // Ghi log đầy đủ ở phía server
        if (!res.headersSent) {                                    // Nếu chưa gửi header nào
            sendJson(res, 500, {                                     // Trả lỗi 500 thân thiện
                status: 'ERROR',
                message: 'Internal server error',                      // Không lộ stack trace cho client
            });
        } else {
            res.end();                                               // Nếu đã gửi rồi thì chỉ kết thúc
        }
    }
}

// ---------------------------------------------------------------------------
// PHẦN 10: KHỞI ĐỘNG SERVER
// ---------------------------------------------------------------------------

// --- (MỚI - Bước 2A) Khởi tạo 2 file CSV dữ liệu nếu chưa tồn tại ---
try {
    await ensureAllCsvFiles();                                        // Tạo users.csv/tasks.csv kèm header nếu thiếu
    console.log('[storage] Đã chuẩn bị file CSV: backend/db/users.csv, backend/db/tasks.csv');
} catch (error) {
    console.error('[storage] LỖI khởi tạo file CSV:', error.message); // In lỗi ngắn gọn, không in stack trace
    process.exit(1);                                                  // Dừng server vì không có nơi lưu dữ liệu
}

const server = http.createServer(requestHandler);              // Tạo server từ hàm xử lý request
server.listen(PORT, () => {                                    // Lắng nghe kết nối trên cổng PORT
    console.log('==========================================================');
    console.log(`[server] Todo list đang chạy tại : http://localhost:${PORT}`);
    console.log(`[server] Trang Login            : http://localhost:${PORT}${DEFAULT_PAGE}`);
    console.log(`[server] Kiểm tra API           : http://localhost:${PORT}/api/health`);
    console.log('==========================================================');
});
server.on('error', (error) => {                                // Bắt lỗi khi mở cổng (ví dụ cổng bị chiếm)
    console.error('[server] Không thể khởi động server:', error.message);  // In lý do cụ thể
    process.exit(1);                                             // Thoát để người dùng biết cấu hình sai
});
process.on('unhandledRejection', (reason) => {                 // Lỗi Promise không được xử lý
    console.error('[server] Unhandled rejection:', reason);      // Ghi log thay vì làm sập server
});
process.on('uncaughtException', (error) => {                   // Lỗi đồng bộ không được xử lý
    console.error('[server] Uncaught exception:', error);        // Ghi log để còn debug
});