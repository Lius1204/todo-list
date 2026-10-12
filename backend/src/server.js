/**
 * ============================================================================
 *  FILE    : backend/src/server.js
 *  MỤC ĐÍCH: HTTP server chính của ứng dụng Todo list.
 *            - Phục vụ file tĩnh (HTML, CSS, JS) trong thư mục frontend/
 *            - Điều phối request API dưới tiền tố /api tới các file route
 *            - Khởi tạo file CSV dữ liệu khi server bắt đầu chạy
 *            - KHÔNG dùng Express hay framework backend nào (đúng yêu cầu đề)
 *  YÊU CẦU : Node.js >= 20.12 (dùng process.loadEnvFile + ES Module)
 *  CẬP NHẬT: Bước 2A khởi tạo CSV, 2B dùng chung responseUtils,
 *            Bước 3 thêm đọc JSON body + nhóm route xác thực.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// PHẦN 1: IMPORT MODULE CỦA NODE.JS VÀ CÁC MODULE DÙNG CHUNG CỦA DỰ ÁN
// ---------------------------------------------------------------------------
import http from 'node:http';                                             // Module http: tạo web server thuần của Node.js
import fsp from 'node:fs/promises';                                       // Module fs (bản Promise): đọc file bất đồng bộ
import path from 'node:path';                                             // Module path: ghép và chuẩn hoá đường dẫn an toàn
import { ensureAllCsvFiles } from './utils/csvUtils.js';                  // (2A) Khởi tạo users.csv/tasks.csv kèm header nếu thiếu
import { readJsonBody } from './utils/httpUtils.js';                      // (3)  Đọc và parse JSON body an toàn, có giới hạn dung lượng
import { sendSuccess, sendError, sendErrorFromException } from './utils/responseUtils.js';   // (2B) Quy ước JSON dùng chung
import { handleAuthRoutes } from './routes/authRoutes.js';                // (3)  Nhóm API xác thực (signup, verify, resend)
import { handleTaskRoutes } from './routes/taskRoutes.js';                // (5)  Nhóm API users + tasks (list, create, patch, delete)
// ---------------------------------------------------------------------------
// PHẦN 2: XÁC ĐỊNH ĐƯỜNG DẪN GỐC CỦA DỰ ÁN
// ---------------------------------------------------------------------------
const SRC_DIR = import.meta.dirname;                                     // Thư mục chứa file này = backend/src
const PROJECT_ROOT = path.resolve(SRC_DIR, '..', '..');                  // Lùi 2 cấp -> thư mục gốc dự án
const ENV_FILE = path.join(PROJECT_ROOT, '.env');                        // Đường dẫn file cấu hình .env
const STATIC_ROOT = path.join(PROJECT_ROOT, 'frontend');                 // Thư mục frontend được phép truy cập
const DEFAULT_PAGE = '/page/login.html';                                 // Trang mặc định khi vào đường dẫn "/"

// ---------------------------------------------------------------------------
// PHẦN 3: NẠP BIẾN MÔI TRƯỜNG TỪ FILE .env
// ---------------------------------------------------------------------------
try {
    process.loadEnvFile(ENV_FILE);                                         // Đọc file .env và gán vào process.env
} catch {
    console.warn('[config] Không tìm thấy file .env - sẽ dùng biến môi trường của hệ điều hành.');
}

// ---------------------------------------------------------------------------
// PHẦN 4: ĐỌC VÀ KIỂM TRA CẤU HÌNH BẮT BUỘC
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);                           // Cổng server, mặc định 3000
const JWT_SECRET = process.env.JWT_SECRET || '';                         // Khoá bí mật ký JWT (bắt buộc)

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {               // Cổng không hợp lệ -> dừng ngay
    console.error('[config] LỖI: PORT trong file .env phải là số từ 1 đến 65535.');
    process.exit(1);                                                       // Thoát chương trình với mã lỗi
}

if (!JWT_SECRET) {                                                       // Thiếu khoá bí mật JWT
    console.error('[config] LỖI: Chưa khai báo JWT_SECRET trong file .env.');
    console.error('[config] Tạo nhanh: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);                                                       // Không chạy khi thiếu cấu hình bảo mật
}

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'APP_BASE_URL'];   // Các biến cần cho email
const missingSmtpKeys = SMTP_KEYS.filter((key) => !process.env[key]);    // Lọc ra biến SMTP còn thiếu
if (missingSmtpKeys.length > 0) {                                        // Còn thiếu -> cảnh báo rõ ràng ngay khi khởi động
    console.warn(`[config] Cảnh báo: còn thiếu biến SMTP: ${missingSmtpKeys.join(', ')} - chức năng gửi email xác thực sẽ không hoạt động.`);
    console.warn('[config] Xem hướng dẫn tạo Gmail App Password trong README.md (mục Environment variables).');
}

// ---------------------------------------------------------------------------
// PHẦN 5: BẢNG ÁNH XẠ LOẠI FILE -> CONTENT-TYPE
// ---------------------------------------------------------------------------
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',                                   // Trang HTML, UTF-8 để hiện tiếng Việt đúng
    '.css': 'text/css; charset=utf-8',                                     // File style
    '.js': 'text/javascript; charset=utf-8',                               // File script frontend
    '.json': 'application/json; charset=utf-8',                            // Dữ liệu JSON
    '.png': 'image/png',                                                   // Ảnh PNG
    '.jpg': 'image/jpeg',                                                  // Ảnh JPG
    '.jpeg': 'image/jpeg',                                                 // Ảnh JPEG
    '.svg': 'image/svg+xml',                                               // Ảnh vector SVG
    '.ico': 'image/x-icon',                                                // Icon favicon
    '.txt': 'text/plain; charset=utf-8',                                   // File text thuần
};

// ---------------------------------------------------------------------------
// PHẦN 6: HÀM PHỤ TRỢ RIÊNG CHO FILE TĨNH
// ---------------------------------------------------------------------------
// GHI CHÚ: các hàm gửi JSON đã được chuyển sang backend/src/utils/responseUtils.js (Bước 2B)
function sendText(res, statusCode, message) {                            // Gửi phản hồi dạng text thuần
    res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.txt'] });     // Khai báo nội dung là text UTF-8
    res.end(message);                                                      // Gửi nội dung ra client
}

// ---------------------------------------------------------------------------
// PHẦN 7: PHỤC VỤ FILE TĨNH + CHỐNG PATH TRAVERSAL
// ---------------------------------------------------------------------------
// Chuyển URL thành đường dẫn file tuyệt đối; trả null nếu đường dẫn không hợp lệ
function resolveStaticPath(urlPath) {
    try {
        const decodedPath = decodeURIComponent(urlPath);                     // Giải mã %20, %2F... trong URL
        const absolutePath = path.resolve(STATIC_ROOT, '.' + decodedPath);   // Ghép và chuẩn hoá đường dẫn file
        if (absolutePath !== STATIC_ROOT && !absolutePath.startsWith(STATIC_ROOT + path.sep)) {
            return null;                                                       // Đường dẫn vượt ra ngoài frontend -> chặn
        }
        return absolutePath;                                                 // Đường dẫn hợp lệ
    } catch {
        return null;                                                         // URL sai định dạng -> chặn
    }
}

// Đọc file tĩnh từ đĩa và trả về cho trình duyệt
async function serveStaticFile(req, res, pathname) {
    const filePath = resolveStaticPath(pathname);                          // Lấy đường dẫn file an toàn
    if (!filePath) {                                                       // Đường dẫn không hợp lệ
        sendText(res, 403, '403 Forbidden');                                 // Trả lỗi 403 (bị chặn)
        return;                                                              // Kết thúc hàm
    }
    let fileBuffer;                                                        // Biến chứa nội dung file
    try {
        const stats = await fsp.stat(filePath);                              // Lấy thông tin file (kiểm tra tồn tại)
        if (!stats.isFile()) {                                               // Là thư mục chứ không phải file
            sendText(res, 404, '404 Not Found');                               // Trả lỗi 404
            return;                                                            // Kết thúc hàm
        }
        fileBuffer = await fsp.readFile(filePath);                           // Đọc toàn bộ file vào bộ nhớ
    } catch {
        sendText(res, 404, '404 Not Found');                                 // File không tồn tại -> lỗi 404
        return;                                                              // Kết thúc hàm
    }
    const extension = path.extname(filePath).toLowerCase();                // Lấy phần mở rộng, ví dụ ".css"
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';   // Chọn content-type phù hợp
    res.writeHead(200, {                                                   // Trả status 200 kèm header
        'Content-Type': contentType,                                         // Kiểu nội dung của file
        'Content-Length': fileBuffer.length,                                 // Độ dài file theo byte
        'Cache-Control': 'no-cache',                                         // Không cache để sửa code thấy ngay
    });
    if (req.method === 'HEAD') {                                           // Client chỉ hỏi header (HEAD)
        res.end();                                                           // Kết thúc, không gửi nội dung file
        return;                                                              // Kết thúc hàm
    }
    res.end(fileBuffer);                                                   // Gửi nội dung file cho trình duyệt
}

// ---------------------------------------------------------------------------
// PHẦN 8: XỬ LÝ API (điều phối tới từng nhóm route)
// ---------------------------------------------------------------------------
async function handleApiRequest(ctx) {
    const { req, res, pathname } = ctx;                                    // Lấy các thành phần cần dùng từ context

    if (pathname === '/api/health' && req.method === 'GET') {              // GET /api/health: kiểm tra server còn sống
        sendSuccess(res, 'Server is running', {                              // Trả JSON theo quy ước { status, message, data }
            nodeVersion: process.version,                                      // Phiên bản Node.js đang chạy
            uptimeSeconds: Math.round(process.uptime()),                       // Số giây server đã chạy
        });
        return;                                                              // Kết thúc hàm xử lý
    }

    // Nhóm route xác thực (Bước 3): signup, verify-email, resend-verification
    if (await handleAuthRoutes(ctx)) return;                               // Đã xử lý xong -> kết thúc

    // Nhóm route công việc (Bước 5): /api/users và /api/tasks
    if (await handleTaskRoutes(ctx)) return;                               // Đã xử lý xong -> kết thúc

    // Các nhóm route khác (users, tasks) sẽ được thêm ở Bước 5
    sendError(res, 404, `API endpoint not found: ${req.method} ${pathname}`);   // Không khớp endpoint nào
}

// ---------------------------------------------------------------------------
// PHẦN 9: HÀM XỬ LÝ CHÍNH CHO MỌI REQUEST
// ---------------------------------------------------------------------------
async function requestHandler(req, res) {
    try {
        const url = new URL(req.url, 'http://localhost');                    // Phân tích URL để lấy path và query
        const pathname = url.pathname;                                       // Ví dụ: /page/login.html

        if (pathname === '/api' || pathname.startsWith('/api/')) {           // Là request API
            let bodyPromise = null;                                            // Biến nhớ Promise đọc body (đọc 1 lần duy nhất)
            const getBody = () => {                                            // Hàm lấy body theo kiểu "lazy" (chỉ đọc khi cần)
                if (!bodyPromise) bodyPromise = readJsonBody(req);               // Lần gọi đầu tiên -> bắt đầu đọc body
                return bodyPromise;                                              // Các lần sau dùng lại cùng kết quả
            };
            await handleApiRequest({ req, res, url, pathname, getBody });      // Chuyển cho phần xử lý API kèm context
            return;                                                            // Kết thúc hàm
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {                 // File tĩnh chỉ cho phép GET/HEAD
            sendError(res, 405, 'Method not allowed for static files');        // Sai method -> trả 405
            return;                                                            // Kết thúc hàm
        }
        if (pathname === '/') {                                              // Vào trang chủ
            res.writeHead(302, { Location: DEFAULT_PAGE });                    // Điều hướng sang trang Login
            res.end();                                                         // Kết thúc phản hồi
            return;                                                            // Kết thúc hàm
        }
        await serveStaticFile(req, res, pathname);                           // Còn lại: phục vụ file tĩnh
    } catch (error) {                                                      // Bắt mọi lỗi bất ngờ của request
        sendErrorFromException(res, error, '[server]');                       // Log ở server + trả JSON lỗi an toàn
    }
}

// ---------------------------------------------------------------------------
// PHẦN 10: KHỞI ĐỘNG SERVER
// ---------------------------------------------------------------------------
try {
    await ensureAllCsvFiles();                                             // Tạo users.csv/tasks.csv kèm header nếu thiếu
    console.log('[storage] Đã chuẩn bị file CSV: backend/db/users.csv, backend/db/tasks.csv');
} catch (error) {
    console.error('[storage] LỖI khởi tạo file CSV:', error.message);      // In lỗi ngắn gọn, không in stack trace
    process.exit(1);                                                       // Dừng server vì không có nơi lưu dữ liệu
}

const server = http.createServer(requestHandler);                        // Tạo server từ hàm xử lý request
server.listen(PORT, () => {                                              // Lắng nghe kết nối trên cổng PORT
    console.log('==========================================================');
    console.log(`[server] Todo list đang chạy tại : http://localhost:${PORT}`);
    console.log(`[server] Trang Login            : http://localhost:${PORT}${DEFAULT_PAGE}`);
    console.log(`[server] Kiểm tra API           : http://localhost:${PORT}/api/health`);
    console.log('==========================================================');
});
server.on('error', (error) => {                                          // Bắt lỗi khi mở cổng (cổng bị chiếm...)
    console.error('[server] Không thể khởi động server:', error.message);  // In lý do cụ thể
    process.exit(1);                                                       // Thoát để người dùng biết cấu hình sai
});
process.on('unhandledRejection', (reason) => {                           // Lỗi Promise không được xử lý
    console.error('[server] Unhandled rejection:', reason);                // Ghi log thay vì làm sập server
});
process.on('uncaughtException', (error) => {                             // Lỗi đồng bộ không được xử lý
    console.error('[server] Uncaught exception:', error);                  // Ghi log để còn debug
});