/**
 * ============================================================================
 *  FILE    : backend/scripts/testLoginFlow.js
 *  MỤC ĐÍCH: Kiểm tra tự động toàn bộ luồng của Bước 4:
 *            - service login (đúng/sai mật khẩu, email tồn tại hay không)
 *            - middleware requireAuth (thiếu token, token rác, token bị sửa, hết hạn,
 *              tài khoản bị xoá hoặc không còn active)
 *            - API HTTP: /api/login, /api/me, /api/logout
 *            - ĐO HIỆU NĂNG login: 5 lần, in từng lần + trung vị + max (mục tiêu < 500ms)
 *  CÁCH CHẠY:
 *            1) Terminal 1: npm start
 *            2) Terminal 2: node backend/scripts/testLoginFlow.js
 *  GHI CHÚ : Chỉ tạo tài khoản test có email bắt đầu bằng "phase4.test."
 *            và TỰ XOÁ sạch khi chạy xong, không đụng dữ liệu thật.
 * ============================================================================
 */

import path from 'node:path';                                                  // Ghép đường dẫn file .env
import jwt from 'jsonwebtoken';                                                // Dùng riêng để ký token đã hết hạn phục vụ test
import { USERS_CSV_PATH, USERS_HEADERS, updateCsvFile } from '../src/utils/csvUtils.js';   // Lớp lưu trữ CSV
import { ApiError } from '../src/utils/responseUtils.js';                      // Lớp lỗi nghiệp vụ
import {
    registerUser,            // Đăng ký tài khoản
    verifyEmailToken,        // Kích hoạt tài khoản bằng token
    loginUser,               // Đăng nhập (tầng service)
    findUserByEmail,         // Tìm user theo email
    toPublicUser,            // Lọc field công khai
} from '../src/services/authService.js';
import { requireAuth } from '../src/middleware/authMiddleware.js';             // Middleware xác thực JWT
import { verifyAuthToken, getJwtExpiresDays } from '../src/utils/jwtUtils.js'; // Xác thực token + đọc hạn từ .env

// --- Nạp .env (nếu có); nếu chưa có JWT_SECRET thì dùng khoá test tạm ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));     // Đọc file .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng cấu hình test tạm.');         // Vẫn chạy được test
}
if (!process.env.JWT_SECRET) {                                                 // Chưa có khoá bí mật
    process.env.JWT_SECRET = 'unit-test-secret-not-for-production-0123456789';   // Đặt khoá test để chạy JWT cases
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;       // Địa chỉ server để test qua HTTP
const TEST_EMAIL_PREFIX = 'phase4.test.';                                      // Tiền tố email test (dùng để dọn dẹp)
const TEST_NAME = 'Phase Four Tester';                                         // Tên hiển thị dùng cho tài khoản test
const VALID_PASSWORD = 'Example@123';                                          // Mật khẩu đúng quy tắc

let passedCases = 0;                                                           // Đếm số case đạt
let failedCases = 0;                                                           // Đếm số case lỗi
let skippedCases = 0;                                                          // Đếm số case bị bỏ qua (server chưa chạy)

// --- Các helper dùng chung cho script test ---

// Tạo email test duy nhất theo nhãn truyền vào
function makeTestEmail(label) {
    return `${TEST_EMAIL_PREFIX}${label}.${Date.now()}@example.com`;             // Có timestamp -> không bao giờ trùng
}

// Chờ một khoảng thời gian
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));          // Trả Promise hoàn thành sau N ms
}

// Chạy 1 case test và in kết quả
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                                                      // Thực thi nội dung kiểm tra
        passedCases += 1;                                                          // Tăng biến đếm đạt
        console.log(`✅ PASS: ${caseName}`);                                       // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                                          // Tăng biến đếm lỗi
        console.log(`❌ FAIL: ${caseName}`);                                       // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);                                 // In lý do cụ thể
    }
}

// Kiểm tra điều kiện đúng; sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);                                    // Ném lỗi khi điều kiện sai
}

// Chạy hàm và trả về ApiError thay vì ném ra ngoài (dùng để so sánh 2 thông báo lỗi)
async function captureApiError(callFunction) {
    try {
        await callFunction();                                                      // Gọi hàm cần kiểm tra
    } catch (error) {
        return error;                                                              // Trả lỗi để case tự đánh giá
    }
    throw new Error('Không ném lỗi như mong đợi');                               // Chạy xong không lỗi -> case sai
}

// Kiểm tra hàm phải ném ApiError đúng mã trạng thái (và chứa phần thông báo nếu truyền vào)
async function expectApiError(callFunction, expectedStatus, expectedPartOfMessage) {
    const error = await captureApiError(callFunction);                           // Lấy lỗi ném ra
    if (!(error instanceof ApiError)) throw new Error(`Lỗi ném ra không phải ApiError (nhận được: ${error.name})`);
    if (error.statusCode !== expectedStatus) throw new Error(`Mã trạng thái sai: ${error.statusCode} (mong đợi ${expectedStatus})`);
    if (expectedPartOfMessage && !error.message.includes(expectedPartOfMessage)) {
        throw new Error(`Thông báo sai: "${error.message}"`);
    }
}

// Gửi request HTTP và trả về status, body text, JSON (nếu có), content-type
async function httpRequest(method, requestPath, { body, rawBody, token } = {}) {
    const options = { method, headers: {} };                                     // Cấu hình request
    if (token) options.headers.Authorization = `Bearer ${token}`;                // Gắn JWT nếu case cần endpoint bảo vệ
    if (rawBody !== undefined) {                                                 // Gửi body thô (để test JSON hỏng)
        options.headers['Content-Type'] = 'application/json';                      // Khai báo JSON
        options.body = rawBody;                                                    // Nội dung thô
    } else if (body !== undefined) {                                             // Gửi body object bình thường
        options.headers['Content-Type'] = 'application/json';                      // Khai báo JSON
        options.body = JSON.stringify(body);                                       // Chuyển object thành chuỗi JSON
    }
    const response = await fetch(`${BASE_URL}${requestPath}`, options);          // Gọi API bằng fetch có sẵn của Node.js
    const text = await response.text();                                          // Đọc body dạng text
    let json = null;                                                             // Mặc định không có JSON
    try { json = JSON.parse(text); } catch { /* body không phải JSON */ }
    return { status: response.status, text, json };
}

// Sửa 1 số field của dòng user trong users.csv theo email (giả lập trạng thái khác nhau)
async function patchUserRowByEmail(email, patchFields) {
    let changed = false;                                                         // Cờ đánh dấu đã sửa được chưa
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.email === email);             // Tìm dòng theo email
        if (rowIndex === -1) return rows;                                          // Không thấy -> trả nguyên dữ liệu
        const nextRows = [...rows];                                                // Tạo mảng mới
        nextRows[rowIndex] = { ...rows[rowIndex], ...patchFields };                // Ghi đè các field cần sửa
        changed = true;                                                            // Đánh dấu đã sửa
        return nextRows;                                                           // Ghi lại file
    });
    return changed;                                                              // Trả kết quả cho nơi gọi
}

// Xoá 1 dòng user theo email (giả lập "tài khoản không còn tồn tại")
async function deleteUserRowByEmail(email) {
    let removed = false;                                                         // Cờ đánh dấu đã xoá được chưa
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = rows.filter((row) => row.email !== email);                // Giữ lại mọi dòng trừ dòng cần xoá
        removed = keptRows.length !== rows.length;                                 // Ghi nhận có xoá hay không
        return keptRows;                                                           // Ghi lại file
    });
    return removed;                                                              // Trả kết quả cho nơi gọi
}

// Xoá toàn bộ tài khoản test (email bắt đầu bằng tiền tố test)
async function cleanupTestUsers() {
    let removedCount = 0;                                                        // Đếm số dòng đã xoá
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = rows.filter((row) => !String(row.email).startsWith(TEST_EMAIL_PREFIX));   // Giữ lại dữ liệu thật
        removedCount = rows.length - keptRows.length;                              // Số dòng bị xoá
        return keptRows;                                                           // Ghi lại file
    });
    return removedCount;                                                         // Trả về số tài khoản test đã xoá
}

// Tính trung vị của một dãy số
function median(values) {
    const sorted = [...values].sort((first, second) => first - second);          // Sắp xếp tăng dần (bản sao)
    const middleIndex = Math.floor(sorted.length / 2);                           // Vị trí giữa
    if (sorted.length % 2 === 0) return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;   // Chẵn -> trung bình 2 giữa
    return sorted[middleIndex];                                                  // Lẻ -> lấy đúng giữa
}

// Tạo context giả cho middleware requireAuth (không cần HTTP thật)
function makeFakeAuthContext(authorizationHeader) {
    return {
        req: { headers: authorizationHeader ? { authorization: authorizationHeader } : {} },   // Header như request thật
    };
}

// Hàm chính
async function main() {
    console.log('=== BẮT ĐẦU TEST LOGIN + JWT + MIDDLEWARE (BƯỚC 4) ===\n');

    // ===================== PHẦN A: SERVICE + MIDDLEWARE =====================
    console.log('--- PHẦN A: Service & middleware (không cần server đang chạy) ---');

    const activeEmail = makeTestEmail('active');                                 // Email tài khoản active dùng cho phần A
    let activeToken = '';                                                        // Token đăng nhập của tài khoản active
    let activeUserId = '';                                                       // ID của tài khoản active

    await runCase('A1. Đăng nhập đúng trả token có sub = user ID và hạn theo JWT_EXPIRES_DAYS', async () => {
        const registered = await registerUser({ name: TEST_NAME, email: activeEmail, password: VALID_PASSWORD });   // Tạo tài khoản
        await verifyEmailToken(registered.verificationToken);                      // Kích hoạt tài khoản
        const storedUser = await findUserByEmail(activeEmail);                     // Đọc dòng trong CSV
        activeUserId = storedUser.id;                                              // Lưu ID để các case sau dùng

        const loginResult = await loginUser({ email: activeEmail, password: VALID_PASSWORD });   // Đăng nhập
        activeToken = loginResult.token;                                           // Lưu token cho các case sau
        const payload = verifyAuthToken(activeToken);                              // Xác thực và đọc payload
        expect(payload.sub === activeUserId, `Claim sub sai: ${payload.sub} (mong đợi ${activeUserId})`);

        const expectedDays = getJwtExpiresDays();                                  // Số ngày theo .env (dùng cùng logic với jwtUtils)
        const lifetimeSeconds = payload.exp - payload.iat;                         // Thời gian sống của token (giây)
        expect(Math.abs(lifetimeSeconds - expectedDays * 86400) <= 60,
            `Hạn token lệch quá 60s: ${lifetimeSeconds}s (mong đợi ~${expectedDays * 86400}s)`);
    });

    await runCase('A2. Sai mật khẩu và email không tồn tại -> CÙNG thông báo 401 (không lộ email)', async () => {
        const wrongPasswordError = await captureApiError(() => loginUser({ email: activeEmail, password: 'WrongPass@1' }));   // Sai mật khẩu
        const unknownEmailError = await captureApiError(() => loginUser({ email: makeTestEmail('unknown'), password: VALID_PASSWORD }));   // Email không tồn tại
        expect(wrongPasswordError instanceof ApiError && wrongPasswordError.statusCode === 401, `Sai mật khẩu phải là 401, nhận được ${wrongPasswordError.statusCode}`);
        expect(unknownEmailError instanceof ApiError && unknownEmailError.statusCode === 401, `Email lạ phải là 401, nhận được ${unknownEmailError.statusCode}`);
        expect(wrongPasswordError.message === unknownEmailError.message, 'Hai thông báo phải GIỐNG NHAU để không lộ email có tồn tại hay không');
    });

    await runCase('A3. Tài khoản chưa xác thực (pending) không được đăng nhập -> 403', async () => {
        const pendingEmail = makeTestEmail('pending');                             // Email tài khoản pending
        await registerUser({ name: TEST_NAME, email: pendingEmail, password: VALID_PASSWORD });   // Chỉ đăng ký, KHÔNG xác thực
        await expectApiError(() => loginUser({ email: pendingEmail, password: VALID_PASSWORD }), 403, 'not verified');   // Phải bị chặn
    });

    await runCase('A4. Middleware chặn: thiếu token, token rác, token bị sửa, token hết hạn', async () => {
        await expectApiError(() => requireAuth(makeFakeAuthContext()), 401, 'missing');                          // Không có header
        await expectApiError(() => requireAuth(makeFakeAuthContext('Bearer not.a.real.token')), 401);            // Token rác
        const tamperedToken = activeToken.slice(0, -2) + 'xx';                                                   // Sửa 2 ký tự cuối
        await expectApiError(() => requireAuth(makeFakeAuthContext(`Bearer ${tamperedToken}`)), 401, 'Invalid'); // Chữ ký sai
        const expiredToken = jwt.sign({}, process.env.JWT_SECRET, {                                              // Tự ký token hết hạn
            subject: activeUserId,                                                                                 // Của tài khoản active
            expiresIn: '1ms',                                                                                      // Hạn 1 mili giây
            algorithm: 'HS256',                                                                                    // Cùng thuật toán với dự án
        });
        await sleep(30);                                                                                         // Chờ cho chắc chắn hết hạn
        await expectApiError(() => requireAuth(makeFakeAuthContext(`Bearer ${expiredToken}`)), 401, 'expired');  // Phải báo hết hạn
    });

    await runCase('A5. Token hợp lệ nhưng tài khoản bị xoá / bị chuyển pending -> 401', async () => {
        const context = makeFakeAuthContext(`Bearer ${activeToken}`);              // Context có token hợp lệ
        const userRow = await requireAuth(context);                                // Lần đầu: phải qua được
        expect(userRow.id === activeUserId, 'Middleware phải trả đúng user');      // Kiểm tra đúng user
        expect(context.user && context.user.id === activeUserId, 'ctx.user phải được gắn tự động');

        await patchUserRowByEmail(activeEmail, { status: 'pending' });             // Giả lập tài khoản bị chuyển về pending
        await expectApiError(() => requireAuth(makeFakeAuthContext(`Bearer ${activeToken}`)), 401, 'no longer valid');

        await patchUserRowByEmail(activeEmail, { status: 'active' });              // Trả lại active -> token dùng được tiếp
        await requireAuth(makeFakeAuthContext(`Bearer ${activeToken}`));           // Không ném lỗi = OK

        await deleteUserRowByEmail(activeEmail);                                   // Giả lập tài khoản bị xoá hẳn
        await expectApiError(() => requireAuth(makeFakeAuthContext(`Bearer ${activeToken}`)), 401, 'no longer valid');
    });

    await runCase('A6. toPublicUser chỉ trả id, name, email (không lộ field bí mật)', async () => {
        const fullRow = await findUserByEmail(activeEmail);                        // Đọc dòng thật (có thể null nếu vừa bị xoá)
        if (fullRow) {                                                             // Nếu còn dòng để kiểm tra
            const publicUser = toPublicUser(fullRow);                                // Lọc field công khai
            expect(Object.keys(publicUser).join(',') === 'id,name,email', `Field công khai sai: ${Object.keys(publicUser).join(',')}`);
        }
    });

    // ===================== PHẦN B: HTTP THẬT =====================
    console.log('\n--- PHẦN B: HTTP thật (cần server đang chạy: npm start) ---');

    let serverIsUp = false;                                                      // Cờ xác nhận server đang chạy
    try {
        const health = await httpRequest('GET', '/api/health');                    // Gọi endpoint health
        serverIsUp = health.status === 200;                                        // Server sống nếu trả 200
    } catch {
        serverIsUp = false;                                                        // Không kết nối được
    }

    if (!serverIsUp) {
        skippedCases += 7;                                                          // Ghi nhận số case bị bỏ qua
        console.log(`⚠️  SKIP: Server chưa chạy ở ${BASE_URL} - hãy chạy "npm start" rồi chạy lại script.`);
    } else {
        const httpActiveEmail = makeTestEmail('http-active');                       // Tài khoản active dùng cho phần B
        const httpPendingEmail = makeTestEmail('http-pending');                     // Tài khoản pending dùng cho phần B
        let httpActiveToken = '';                                                   // Token dùng lại cho các case sau

        const httpRegistered = await registerUser({ name: TEST_NAME, email: httpActiveEmail, password: VALID_PASSWORD });   // Tạo tài khoản active
        await verifyEmailToken(httpRegistered.verificationToken);                   // Kích hoạt
        await registerUser({ name: TEST_NAME, email: httpPendingEmail, password: VALID_PASSWORD });   // Tạo tài khoản pending

        await runCase('B1. POST /api/login sai thông tin -> 401 với CÙNG thông báo cho mọi trường hợp', async () => {
            const wrongPassword = await httpRequest('POST', '/api/login', { body: { email: httpActiveEmail, password: 'WrongPass@1' } });
            const unknownEmail = await httpRequest('POST', '/api/login', { body: { email: makeTestEmail('http-unknown'), password: VALID_PASSWORD } });
            expect(wrongPassword.status === 401, `Sai mật khẩu phải 401, nhận được ${wrongPassword.status}`);
            expect(unknownEmail.status === 401, `Email lạ phải 401, nhận được ${unknownEmail.status}`);
            expect(wrongPassword.json.message === unknownEmail.json.message, 'Thông báo phải giống nhau');
            expect(wrongPassword.json.message === 'Invalid email or password', `Thông báo lạ: "${wrongPassword.json.message}"`);
        });

        await runCase('B2. POST /api/login tài khoản pending -> 403 kèm hướng dẫn xác thực email', async () => {
            const response = await httpRequest('POST', '/api/login', { body: { email: httpPendingEmail, password: VALID_PASSWORD } });
            expect(response.status === 403, `Status phải là 403, nhận được ${response.status}`);
            expect(response.json.message.includes('not verified'), 'Message phải nói rõ tài khoản chưa xác thực');
        });

        await runCase('B3. POST /api/login thành công -> 200 có token, KHÔNG lộ field mật khẩu; GET /api/me với token -> 200', async () => {
            const response = await httpRequest('POST', '/api/login', { body: { email: httpActiveEmail, password: VALID_PASSWORD } });
            expect(response.status === 200, `Status phải là 200, nhận được ${response.status}`);
            expect(typeof response.json.data.token === 'string' && response.json.data.token.length > 20, 'Phải trả JWT');
            expect(response.json.data.user.email === httpActiveEmail, 'Email trong user trả về phải khớp');
            for (const forbiddenKey of ['passwordHash', 'passwordSalt', 'verificationTokenHash']) {
                expect(!response.text.includes(forbiddenKey), `Response KHÔNG được chứa "${forbiddenKey}"`);
            }
            httpActiveToken = response.json.data.token;                               // Lưu token cho các case sau

            const meResponse = await httpRequest('GET', '/api/me', { token: httpActiveToken });   // Gọi endpoint bảo vệ
            expect(meResponse.status === 200, `GET /api/me phải là 200, nhận được ${meResponse.status}`);
            expect(meResponse.json.data.email === httpActiveEmail, 'GET /api/me phải trả đúng user');
        });

        await runCase('B4. GET /api/me thiếu token -> 401; token bị sửa -> 401', async () => {
            const noToken = await httpRequest('GET', '/api/me');                       // Không gửi token
            expect(noToken.status === 401, `Thiếu token phải 401, nhận được ${noToken.status}`);
            const tampered = await httpRequest('GET', '/api/me', { token: httpActiveToken.slice(0, -2) + 'xx' });   // Token bị sửa
            expect(tampered.status === 401, `Token sửa phải 401, nhận được ${tampered.status}`);
        });

        await runCase('B5. POST /api/logout -> 200 nói rõ không thu hồi được; token cũ vẫn dùng được (đúng limitation)', async () => {
            const response = await httpRequest('POST', '/api/logout', { token: httpActiveToken });
            expect(response.status === 200, `Status phải là 200, nhận được ${response.status}`);
            expect(response.json.message.includes('cannot be revoked'), 'Message phải nói rõ JWT không thu hồi được phía server');

            const meAfterLogout = await httpRequest('GET', '/api/me', { token: httpActiveToken });   // Token cũ vẫn hoạt động
            expect(meAfterLogout.status === 200, 'Token stateless vẫn dùng được sau logout - đây là hành vi đã tài liệu hoá, không phải bug');
        });

        await runCase('B6. POST /api/login với JSON hỏng -> 400 (không sập server)', async () => {
            const response = await httpRequest('POST', '/api/login', { rawBody: '{"email": ' });   // JSON thiếu phần còn lại
            expect(response.status === 400, `Status phải là 400, nhận được ${response.status}`);
            expect(response.json.status === 'ERROR', 'Body phải có status = ERROR');
        });

        await runCase('B7. Hiệu năng login: 5 lần đo, trung vị < 500ms (yêu cầu NFR)', async () => {
            const httpDurations = [];                                                  // Thời gian mỗi lần đo qua HTTP
            for (let runIndex = 0; runIndex < 5; runIndex += 1) {                      // Đo 5 lần liên tiếp
                const startedAt = performance.now();                                     // Bắt đầu tính giờ
                const response = await httpRequest('POST', '/api/login', { body: { email: httpActiveEmail, password: VALID_PASSWORD } });
                const duration = performance.now() - startedAt;                          // Thời gian của lần đo này
                expect(response.status === 200, `Lần đo ${runIndex + 1} phải trả 200, nhận được ${response.status}`);
                httpDurations.push(duration);                                            // Lưu lại để tính trung vị
            }
            const serviceDurations = [];                                               // Thời gian xử lý thuần server (scrypt + đọc CSV)
            for (let runIndex = 0; runIndex < 5; runIndex += 1) {
                const startedAt = performance.now();                                     // Bắt đầu tính giờ
                await loginUser({ email: httpActiveEmail, password: VALID_PASSWORD });   // Gọi thẳng tầng service
                serviceDurations.push(performance.now() - startedAt);                    // Lưu lại thời gian
            }

            const httpMedian = median(httpDurations);                                  // Trung vị đo qua HTTP
            const serviceMedian = median(serviceDurations);                            // Trung vị đo ở tầng service
            console.log(`   [perf] HTTP login từng lần : ${httpDurations.map((value) => value.toFixed(1)).join(' ms | ')} ms`);
            console.log(`   [perf] HTTP login          : trung vị ${httpMedian.toFixed(1)} ms | max ${Math.max(...httpDurations).toFixed(1)} ms`);
            console.log(`   [perf] Service login thuần : trung vị ${serviceMedian.toFixed(1)} ms | max ${Math.max(...serviceDurations).toFixed(1)} ms`);
            console.log('   [perf] Ghi chú: HTTP ≈ service + vài ms mạng nội bộ; đều KHÔNG tính thời gian gửi email.');

            expect(httpMedian < 500, `Trung vị login HTTP phải < 500ms, nhận được ${httpMedian.toFixed(1)} ms`);
            expect(serviceMedian < 500, `Trung vị login service phải < 500ms, nhận được ${serviceMedian.toFixed(1)} ms`);
        });
    }

    // ===================== DỌN DẸP VÀ TỔNG KẾT =====================
    const removedCount = await cleanupTestUsers();                                // Xoá toàn bộ tài khoản test khỏi users.csv
    console.log(`\n[test] Đã dọn dẹp ${removedCount} tài khoản test khỏi users.csv (dữ liệu thật giữ nguyên).`);

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);
    console.log('[test] Các tác vụ gửi email chạy nền có thể in log sau dòng này - đó là hành vi bình thường.');

    await sleep(3000);                                                            // Chờ 3 giây cho log gửi email nền hiện ra
    process.exit(failedCases > 0 ? 1 : 0);                                        // Thoát với mã lỗi nếu có case thất bại
}

main().catch(async (error) => {                                                 // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);                    // In đầy đủ để debug
    try { await cleanupTestUsers(); } catch { /* bỏ qua lỗi khi dọn dẹp */ }       // Cố gắng dọn dẹp dù có lỗi
    process.exit(1);                                                              // Thoát với mã lỗi
});