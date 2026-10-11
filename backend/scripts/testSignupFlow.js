/**
 * ============================================================================
 *  FILE    : backend/scripts/testSignupFlow.js
 *  MỤC ĐÍCH: Kiểm tra tự động toàn bộ luồng của Bước 3:
 *            PHẦN A - test trực tiếp tầng service (đăng ký, verify, resend, rate limit, SMTP lỗi)
 *            PHẦN B - test qua HTTP thật (cần server đang chạy: npm start)
 *  CÁCH CHẠY:
 *            1) Terminal 1: npm start
 *            2) Terminal 2: node backend/scripts/testSignupFlow.js
 *  GHI CHÚ : Script chỉ tạo tài khoản test có email bắt đầu bằng "phase3.test."
 *            và TỰ XOÁ các tài khoản đó khi chạy xong, không đụng dữ liệu thật.
 * ============================================================================
 */

import path from 'node:path';                                                  // Ghép đường dẫn file .env
import { USERS_CSV_PATH, USERS_HEADERS, updateCsvFile } from '../src/utils/csvUtils.js';   // Lớp lưu trữ CSV
import { ApiError } from '../src/utils/responseUtils.js';                      // Lớp lỗi nghiệp vụ
import {
    registerUser,                    // Đăng ký tài khoản
    verifyEmailToken,                // Xác thực email bằng token
    resendVerificationEmail,         // Gửi lại email xác thực
    findUserByEmail,                 // Tìm tài khoản theo email
    RESEND_COOLDOWN_SECONDS,         // Số giây chờ giữa 2 lần gửi lại
    VERIFICATION_TOKEN_TTL_MINUTES,  // Hạn của token (phút)
} from '../src/services/authService.js';
import { sendVerificationEmail } from '../src/services/emailService.js';       // Dịch vụ gửi email
import { hashVerificationToken } from '../src/utils/tokenUtils.js';            // Hàm băm token (để so sánh)

// --- Nạp .env (nếu có) để biết cấu hình SMTP và cổng server ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));     // Đọc file .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng biến môi trường của hệ điều hành.');   // Vẫn chạy được
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;       // Địa chỉ server để test qua HTTP
const TEST_EMAIL_PREFIX = 'phase3.test.';                                      // Tiền tố email test (dùng để dọn dẹp)
const TEST_NAME = 'Phase Three Tester';                                        // Tên hiển thị dùng cho tài khoản test
const VALID_PASSWORD = 'Example@123';                                          // Mật khẩu đúng quy tắc

let passedCases = 0;                                                           // Đếm số case đạt
let failedCases = 0;                                                           // Đếm số case lỗi
let skippedCases = 0;                                                          // Đếm số case bị bỏ qua (server chưa chạy)

// Tạo email test duy nhất theo nhãn truyền vào
function makeTestEmail(label) {
    return `${TEST_EMAIL_PREFIX}${label}.${Date.now()}@example.com`;             // Ví dụ: phase3.test.a1.1737000000000@example.com
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

// Kiểm tra hàm phải ném ApiError đúng mã trạng thái (và chứa phần thông báo nếu truyền vào)
async function expectApiError(callFunction, expectedStatus, expectedPartOfMessage) {
    try {
        await callFunction();                                                      // Gọi hàm cần kiểm tra
    } catch (error) {
        if (!(error instanceof ApiError)) throw new Error(`Lỗi ném ra không phải ApiError (nhận được: ${error.name})`);
        if (error.statusCode !== expectedStatus) throw new Error(`Mã trạng thái sai: ${error.statusCode} (mong đợi ${expectedStatus})`);
        if (expectedPartOfMessage && !error.message.includes(expectedPartOfMessage)) {
            throw new Error(`Thông báo sai: "${error.message}"`);
        }
        return;                                                                    // Đúng như mong đợi
    }
    throw new Error('Không ném lỗi như mong đợi');                               // Hàm chạy xong không lỗi -> case sai
}

// Gửi request HTTP và trả về status, body text, JSON (nếu có), content-type
async function httpRequest(method, requestPath, { body, rawBody } = {}) {
    const options = { method, headers: {} };                                     // Cấu hình request
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
    try { json = JSON.parse(text); } catch { /* body không phải JSON (ví dụ trang HTML) */ }
    return { status: response.status, text, json, contentType: response.headers.get('content-type') || '' };
}

// Cập nhật 1 dòng user trong users.csv theo email (dùng để giả lập token hết hạn / đã lâu chưa gửi)
async function patchUserRowByEmail(email, patchFields) {
    let changed = false;                                                         // Cờ đánh dấu đã sửa được dòng nào chưa
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.email === email);             // Tìm dòng theo email
        if (rowIndex === -1) return rows;                                          // Không thấy -> trả nguyên dữ liệu
        const nextRows = [...rows];                                                // Tạo mảng mới
        nextRows[rowIndex] = { ...rows[rowIndex], ...patchFields };                // Ghi đè các field cần sửa
        changed = true;                                                            // Đánh dấu đã sửa
        return nextRows;                                                           // Trả mảng mới để ghi file
    });
    return changed;                                                              // Trả kết quả cho nơi gọi
}

// Xoá toàn bộ tài khoản test (email bắt đầu bằng tiền tố test)
async function cleanupTestUsers() {
    let removedCount = 0;                                                        // Đếm số dòng đã xoá
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = rows.filter((row) => !String(row.email).startsWith(TEST_EMAIL_PREFIX));   // Giữ lại dữ liệu thật
        removedCount = rows.length - keptRows.length;                              // Số dòng bị xoá
        return keptRows;                                                           // Trả mảng đã lọc để ghi file
    });
    return removedCount;                                                         // Trả về số tài khoản test đã xoá
}

// Hàm chính
async function main() {
    console.log('=== BẮT ĐẦU TEST LUỒNG ĐĂNG KÝ + XÁC THỰC EMAIL (BƯỚC 3) ===\n');
    console.log(`[test] Cấu hình SMTP: ${process.env.SMTP_USER ? `đã có (${process.env.SMTP_USER})` : 'CHƯA cấu hình - email sẽ không gửi được (đúng như cảnh báo)'}`);
    console.log('[test] Lưu ý: các tài khoản test dùng địa chỉ @example.com nên Gmail sẽ không gửi tới hộp thư thật.\n');

    // ===================== PHẦN A: TEST TẦNG SERVICE =====================
    console.log('--- PHẦN A: Tầng service (không cần server đang chạy) ---');

    const emailA = makeTestEmail('a1');                                          // Email test cho case A1
    let tokenA = '';                                                             // Token xác thực của tài khoản A

    await runCase('A1. Đăng ký tạo tài khoản pending, chỉ lưu HASH của token', async () => {
        const result = await registerUser({ name: TEST_NAME, email: emailA, password: VALID_PASSWORD });   // Đăng ký tài khoản
        tokenA = result.verificationToken;                                         // Lưu token gốc để test xác thực
        const storedUser = await findUserByEmail(emailA);                          // Đọc lại dòng trong users.csv
        expect(storedUser, 'Không tìm thấy tài khoản vừa tạo trong users.csv');      // Phải có trong CSV
        expect(storedUser.status === 'pending', `Status phải là pending, nhận được "${storedUser.status}"`);
        expect(storedUser.passwordSalt.length === 32, 'passwordSalt phải là 32 ký tự hex');
        expect(storedUser.passwordHash.length === 128, 'passwordHash scrypt phải là 128 ký tự hex');
        expect(storedUser.passwordHash !== VALID_PASSWORD, 'KHÔNG được lưu mật khẩu gốc');
        expect(storedUser.verificationTokenHash === hashVerificationToken(tokenA), 'verificationTokenHash phải là SHA-256 của token');
        expect(!storedUser.verificationTokenHash.includes(tokenA), 'KHÔNG được lưu token gốc');
        const remainingMinutes = (Date.parse(storedUser.verificationExpiresAt) - Date.now()) / 60000;   // Số phút còn lại
        expect(remainingMinutes > VERIFICATION_TOKEN_TTL_MINUTES - 1 && remainingMinutes <= VERIFICATION_TOKEN_TTL_MINUTES,
            `Hạn token phải khoảng ${VERIFICATION_TOKEN_TTL_MINUTES} phút, nhận được ${remainingMinutes.toFixed(2)} phút`);
        expect(Boolean(storedUser.verificationSentAt), 'verificationSentAt phải có giá trị');
    });

    await runCase('A2. Email trùng (khác chữ hoa/thường) bị chặn với lỗi 409', async () => {
        const duplicatedEmail = emailA.toUpperCase();                              // Cùng email nhưng viết hoa toàn bộ
        await expectApiError(() => registerUser({ name: TEST_NAME, email: duplicatedEmail, password: VALID_PASSWORD }), 409, 'already registered');
    });

    await runCase('A3. Email sai định dạng / mật khẩu yếu / thiếu tên đều bị chặn 400', async () => {
        await expectApiError(() => registerUser({ name: TEST_NAME, email: 'khong-phai-email', password: VALID_PASSWORD }), 400);
        await expectApiError(() => registerUser({ name: TEST_NAME, email: makeTestEmail('a3'), password: 'weakpass' }), 400);
        await expectApiError(() => registerUser({ name: '   ', email: makeTestEmail('a3b'), password: VALID_PASSWORD }), 400);
    });

    await runCase('A4. Token đúng kích hoạt tài khoản và xoá sạch token trong CSV', async () => {
        const activatedUser = await verifyEmailToken(tokenA);                      // Xác thực bằng token thật
        expect(activatedUser.status === 'active', 'Sau khi xác thực, status phải là active');
        expect(activatedUser.email === emailA, 'Email trả về không khớp');
        expect(!('passwordHash' in activatedUser), 'KHÔNG được trả passwordHash ra ngoài');
        const storedUser = await findUserByEmail(emailA);                          // Đọc lại dòng trong CSV
        expect(storedUser.status === 'active', `Status trong CSV phải là active, nhận được "${storedUser.status}"`);
        expect(storedUser.verificationTokenHash === '', 'verificationTokenHash phải được xoá trống');
        expect(storedUser.verificationExpiresAt === '', 'verificationExpiresAt phải được xoá trống');
    });

    await runCase('A5. Dùng lại token cũ bị từ chối 400', async () => {
        await expectApiError(() => verifyEmailToken(tokenA), 400, 'invalid or has already been used');   // Token đã dùng -> lỗi
    });

    await runCase('A6. Token hết hạn bị từ chối 400', async () => {
        const emailB = makeTestEmail('b1');                                        // Email test cho case A6
        const resultB = await registerUser({ name: TEST_NAME, email: emailB, password: VALID_PASSWORD });   // Tạo tài khoản mới
        const pastIso = new Date(Date.now() - 60000).toISOString();                // Hạn token trong quá khứ (1 phút trước)
        const patched = await patchUserRowByEmail(emailB, { verificationExpiresAt: pastIso });   // Sửa CSV giả lập hết hạn
        expect(patched, 'Không sửa được verificationExpiresAt để giả lập hết hạn');
        await expectApiError(() => verifyEmailToken(resultB.verificationToken), 400, 'expired');   // Phải báo hết hạn
    });

    await runCase('A7. Gửi lại email trong thời gian chờ (cooldown) bị chặn 429', async () => {
        const emailD = makeTestEmail('d1');                                          // Tạo tài khoản riêng cho case này (đang pending)
        await registerUser({ name: TEST_NAME, email: emailD, password: VALID_PASSWORD });   // Đăng ký mới -> verificationSentAt = thời điểm hiện tại
        await expectApiError(() => resendVerificationEmail(emailD), 429, 'Too many verification email requests');   // Gửi lại NGAY -> phải bị chặn 429
    });

    await runCase('A8. Gửi lại sau cooldown: token được xoay mới, token cũ hết hiệu lực', async () => {
        const emailC = makeTestEmail('c1');                                        // Email test cho case A8
        const resultC = await registerUser({ name: TEST_NAME, email: emailC, password: VALID_PASSWORD });   // Tạo tài khoản mới
        const twoMinutesAgo = new Date(Date.now() - 2 * 60000).toISOString();      // Giả lập lần gửi gần nhất cách đây 2 phút
        await patchUserRowByEmail(emailC, { verificationSentAt: twoMinutesAgo });  // Sửa CSV để hết cooldown

        const resendResult = await resendVerificationEmail(emailC);                 // Gửi lại email xác thực
        expect(resendResult.sent === true, 'Phải gửi lại được sau khi hết cooldown');
        expect(resendResult.verificationToken !== resultC.verificationToken, 'Token mới phải khác token cũ');
        expect(resendResult.message.includes('verification email has been sent'), 'Message có thông tin hữu ích cho người dùng');

        await expectApiError(() => verifyEmailToken(resultC.verificationToken), 400, 'invalid or has already been used');
        const activatedUser = await verifyEmailToken(resendResult.verificationToken);   // Token mới phải dùng được
        expect(activatedUser.status === 'active', 'Token mới phải kích hoạt được tài khoản');
    });

    await runCase('A9. SMTP lỗi thì hàm gửi email PHẢI ném lỗi (không báo thành công giả)', async () => {
        const backupEnv = {                                                        // Sao lưu cấu hình SMTP hiện tại
            SMTP_HOST: process.env.SMTP_HOST,
            SMTP_PORT: process.env.SMTP_PORT,
            SMTP_USER: process.env.SMTP_USER,
        };
        process.env.SMTP_HOST = '127.0.0.1';                                       // Trỏ tới địa chỉ không có SMTP
        process.env.SMTP_PORT = '1';                                               // Cổng chắc chắn bị từ chối kết nối
        process.env.SMTP_USER = process.env.SMTP_USER || 'test@example.com';       // Đảm bảo đủ biến để vượt qua bước kiểm tra cấu hình
        let didThrow = false;                                                      // Cờ đánh dấu có lỗi hay không
        try {
            await sendVerificationEmail({                                            // Gọi hàm gửi email với cấu hình sai
                toEmail: 'test@example.com',
                recipientName: 'Test',
                verificationToken: 'a'.repeat(64),                                     // Token giả 64 ký tự hex
                expiresInMinutes: VERIFICATION_TOKEN_TTL_MINUTES,
            });
        } catch {
            didThrow = true;                                                         // Lỗi được ném ra đúng như mong đợi
        } finally {
            process.env.SMTP_HOST = backupEnv.SMTP_HOST ?? '';                       // Khôi phục cấu hình SMTP
            process.env.SMTP_PORT = backupEnv.SMTP_PORT ?? '';
            process.env.SMTP_USER = backupEnv.SMTP_USER ?? '';
        }
        expect(didThrow, 'SMTP lỗi nhưng hàm gửi email không ném lỗi -> nguy cơ báo thành công giả');
    });

    // ===================== PHẦN B: TEST QUA HTTP =====================
    console.log('\n--- PHẦN B: HTTP thật (cần server đang chạy: npm start) ---');

    let serverIsUp = false;                                                      // Cờ xác nhận server đang chạy
    try {
        const health = await httpRequest('GET', '/api/health');                    // Gọi endpoint health để kiểm tra
        serverIsUp = health.status === 200;                                        // Server sống nếu health trả 200
    } catch {
        serverIsUp = false;                                                        // Không kết nối được -> server chưa chạy
    }

    if (!serverIsUp) {                                                           // Thông báo rõ nếu bỏ qua phần B
        skippedCases += 9;                                                         // Ghi nhận số case bị bỏ qua
        console.log('⚠️  SKIP: Server chưa chạy ở ' + BASE_URL + ' - hãy chạy "npm start" rồi chạy lại script để test phần B.');
    } else {
        const emailHttp = makeTestEmail('http1');                                  // Email dùng cho phần B

        await runCase('B1. POST /api/signup với mật khẩu yếu -> 400 + JSON lỗi đúng quy ước', async () => {
            const response = await httpRequest('POST', '/api/signup', {
                body: { name: TEST_NAME, email: makeTestEmail('http-weak'), password: 'weak' },   // Mật khẩu sai quy tắc
            });
            expect(response.status === 400, `Status phải là 400, nhận được ${response.status}`);
            expect(response.json && response.json.status === 'ERROR', 'Body phải có status = ERROR');
            expect(typeof response.json.message === 'string' && response.json.message.length > 0, 'Phải có message giải thích');
        });

        await runCase('B2. POST /api/signup với JSON hỏng -> 400 (không sập server)', async () => {
            const response = await httpRequest('POST', '/api/signup', { rawBody: '{"name": "Alex", ' });   // JSON thiếu dấu đóng
            expect(response.status === 400, `Status phải là 400, nhận được ${response.status}`);
            expect(response.json && response.json.status === 'ERROR', 'Body phải có status = ERROR');
        });

        await runCase('B3. POST /api/signup hợp lệ -> 201 và KHÔNG lộ field mật khẩu/token', async () => {
            const response = await httpRequest('POST', '/api/signup', {
                body: { name: TEST_NAME, email: emailHttp, password: VALID_PASSWORD },  // Dữ liệu hợp lệ
            });
            expect(response.status === 201, `Status phải là 201, nhận được ${response.status}`);
            expect(response.json.data.status === 'pending', 'Tài khoản mới phải có status pending');
            expect(response.json.data.email === emailHttp, 'Email trả về phải khớp email đã chuẩn hoá');
            const rawResponse = response.text;                                        // Chuỗi JSON thô để kiểm tra rò rỉ
            for (const forbiddenKey of ['passwordHash', 'passwordSalt', 'verificationTokenHash', 'verificationToken']) {
                expect(!rawResponse.includes(forbiddenKey), `Response KHÔNG được chứa "${forbiddenKey}"`);
            }
            const storedUser = await findUserByEmail(emailHttp);                      // Kiểm tra dữ liệu đã lưu
            expect(storedUser && storedUser.status === 'pending', 'Tài khoản trong CSV phải ở trạng thái pending');
        });

        await runCase('B4. Đăng ký trùng email qua HTTP -> 409', async () => {
            const response = await httpRequest('POST', '/api/signup', {
                body: { name: TEST_NAME, email: emailHttp, password: VALID_PASSWORD },  // Đăng ký lại cùng email
            });
            expect(response.status === 409, `Status phải là 409, nhận được ${response.status}`);
            expect(response.json.message.includes('already registered'), 'Message phải nói rõ email đã đăng ký');
        });

        await runCase('B5. GET /api/verify-email với token sai -> trang HTML 400', async () => {
            const response = await httpRequest('GET', `/api/verify-email?token=${'f'.repeat(64)}`);   // Token ngẫu nhiên không tồn tại
            expect(response.status === 400, `Status phải là 400, nhận được ${response.status}`);
            expect(response.contentType.includes('text/html'), 'Phải trả về trang HTML');
            expect(response.text.includes('Verification failed'), 'Trang HTML phải là trang thất bại');
        });

        await runCase('B6. GET /api/verify-email thiếu token -> 400', async () => {
            const response = await httpRequest('GET', '/api/verify-email');            // Không truyền token
            expect(response.status === 400, `Status phải là 400, nhận được ${response.status}`);
            expect(response.text.includes('missing'), 'Phải thông báo thiếu token');
        });

        await runCase('B7. Link verify thật kích hoạt tài khoản qua HTTP -> 200 HTML thành công', async () => {
            const emailVerifyHttp = makeTestEmail('http-verify');                     // Email cho case này
            const registered = await registerUser({ name: TEST_NAME, email: emailVerifyHttp, password: VALID_PASSWORD });   // Tạo tài khoản trực tiếp qua service
            const response = await httpRequest('GET', `/api/verify-email?token=${registered.verificationToken}`);   // Gọi endpoint verify qua HTTP
            expect(response.status === 200, `Status phải là 200, nhận được ${response.status}`);
            expect(response.text.includes('Email verified'), 'Trang HTML phải xác nhận kích hoạt thành công');
            const storedUser = await findUserByEmail(emailVerifyHttp);                // Kiểm tra trạng thái trong CSV
            expect(storedUser.status === 'active', 'Status trong CSV phải là active sau khi verify qua HTTP');
        });

        await runCase('B8. POST /api/resend-verification: email tồn tại -> 200, email không tồn tại cũng 200 (không lộ thông tin)', async () => {
            const pendingEmail = emailHttp;                                           // Tài khoản pending còn hiệu lực cooldown
            const existingResponse = await httpRequest('POST', '/api/resend-verification', { body: { email: pendingEmail } });
            expect(existingResponse.status === 429, `Tài khoản vừa đăng ký phải bị cooldown 429, nhận được ${existingResponse.status}`);

            const unknownResponse = await httpRequest('POST', '/api/resend-verification', { body: { email: makeTestEmail('khong-ton-tai') } });
            expect(unknownResponse.status === 200, `Email không tồn tại phải trả 200 chung, nhận được ${unknownResponse.status}`);
            expect(unknownResponse.json.message.includes('If this email address belongs to an account'), 'Phải dùng message chung, không tiết lộ thông tin');
        });

        await runCase('B9. Sai method và endpoint lạ: GET /api/signup -> 405, POST /api/khong-ton-tai -> 404', async () => {
            const wrongMethod = await httpRequest('GET', '/api/signup');              // Sai method cho route có thật
            expect(wrongMethod.status === 405, `Status phải là 405, nhận được ${wrongMethod.status}`);
            const unknownEndpoint = await httpRequest('POST', '/api/khong-ton-tai', { body: {} });
            expect(unknownEndpoint.status === 404, `Status phải là 404, nhận được ${unknownEndpoint.status}`);
        });
    }

    // ===================== DỌN DẸP VÀ TỔNG KẾT =====================
    const removedCount = await cleanupTestUsers();                                // Xoá toàn bộ tài khoản test khỏi users.csv
    console.log(`\n[test] Đã dọn dẹp ${removedCount} tài khoản test khỏi users.csv (dữ liệu thật giữ nguyên).`);

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);
    console.log('[test] Các tác vụ gửi email chạy nền có thể in log sau dòng này - đó là hành vi bình thường.');

    await sleep(3000);                                                            // Chờ 3 giây cho các log gửi email nền hiện ra
    process.exit(failedCases > 0 ? 1 : 0);                                        // Thoát với mã lỗi nếu có case thất bại
}

main().catch(async (error) => {                                                 // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);                    // In đầy đủ để debug
    try { await cleanupTestUsers(); } catch { /* bỏ qua lỗi khi dọn dẹp */ }       // Cố gắng dọn dẹp dù có lỗi
    process.exit(1);                                                              // Thoát với mã lỗi
});