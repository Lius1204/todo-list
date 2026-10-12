/**
 * ============================================================================
 *  FILE    : backend/scripts/checkSmoke.js
 *  MỤC ĐÍCH: Kiểm tra nhanh "sức khoẻ" toàn hệ thống trước khi demo (smoke check).
 *            PHẦN A - không cần server đang chạy:
 *              - Biến môi trường bắt buộc (JWT_SECRET, đủ biến SMTP...)
 *              - 2 file CSV dữ liệu thật: đọc được và đúng header schema
 *              - File seed: đã sinh + nạp đủ 1.000.000 email + tra cứu đúng/sai
 *              - Đăng nhập thử Gmail SMTP (KHÔNG gửi email nào)
 *            PHẦN B - cần server đang chạy (npm start):
 *              - /api/health trả 200
 *              - Trang chủ "/" chuyển hướng về trang Login
 *              - 9 file tĩnh (3 HTML, 3 JS, 3 CSS) trả 200 đúng content-type
 *              - GET /api/tasks không token -> 401 (route + middleware còn sống)
 *              - POST /api/signup mật khẩu yếu -> 400 (validate còn sống)
 *              - POST /api/signup email trùng seed -> 409 (tính năng 1 triệu email còn sống)
 *              - Path traversal không đọc được .env
 *  CÁCH CHẠY: npm run check
 *  KẾT QUẢ : in PASS / WARN / FAIL; thoát mã 1 nếu có bất kỳ FAIL nào.
 * ============================================================================
 */

import path from 'node:path';                                                       // Ghép đường dẫn file .env
import {
    USERS_CSV_PATH, USERS_HEADERS,                                                    // users.csv + schema cột
    TASKS_CSV_PATH, TASKS_HEADERS,                                                    // tasks.csv + schema cột
    readCsvFile,                                                                      // Đọc CSV (tự kiểm header)
    updateCsvFile,                                                                    // Cập nhật CSV qua hàng đợi (dùng để dọn dẹp)
} from '../src/utils/csvUtils.js';
import { loadSeedEmails, isEmailSeeded } from '../src/services/seedEmailService.js';                // Dịch vụ seed 1 triệu email
import { verifySmtpConnection, getMissingEmailConfigKeys } from '../src/services/emailService.js';  // Kiểm tra đăng nhập SMTP

// --- Nạp .env (nếu có) để có đủ cấu hình cho phần kiểm tra ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));          // Đọc .env ở thư mục gốc dự án
} catch {
    console.log('[check] Không tìm thấy file .env - sẽ dùng biến môi trường của hệ điều hành.');   // Vẫn chạy tiếp
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;            // Địa chỉ server cần kiểm tra
const EXPECTED_SEED_TOTAL = 1_000_000;                                              // Số email seed bắt buộc theo yêu cầu giảng viên
const DEMO_SEED_INDEX = 4242;                                                       // Số thứ tự của email seed dùng để demo chặn trùng
const DEMO_SEED_EMAIL = `seeduser${String(DEMO_SEED_INDEX).padStart(7, '0')}@example.com`;   // Ghép theo ĐÚNG công thức của seedUsers.js: đệm 0 đủ 7 chữ số
const TRAVERSAL_PATHS = ['/..%2F.env', '/..%2F..%2F.env'];                          // 2 kiểu tấn công đường dẫn cần bị chặn
const VALID_PASSWORD = 'Example@123';                                               // Mật khẩu đúng quy tắc (để test chặn trùng email)

// Danh sách 9 file tĩnh cần kiểm tra: [đường dẫn, content-type mong đợi, chuỗi phải có trong nội dung]
const FRONTEND_ASSETS = [
    ['/page/login.html', 'text/html', 'Todo list'],          // Trang Login
    ['/page/signup.html', 'text/html', 'SignUp'],            // Trang Sign Up
    ['/page/assign-task.html', 'text/html', 'Task list'],    // Trang Task list
    ['/script/login.js', 'text/javascript', '/api/login'],   // Script trang Login
    ['/script/signup.js', 'text/javascript', '/api/signup'], // Script trang Sign Up
    ['/script/assign-task.js', 'text/javascript', '/api/tasks'],   // Script trang Task list
    ['/style/login.css', 'text/css', '.button'],             // Style trang Login
    ['/style/signup.css', 'text/css', '.button'],            // Style trang Sign Up
    ['/style/assign-task.css', 'text/css', '.task-item'],    // Style trang Task list
];

let passedCount = 0;                                    // Đếm số mục PASS
let warnedCount = 0;                                    // Đếm số mục WARN (không chặn demo)
let failedCount = 0;                                    // Đếm số mục FAIL (phải sửa trước khi demo)
let httpSkipped = false;                                // Cờ báo phần HTTP bị bỏ qua vì server chưa chạy

// In kết quả của một mục kiểm tra theo 3 mức pass / warn / fail
function report(kind, name, detail = '') {
    const suffix = detail === '' ? '' : ` - ${detail}`;   // Nối phần chi tiết nếu có
    if (kind === 'pass') { passedCount += 1; console.log(`✅ PASS: ${name}${suffix}`); return; }        // Mục đạt
    if (kind === 'warn') { warnedCount += 1; console.log(`⚠️  WARN: ${name}${suffix}`); return; }       // Mục cảnh báo
    failedCount += 1;                                     // Còn lại là FAIL
    console.log(`❌ FAIL: ${name}${suffix}`);             // In mục lỗi kèm chi tiết
}

// Xoá 1 dòng user theo email (dùng để dọn dẹp nếu smoke check vô tình tạo tài khoản)
async function removeUserByEmail(email) {
    let removedCount = 0;                                 // Đếm số dòng đã xoá
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = rows.filter((row) => {             // Lọc giữ lại các dòng không khớp email
            const shouldKeep = row.email !== email;           // Chỉ giữ dòng có email khác
            if (!shouldKeep) removedCount += 1;               // Ghi nhận dòng bị xoá
            return shouldKeep;                                // Trả kết quả cho filter
        });
        return keptRows;                                    // Ghi lại users.csv
    });
    return removedCount;                                  // Trả về số dòng đã xoá
}

// --- PHẦN A1: kiểm tra cấu hình môi trường ---
function checkConfig() {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length > 0) {              // Có khoá bí mật JWT
        report('pass', 'JWT_SECRET đã cấu hình (không in giá trị ra màn hình)');      // Không bao giờ in giá trị bí mật
    } else {
        report('fail', 'Thiếu JWT_SECRET trong .env', 'server sẽ không khởi động được');   // Lỗi chặn demo
    }

    const expiresDays = process.env.JWT_EXPIRES_DAYS;                               // Số ngày sống của token
    report('pass', `JWT_EXPIRES_DAYS = ${expiresDays && expiresDays.trim() !== '' ? expiresDays : '(trống, dùng mặc định 3)'}`);   // Chỉ in con số, không bí mật

    const missingSmtpKeys = getMissingEmailConfigKeys();                            // Các biến SMTP còn thiếu
    if (missingSmtpKeys.length > 0) {
        report('warn', `Thiếu biến SMTP: ${missingSmtpKeys.join(', ')}`, 'chức năng gửi email xác thực sẽ không hoạt động');   // Cảnh báo, không chặn
    } else {
        report('pass', 'Đủ biến cấu hình SMTP (host, port, user, app password, base url)');   // Đủ 5 biến
    }
}

// --- PHẦN A2: kiểm tra 2 file CSV dữ liệu thật ---
async function checkStorage() {
    const csvTargets = [                                                             // 2 file cần kiểm tra
        ['users.csv', USERS_CSV_PATH, USERS_HEADERS],                                  // File tài khoản
        ['tasks.csv', TASKS_CSV_PATH, TASKS_HEADERS],                                  // File công việc
    ];
    for (const [label, filePath, headers] of csvTargets) {                           // Duyệt từng file
        try {
            const rows = await readCsvFile(filePath, headers);                           // Đọc CSV (tự tạo nếu thiếu, tự kiểm header)
            report('pass', `${label} đọc được, header đúng (${rows.length} dòng dữ liệu)`);   // Đọc OK
        } catch (error) {
            report('fail', `${label} lỗi: ${error.message}`, 'xem mục Troubleshooting trong README');   // Header sai / file hỏng
        }
    }
}

// --- PHẦN A3: kiểm tra file seed 1 triệu email ---
async function checkSeed() {
    let seedStats;                                                                   // Thống kê sau khi nạp seed
    try {
        seedStats = await loadSeedEmails();                                            // Nạp danh sách seed vào RAM (chỉ 1 lần)
    } catch (error) {
        report('fail', `Nạp seed lỗi: ${error.message}`);                              // Lỗi đọc file seed
        return;                                                                        // Không kiểm tra tiếp được
    }

    if (!seedStats.loaded) {                                                         // File seed chưa tồn tại
        report('fail', 'Chưa có backend/db/seed_users.csv', 'chạy: npm run seed  rồi chạy lại npm run check');   // Hướng dẫn cụ thể
        return;                                                                        // Dừng phần seed
    }
    if (seedStats.totalEmails !== EXPECTED_SEED_TOTAL) {                             // Số lượng email không đúng yêu cầu
        report('fail', `Seed phải đủ ${EXPECTED_SEED_TOTAL.toLocaleString('en-US')} email, hiện có ${seedStats.totalEmails.toLocaleString('en-US')}`, 'chạy: npm run seed -- --force');
        return;                                                                        // Dừng phần seed
    }
    report('pass', `Seed đủ ${seedStats.totalEmails.toLocaleString('en-US')} email (nạp ${seedStats.loadDurationMs} ms, RAM tăng ~${seedStats.heapDeltaMb} MB)`);   // Đủ 1 triệu

    const demoEmailFound = await isEmailSeeded(DEMO_SEED_EMAIL);                     // Tra thử email demo (dùng cho buổi demo)
    if (demoEmailFound) {
        report('pass', `Tra cứu email demo OK: ${DEMO_SEED_EMAIL}`);                   // Tìm thấy đúng
    } else {
        report('fail', `Không tìm thấy ${DEMO_SEED_EMAIL} trong seed`);                // Dữ liệu seed có vấn đề
    }

    const missingEmailFound = await isEmailSeeded(`absent.${Date.now()}@example.com`);   // Email chắc chắn không có trong seed
    if (missingEmailFound) {
        report('fail', 'Email không tồn tại trong seed lại bị báo đã có (dương tính giả)');   // Sai nghiêm trọng
    } else {
        report('pass', 'Email không có trong seed trả về false (không dương tính giả)');    // Đúng hành vi
    }
}

// --- PHẦN A4: kiểm tra đăng nhập Gmail SMTP (không gửi email nào) ---
async function checkSmtpLogin() {
    if (getMissingEmailConfigKeys().length > 0) return;                              // Thiếu cấu hình -> đã cảnh báo ở checkConfig
    const startedAt = performance.now();                                             // Bắt đầu tính thời gian đăng nhập SMTP
    try {
        await verifySmtpConnection();                                                  // Đăng nhập thử (chỉ kiểm tra, KHÔNG gửi mail)
        const durationMs = (performance.now() - startedAt).toFixed(0);                 // Thời gian đăng nhập
        report('pass', `Gmail SMTP đăng nhập OK trong ${durationMs} ms (không gửi email nào)`);   // Tài khoản Gmail hoạt động
    } catch (error) {
        report('warn', `Gmail SMTP đăng nhập thất bại: ${error.message}`, 'kiểm tra App Password / 2-Step Verification (xem README mục Troubleshooting)');   // Cảnh báo, không chặn demo
    }
}

// --- PHẦN B: kiểm tra qua HTTP (cần server đang chạy) ---
async function checkHttp() {
    try {
        const healthResponse = await fetch(`${BASE_URL}/api/health`);                  // Gọi endpoint kiểm tra sức khoẻ
        const healthJson = await healthResponse.json().catch(() => null);              // Đọc JSON an toàn
        if (healthResponse.status === 200 && healthJson && healthJson.status === 'OK') {
            report('pass', '/api/health trả 200 OK');                                    // Server sống, đúng quy ước JSON
        } else {
            report('fail', `/api/health trả ${healthResponse.status}`, 'kiểm tra lại server');   // Phản hồi bất thường
            return;                                                                      // Không kiểm tra tiếp được
        }
    } catch {
        report('warn', `Server chưa chạy ở ${BASE_URL}`, 'các kiểm tra HTTP bị bỏ qua - chạy "npm start" rồi chạy lại "npm run check"');   // Không chặn
        httpSkipped = true;                                                            // Đánh dấu để nhắc ở phần tổng kết
        return;                                                                        // Dừng phần HTTP
    }

    const rootResponse = await fetch(`${BASE_URL}/`);                                // Gọi trang chủ
    if (rootResponse.status === 200 && rootResponse.url.includes('/page/login.html')) {
        report('pass', 'Trang chủ "/" chuyển hướng về /page/login.html');              // Đúng yêu cầu mục 13 của đề
    } else {
        report('fail', `Trang chủ không chuyển hướng đúng (status ${rootResponse.status}, url ${rootResponse.url})`);   // Sai redirect
    }

    let assetsOk = true;                                                             // Cờ đánh dấu 9 file tĩnh đều OK
    for (const [assetPath, expectedType, requiredText] of FRONTEND_ASSETS) {         // Duyệt từng file tĩnh
        try {
            const assetResponse = await fetch(`${BASE_URL}${assetPath}`);                // Tải file
            const assetText = await assetResponse.text();                                // Đọc nội dung
            const contentType = assetResponse.headers.get('content-type') || '';         // Kiểm tra content-type
            if (assetResponse.status !== 200 || !contentType.includes(expectedType) || !assetText.includes(requiredText)) {
                assetsOk = false;                                                          // Bất kỳ file lỗi -> đánh dấu
                report('fail', `File tĩnh ${assetPath} không đạt (status ${assetResponse.status}, type "${contentType}")`);
            }
        } catch (error) {
            assetsOk = false;                                                            // Lỗi mạng khi tải file
            report('fail', `Không tải được ${assetPath}: ${error.message}`);
        }
    }
    if (assetsOk) report('pass', '9 file tĩnh (3 HTML, 3 JS, 3 CSS) phục vụ đúng content-type và nội dung');   // Tất cả file ổn

    const unauthorizedResponse = await fetch(`${BASE_URL}/api/tasks`);               // Gọi API bảo vệ KHÔNG kèm token
    if (unauthorizedResponse.status === 401) {
        report('pass', 'GET /api/tasks không token -> 401 (middleware xác thực còn sống)');   // Đúng như thiết kế
    } else {
        report('fail', `GET /api/tasks không token phải 401, nhận được ${unauthorizedResponse.status}`);   // Lỗ hổng nghiêm trọng
    }

    const weakPasswordResponse = await fetch(`${BASE_URL}/api/signup`, {             // Gọi đăng ký với mật khẩu yếu
        method: 'POST',                                                                // Phương thức POST
        headers: { 'Content-Type': 'application/json' },                               // Body JSON
        body: JSON.stringify({ name: 'Smoke Check', email: 'smoke.check@example.com', password: 'weak' }),   // Cố tình sai quy tắc mật khẩu
    });
    if (weakPasswordResponse.status === 400) {
        report('pass', 'POST /api/signup mật khẩu yếu -> 400 (validate còn sống)');     // Bị chặn trước khi ghi dữ liệu
    } else {
        report('fail', `POST /api/signup mật khẩu yếu phải 400, nhận được ${weakPasswordResponse.status}`);   // Validate hỏng
    }

    const seededSignupResponse = await fetch(`${BASE_URL}/api/signup`, {             // Đăng ký bằng email nằm trong 1 triệu seed
        method: 'POST',                                                                // Phương thức POST
        headers: { 'Content-Type': 'application/json' },                               // Body JSON
        body: JSON.stringify({ name: 'Smoke Check', email: DEMO_SEED_EMAIL, password: VALID_PASSWORD }),   // Email hợp lệ nhưng trùng seed
    });
    if (seededSignupResponse.status === 409) {
        report('pass', `POST /api/signup email trùng seed -> 409 (tính năng 1 triệu email OK: ${DEMO_SEED_EMAIL})`);   // Chặn đúng
    } else if (seededSignupResponse.status === 201) {
        const removedCount = await removeUserByEmail(DEMO_SEED_EMAIL);                 // Server đã tạo nhầm tài khoản -> xoá đi
        report('fail', 'Email trùng seed KHÔNG bị chặn', `server chạy mà chưa nạp seed - chạy "npm run seed" rồi KHỞI ĐỘNG LẠI server (đã dọn ${removedCount} dòng vừa tạo)`);
    } else {
        report('fail', `POST /api/signup email trùng seed phải 409, nhận được ${seededSignupResponse.status}`);   // Phản hồi bất thường
    }

    let traversalOk = true;                                                          // Cờ đánh dấu chống path traversal còn tốt
    for (const traversalPath of TRAVERSAL_PATHS) {                                   // Duyệt 2 kiểu tấn công
        const traversalResponse = await fetch(`${BASE_URL}${traversalPath}`);          // Gửi request tấn công
        const traversalText = await traversalResponse.text();                          // Đọc nội dung trả về
        if (traversalResponse.status === 200 || traversalText.includes('JWT_SECRET')) {   // Đọc được .env = lỗ hổng chí mạng
            traversalOk = false;                                                         // Đánh dấu thất bại
            report('fail', `Path traversal ${traversalPath} đọc được file ngoài frontend!`);   // Lỗi nghiêm trọng
        }
    }
    if (traversalOk) report('pass', 'Path traversal bị chặn (không đọc được .env, package.json)');   // An toàn
}

// Hàm chính: chạy lần lượt các phần rồi in tổng kết
async function main() {
    console.log('=== SMOKE CHECK TOÀN HỆ THỐNG (BƯỚC 8) ===\n');
    console.log(`[check] Địa chỉ server : ${BASE_URL}`);                             // In địa chỉ sẽ kiểm tra
    console.log(`[check] File .env       : ${process.env.JWT_SECRET ? 'đã nạp' : 'chưa thấy JWT_SECRET'}\n`);   // Không in bí mật

    console.log('--- PHẦN A: Cấu hình, dữ liệu, seed, SMTP (không cần server) ---');
    checkConfig();                                                                   // Kiểm tra .env
    await checkStorage();                                                            // Kiểm tra 2 file CSV
    await checkSeed();                                                               // Kiểm tra seed 1 triệu email
    await checkSmtpLogin();                                                          // Kiểm tra đăng nhập Gmail SMTP

    console.log('\n--- PHẦN B: HTTP thật (cần server đang chạy: npm start) ---');
    try {
        await checkHttp();                                                             // Kiểm tra toàn bộ endpoint + file tĩnh + bảo mật
    } catch (error) {
        report('fail', 'Kiểm tra HTTP lỗi không mong đợi', error.message);             // Bắt lỗi mạng ngoài dự kiến
    }

    console.log(`\n=== KẾT QUẢ SMOKE CHECK: ${passedCount} PASS / ${warnedCount} WARN / ${failedCount} FAIL ===`);
    if (httpSkipped) console.log('[check] Lưu ý: phần HTTP bị bỏ qua vì server chưa chạy - hãy bật server rồi chạy lại.');   // Nhắc rõ
    if (failedCount > 0) {                                                           // Có lỗi chặn demo
        console.log('[check] Còn FAIL - xem chi tiết phía trên để sửa trước khi demo.');   // Hướng dẫn
        process.exit(1);                                                               // Thoát mã lỗi
    }
    console.log('[check] Hệ thống sẵn sàng demo ✔');                                 // Tất cả đạt
}

main().catch((error) => {                                                          // Bắt lỗi ngoài dự kiến của cả script
    console.error('[check] Lỗi không mong đợi:', error);                             // In đầy đủ để debug
    process.exit(1);                                                                 // Thoát mã lỗi
});