/**
 * ============================================================================
 *  FILE    : backend/scripts/testFrontendAssets.js
 *  MỤC ĐÍCH: Kiểm tra tự động phần frontend (Bước 6) NGAY TỪ TERMINAL:
 *            - 9 file tĩnh (3 HTML, 3 JS, 3 CSS) phục vụ đúng 200 + content-type.
 *            - HTML chứa đủ các phần tử mà JS cần (id khớp nhau giữa HTML và JS).
 *            - HTML có đúng bố cục trong ảnh của giảng viên (nút Login/SignUp có
 *              khung, link Sign Up/Login không khung).
 *            - JS gọi đúng API và dùng chung một khoá localStorage.
 *            - An toàn: không render HTML thô từ dữ liệu ngoài, không có bí mật.
 *            - Regression: file lạ -> 404; path traversal không đọc được .env.
 *  CÁCH CHẠY:
 *            1) Terminal 1: npm start
 *            2) Terminal 2: node backend/scripts/testFrontendAssets.js
 *  LƯU Ý   : Đây là kiểm tra tĩnh (đọc nội dung qua HTTP) + kiểm tra phục vụ file
 *            tĩnh. Các thao tác click thật trên trình duyệt nằm trong checklist
 *            kiểm thử thủ công ở Bước 8.
 * ============================================================================
 */

import path from 'node:path';                                    // Ghép đường dẫn file .env

// --- Nạp .env (nếu có) để biết cổng server ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));   // Đọc .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng PORT mặc định 3000.');      // Vẫn chạy được test
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;     // Địa chỉ server để gọi

// Danh sách file tĩnh cần kiểm tra kèm content-type mong đợi
const FRONTEND_ASSETS = [
    ['/page/login.html', 'text/html'],                  // Trang Login
    ['/page/signup.html', 'text/html'],                 // Trang Sign Up
    ['/page/assign-task.html', 'text/html'],            // Trang Task list
    ['/script/login.js', 'text/javascript'],            // Script trang Login
    ['/script/signup.js', 'text/javascript'],           // Script trang Sign Up
    ['/script/assign-task.js', 'text/javascript'],      // Script trang Task list
    ['/style/login.css', 'text/css'],                   // Style trang Login
    ['/style/signup.css', 'text/css'],                  // Style trang Sign Up
    ['/style/assign-task.css', 'text/css'],             // Style trang Task list
];

// Các id mà JS cần có trong HTML (nếu lệch nhau thì trang sẽ vỡ khi bấm nút)
const LOGIN_REQUIRED_IDS = ['login-form', 'email', 'password', 'email-error', 'password-error', 'message', 'login-button', 'resend-button'];
const SIGNUP_REQUIRED_IDS = ['signup-form', 'name', 'email', 'password', 'name-error', 'email-error', 'password-error', 'message', 'signup-button'];
const TASK_REQUIRED_IDS = ['user-name', 'logout-button', 'message', 'add-task-form', 'task-input', 'add-task-button', 'task-input-error', 'add-task-message', 'task-list', 'task-list-message'];

let passedCases = 0;                                 // Đếm số case đạt
let failedCases = 0;                                 // Đếm số case lỗi
let skippedCases = 0;                                // Đếm số case bị bỏ qua khi server chưa chạy

// Lưu nội dung của từng file sau khi tải về, dùng lại cho nhiều case
const assetContents = new Map();

// Chạy 1 case test và in kết quả
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                            // Thực thi nội dung kiểm tra
        passedCases += 1;                                // Tăng biến đếm đạt
        console.log(`✅ PASS: ${caseName}`);             // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                // Tăng biến đếm lỗi
        console.log(`❌ FAIL: ${caseName}`);             // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);       // In lý do cụ thể để dễ sửa
    }
}

// Kiểm tra điều kiện đúng; sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);        // Ném lỗi khi điều kiện sai
}

// Tải 1 file từ server, trả về status, content-type và nội dung text
async function fetchAsset(assetPath) {
    const response = await fetch(`${BASE_URL}${assetPath}`);                     // Gọi HTTP GET file tĩnh
    const text = await response.text();                                          // Đọc nội dung dạng text
    return { status: response.status, contentType: response.headers.get('content-type') || '', text };   // Trả thông tin cần thiết
}

// Kiểm tra HTML có chứa id cụ thể hay không (khớp chính xác thuộc tính id="...")
function hasElementId(htmlText, elementId) {
    return htmlText.includes(`id="${elementId}"`);                               // So khớp chuỗi thuộc tính id
}

// Hàm chính
async function main() {
    console.log('=== BẮT ĐẦU TEST FRONTEND (BƯỚC 6) ===\n');

    // Kiểm tra server có đang chạy không trước khi test
    let serverIsUp = false;                                                       // Cờ xác nhận server đang chạy
    try {
        const health = await fetch(`${BASE_URL}/api/health`);                      // Gọi endpoint health
        serverIsUp = health.status === 200;                                        // Server sống nếu trả 200
    } catch {
        serverIsUp = false;                                                        // Không kết nối được
    }

    if (!serverIsUp) {                                                           // Server chưa chạy -> bỏ qua toàn bộ
        skippedCases = 16;                                                         // Ghi nhận toàn bộ case bị bỏ qua
        console.log(`⚠️  SKIP: Server chưa chạy ở ${BASE_URL} - hãy chạy "npm start" rồi chạy lại script.`);
        console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);
        process.exit(0);                                                           // Thoát bình thường vì đã báo rõ lý do
    }

    // Tải trước toàn bộ 9 file để các case sau dùng lại, không phải gọi lại nhiều lần
    for (const [assetPath] of FRONTEND_ASSETS) {                                 // Duyệt từng file
        assetContents.set(assetPath, await fetchAsset(assetPath));                 // Tải và lưu vào Map
    }

    // Lấy sẵn nội dung từng file cho dễ đọc
    const loginHtml = assetContents.get('/page/login.html').text;                // Nội dung login.html
    const signupHtml = assetContents.get('/page/signup.html').text;              // Nội dung signup.html
    const taskHtml = assetContents.get('/page/assign-task.html').text;           // Nội dung assign-task.html
    const loginJs = assetContents.get('/script/login.js').text;                  // Nội dung login.js
    const signupJs = assetContents.get('/script/signup.js').text;                // Nội dung signup.js
    const taskJs = assetContents.get('/script/assign-task.js').text;             // Nội dung assign-task.js

    // ---------- CASE 1: phục vụ đủ 9 file ----------
    await runCase('Phục vụ đủ 9 file tĩnh với status 200 và content-type đúng', async () => {
        for (const [assetPath, expectedType] of FRONTEND_ASSETS) {                 // Duyệt từng file cần kiểm tra
            const asset = assetContents.get(assetPath);                              // Lấy kết quả đã tải
            expect(asset.status === 200, `${assetPath} phải trả 200, nhận được ${asset.status}`);
            expect(asset.contentType.includes(expectedType), `${assetPath} phải có content-type "${expectedType}", nhận được "${asset.contentType}"`);
            expect(asset.text.length > 0, `${assetPath} trả về nội dung rỗng`);
        }
    });

    // ---------- CASE 2: charset UTF-8 ----------
    await runCase('HTML/CSS/JS đều khai báo charset UTF-8 (hiển thị tiếng Việt đúng)', async () => {
        for (const [assetPath] of FRONTEND_ASSETS) {                               // Duyệt từng file
            const asset = assetContents.get(assetPath);                              // Lấy kết quả đã tải
            expect(asset.contentType.includes('utf-8'), `${assetPath} phải khai báo charset=utf-8, nhận được "${asset.contentType}"`);
        }
    });

    // ---------- CASE 3: login.html đủ phần tử ----------
    await runCase('login.html có đủ phần tử mà login.js cần', async () => {
        for (const elementId of LOGIN_REQUIRED_IDS) {                              // Duyệt danh sách id yêu cầu
            expect(hasElementId(loginHtml, elementId), `login.html thiếu id="${elementId}"`);
        }
    });

    // ---------- CASE 4: login.html đúng bố cục trong ảnh giảng viên ----------
    await runCase('login.html đúng bố cục ảnh giảng viên (tiêu đề, nút Login có khung, link Sign Up)', async () => {
        expect(loginHtml.includes('Todo list'), 'Phải có tiêu đề "Todo list"');
        expect(loginHtml.includes('>Login<'), 'Phải có nút "Login" (chữ đúng như ảnh)');
        expect(loginHtml.includes('class="button"'), 'Nút Login phải có class "button" (được đóng khung)');
        expect(loginHtml.includes('>Sign Up<'), 'Phải có link "Sign Up"');
        expect(loginHtml.includes('href="/page/signup.html"'), 'Link Sign Up phải trỏ tới trang đăng ký');
        expect(loginHtml.includes('class="link"'), 'Link Sign Up phải dùng class "link" (không đóng khung)');
        expect(loginHtml.includes('id="email-error"') && loginHtml.includes('id="password-error"'), 'Phải có vùng báo lỗi cho cả 2 ô nhập');
    });

    // ---------- CASE 5: signup.html đủ phần tử ----------
    await runCase('signup.html có đủ phần tử mà signup.js cần', async () => {
        for (const elementId of SIGNUP_REQUIRED_IDS) {                             // Duyệt danh sách id yêu cầu
            expect(hasElementId(signupHtml, elementId), `signup.html thiếu id="${elementId}"`);
        }
    });

    // ---------- CASE 6: signup.html đúng bố cục ----------
    await runCase('signup.html đúng bố cục ảnh giảng viên (nút SignUp có khung, link Login)', async () => {
        expect(signupHtml.includes('Todo list'), 'Phải có tiêu đề "Todo list"');
        expect(signupHtml.includes('>SignUp<'), 'Phải có nút "SignUp" (chữ đúng như ảnh)');
        expect(signupHtml.includes('class="button"'), 'Nút SignUp phải có class "button" (được đóng khung)');
        expect(signupHtml.includes('>Login<'), 'Phải có link "Login" quay lại trang đăng nhập');
        expect(signupHtml.includes('href="/page/login.html"'), 'Link Login phải trỏ tới trang Login');
        expect(signupHtml.includes('class="link"'), 'Link Login phải dùng class "link" (không đóng khung)');
        expect(signupHtml.includes(`maxlength`) || signupHtml.includes('password'), 'Phải có ô mật khẩu để nhập');
    });

    // ---------- CASE 7: assign-task.html đủ phần tử ----------
    await runCase('assign-task.html có đủ phần tử mà assign-task.js cần', async () => {
        for (const elementId of TASK_REQUIRED_IDS) {                               // Duyệt danh sách id yêu cầu
            expect(hasElementId(taskHtml, elementId), `assign-task.html thiếu id="${elementId}"`);
        }
    });

    // ---------- CASE 8: assign-task.html có đủ khu vực theo ảnh ----------
    await runCase('assign-task.html có khu vực Add task, Task list và nút Logout', async () => {
        expect(taskHtml.includes('>Add<'), 'Phải có nút "Add" cạnh ô nhập task (theo ảnh)');
        expect(taskHtml.includes('Task list'), 'Phải có khu vực "Task list"');
        expect(taskHtml.includes('>Logout<'), 'Phải có nút Logout');
        expect(taskHtml.includes('maxlength="100"'), 'Ô nhập task phải giới hạn 100 ký tự như đề bài');
    });

    // ---------- CASE 9: login.js wiring ----------
    await runCase('login.js: gọi đúng API, lưu JWT vào localStorage, chuyển sang Task list', async () => {
        expect(loginJs.includes('/api/login'), 'login.js phải gọi POST /api/login');
        expect(loginJs.includes('/api/me'), 'login.js phải gọi /api/me để kiểm tra token có sẵn');
        expect(loginJs.includes('/api/resend-verification'), 'login.js phải gọi API gửi lại email xác thực khi tài khoản pending');
        expect(loginJs.includes('todo_token'), 'login.js phải dùng khoá localStorage "todo_token"');
        expect(loginJs.includes('localStorage.setItem'), 'login.js phải lưu token vào localStorage sau khi đăng nhập');
        expect(loginJs.includes('/page/assign-task.html'), 'login.js phải chuyển sang trang Task list khi đăng nhập thành công');
    });

    // ---------- CASE 10: signup.js wiring + không tự đăng nhập ----------
    await runCase('signup.js: gọi đúng API, kiểm tra đủ 5 quy tắc mật khẩu, KHÔNG tự đăng nhập', async () => {
        expect(signupJs.includes('/api/signup'), 'signup.js phải gọi POST /api/signup');
        expect(signupJs.includes('UPPERCASE_PATTERN'), 'signup.js phải kiểm tra quy tắc chữ in hoa');
        expect(signupJs.includes('LOWERCASE_PATTERN'), 'signup.js phải kiểm tra quy tắc chữ in thường');
        expect(signupJs.includes('SPECIAL_CHARACTER_PATTERN'), 'signup.js phải kiểm tra quy tắc ký tự đặc biệt');
        expect(signupJs.includes('MIN_PASSWORD_LENGTH') && signupJs.includes('MAX_PASSWORD_LENGTH'), 'signup.js phải kiểm tra độ dài 8-20 ký tự');
        expect(!signupJs.includes('localStorage.setItem'), 'signup.js KHÔNG được lưu token (tài khoản còn pending, chưa đăng nhập)');
    });

    // ---------- CASE 11: assign-task.js wiring ----------
    await runCase('assign-task.js: gọi đúng các API task + users + me + logout', async () => {
        expect(taskJs.includes('/api/tasks'), 'assign-task.js phải gọi API /api/tasks');
        expect(taskJs.includes('/api/users'), 'assign-task.js phải gọi API /api/users để lấy danh sách gán việc');
        expect(taskJs.includes('/api/me'), 'assign-task.js phải gọi /api/me khi mở trang');
        expect(taskJs.includes('/api/logout'), 'assign-task.js phải gọi /api/logout khi bấm Logout');
        expect(taskJs.includes("'POST'") && taskJs.includes("'PATCH'") && taskJs.includes("'DELETE'"), 'assign-task.js phải dùng đủ các method POST/PATCH/DELETE của API task');
    });

    // ---------- CASE 12: assign-task.js hành vi bắt buộc ----------
    await runCase('assign-task.js: xác nhận trước khi xoá, xử lý 401, dùng chung khoá token', async () => {
        expect(taskJs.includes('window.confirm('), 'Phải hỏi xác nhận trước khi xoá task (mục 12.4 của đề)');
        expect(taskJs.includes('todo_token'), 'Phải dùng chung khoá localStorage "todo_token" với trang Login');
        expect(taskJs.includes('response.status === 401'), 'Phải phát hiện lỗi 401 để xoá token và quay về Login');
        expect(taskJs.includes('/page/login.html'), 'Phải chuyển về trang Login khi hết phiên');
        expect(taskJs.includes('assignedToName') || taskJs.includes('usersById'), 'Phải hiển thị tên user được gán cạnh task');
    });

    // ---------- CASE 13: chống XSS ----------
    await runCase('Không render HTML thô từ dữ liệu ngoài (chống XSS)', async () => {
        const forbiddenApi = ['inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document.write', 'ev' + 'al('];   // Ghép chuỗi để chính file test không chứa các từ khoá này
        for (const scriptText of [loginJs, signupJs, taskJs]) {                    // Duyệt cả 3 file script
            for (const apiName of forbiddenApi) {                                    // Duyệt từng API nguy hiểm
                expect(!scriptText.includes(apiName), `File script chứa API nguy hiểm "${apiName}" - dữ liệu task phải render bằng textContent`);
            }
        }
        expect(taskJs.includes('textContent'), 'assign-task.js phải dùng textContent để hiển thị nội dung task');
    });

    // ---------- CASE 14: không nạp tài nguyên ngoài ----------
    await runCase('HTML không nạp tài nguyên bên ngoài (đúng yêu cầu HTML/CSS/JS thuần)', async () => {
        for (const htmlText of [loginHtml, signupHtml, taskHtml]) {                // Duyệt cả 3 trang HTML
            expect(!htmlText.includes('http://'), 'HTML không được nạp tài nguyên qua http:// (không dùng CDN)');
            expect(!htmlText.includes('https://'), 'HTML không được nạp tài nguyên qua https:// (không dùng CDN)');
        }
    });

    // ---------- CASE 15: không có bí mật trong frontend ----------
    await runCase('Không có bí mật nào trong file frontend', async () => {
        const forbiddenSecrets = ['JWT_SECRET', 'SMTP_APP_PASSWORD', 'passwordHash', 'passwordSalt', 'verificationTokenHash'];   // Tuyệt đối không xuất hiện ở frontend
        for (const [assetPath] of FRONTEND_ASSETS) {                              // Duyệt cả 9 file frontend
            const assetText = assetContents.get(assetPath).text;                    // Nội dung file
            for (const secretKey of forbiddenSecrets) {                             // Duyệt từng từ khoá cấm
                expect(!assetText.includes(secretKey), `${assetPath} chứa "${secretKey}" - không được để lộ bí mật ở frontend`);
            }
        }
    });

    // ---------- CASE 16: regression file lạ + path traversal ----------
    await runCase('Regression: file tĩnh không tồn tại -> 404; path traversal không đọc được .env', async () => {
        const missingAsset = await fetchAsset('/page/khong-ton-tai.html');         // File không tồn tại
        expect(missingAsset.status === 404, `File lạ phải trả 404, nhận được ${missingAsset.status}`);

        const traversalAttempts = ['/..%2F.env', '/..%2F..%2F.env', '/..%2Fpackage.json'];   // 3 kiểu tấn công đường dẫn
        for (const attemptPath of traversalAttempts) {                             // Duyệt từng kiểu tấn công
            const traversalResponse = await fetchAsset(attemptPath);                 // Gửi request tấn công
            expect(traversalResponse.status !== 200, `${attemptPath} KHÔNG được trả 200 (đã trả ${traversalResponse.status})`);
            expect(!traversalResponse.text.includes('JWT_SECRET'), `${attemptPath} đọc được nội dung file .env - lỗ hổng nghiêm trọng`);
            expect(!traversalResponse.text.includes('"dependencies"'), `${attemptPath} đọc được nội dung package.json - lỗ hổng nghiêm trọng`);
        }
    });

    // ---------- Tổng kết ----------
    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);
    console.log('[test] Nhắc lại: các thao tác click thật trên trình duyệt (đăng ký, mở Gmail, đăng nhập, kéo thả gán việc) sẽ làm theo checklist thủ công ở Bước 8.');
    process.exit(failedCases > 0 ? 1 : 0);                                       // Thoát mã lỗi nếu có case thất bại
}

main().catch((error) => {                                                      // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);                   // In đầy đủ để debug
    process.exit(1);                                                             // Thoát với mã lỗi
});