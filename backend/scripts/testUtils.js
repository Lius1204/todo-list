/**
 * ============================================================================
 *  FILE    : backend/scripts/testUtils.js
 *  MỤC ĐÍCH: Kiểm tra tự động toàn bộ utils của Bước 2B
 *            (responseUtils, validationUtils, passwordUtils, jwtUtils, tokenUtils).
 *  CÁCH CHẠY: node backend/scripts/testUtils.js
 *  GHI CHÚ : Script chạy trong bộ nhớ, KHÔNG ghi file nào lên đĩa.
 * ============================================================================
 */

import path from 'node:path';                            // Ghép đường dẫn file .env
import jwt from 'jsonwebtoken';                          // Dùng riêng để tạo token hết hạn phục vụ test
import {
    ApiError,                       // Lớp lỗi nghiệp vụ cần kiểm tra
    sendSuccess,                    // Hàm gửi phản hồi thành công
    sendError,                      // Hàm gửi phản hồi lỗi
    sendErrorFromException,         // Hàm chuyển Exception thành phản hồi lỗi
} from '../src/utils/responseUtils.js';
import {
    normalizeEmail,                 // Chuẩn hoá email
    assertValidEmail,               // Kiểm tra email
    assertValidName,                // Kiểm tra tên hiển thị
    assertValidPassword,            // Kiểm tra mật khẩu khi đăng ký
    assertLoginPassword,            // Kiểm tra mật khẩu khi đăng nhập
    assertValidTaskContent,         // Kiểm tra nội dung task
    assertBoolean,                  // Kiểm tra field boolean
    assertStringField,              // Kiểm tra field chuỗi
    assertJsonObject,               // Kiểm tra body là object JSON
    assertOnlyAllowedFields,        // Chặn field lạ trong PATCH
} from '../src/utils/validationUtils.js';
import {
    buildPasswordRecord,            // Tạo salt + hash cho một mật khẩu
    verifyPassword,                 // Kiểm tra mật khẩu với dữ liệu đã lưu
} from '../src/utils/passwordUtils.js';
import {
    signAuthToken,                  // Ký token đăng nhập
    verifyAuthToken,                // Xác thực token đăng nhập
    getJwtExpiresDays,              // Đọc JWT_EXPIRES_DAYS từ .env
} from '../src/utils/jwtUtils.js';
import {
    generateVerificationToken,      // Sinh token xác thực email
    hashVerificationToken,          // Băm token xác thực email
    safeCompareHex,                 // So sánh an toàn 2 chuỗi hex
} from '../src/utils/tokenUtils.js';

// --- Nạp .env nếu có; nếu chưa cấu hình JWT_SECRET thì dùng khoá test tạm ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));   // Đọc file .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng cấu hình test tạm.');        // Vẫn chạy được test
}
if (!process.env.JWT_SECRET) {                                              // Chưa có khoá bí mật
    process.env.JWT_SECRET = 'unit-test-secret-not-for-production-0123456789'; // Đặt khoá test để chạy JWT cases
}

let passedCases = 0;                                     // Đếm số case đạt
let failedCases = 0;                                     // Đếm số case lỗi

// Chờ một khoảng thời gian (dùng để test token hết hạn)
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));       // Trả Promise hoàn thành sau N ms
}

// Chạy 1 case test và in kết quả đạt/lỗi
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                                // Thực thi nội dung kiểm tra
        passedCases += 1;                                    // Tăng biến đếm case đạt
        console.log(`✅ PASS: ${caseName}`);                 // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                    // Tăng biến đếm case lỗi
        console.log(`❌ FAIL: ${caseName}`);                 // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);           // In lý do cụ thể để dễ sửa
    }
}

// Kiểm tra điều kiện đúng; nếu sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);              // Ném lỗi khi điều kiện không đúng
}

// Kiểm tra hàm phải ném ApiError với đúng mã trạng thái (và một phần thông báo nếu có)
async function expectApiError(callFunction, expectedStatus, expectedPartOfMessage) {
    try {
        await callFunction();                                // Gọi hàm cần kiểm tra
    } catch (error) {
        if (!(error instanceof ApiError)) {                  // Lỗi ném ra không phải ApiError
            throw new Error(`Lỗi ném ra không phải ApiError (nhận được: ${error.name})`);
        }
        if (error.statusCode !== expectedStatus) {           // Sai mã trạng thái
            throw new Error(`Mã trạng thái sai: ${error.statusCode} (mong đợi ${expectedStatus})`);
        }
        if (expectedPartOfMessage && !error.message.includes(expectedPartOfMessage)) {   // Thông báo không như mong đợi
            throw new Error(`Thông báo sai: "${error.message}"`);
        }
        return;                                              // Đúng như mong đợi -> kết thúc
    }
    throw new Error('Không ném lỗi như mong đợi');          // Chạy hết hàm mà không ném lỗi -> case lỗi
}

// Tạo đối tượng response giả để kiểm tra các hàm gửi phản hồi mà không cần HTTP
function createFakeResponse() {
    const fakeResponse = { statusCode: null, headers: null, body: '', headersSent: false };   // Object giả lập
    fakeResponse.writeHead = (statusCode, headers) => {                                       // Giả lập res.writeHead
        fakeResponse.statusCode = statusCode;                                                   // Ghi lại mã trạng thái
        fakeResponse.headers = headers;                                                         // Ghi lại header
        fakeResponse.headersSent = true;                                                        // Đánh dấu đã gửi header
        return fakeResponse;                                                                    // Trả về chính nó
    };
    fakeResponse.end = (chunk) => {                                                           // Giả lập res.end
        if (chunk !== undefined) fakeResponse.body += chunk.toString();                          // Lưu nội dung body
        return fakeResponse;                                                                    // Trả về chính nó
    };
    return fakeResponse;                                                                      // Trả object giả lập
}

// Hàm chính: chạy lần lượt 16 case test rồi in tổng kết
async function main() {
    console.log('=== BẮT ĐẦU TEST UTILS (BƯỚC 2B) ===\n');    // In tiêu đề

    await runCase('normalizeEmail: cắt khoảng trắng và chuyển thành chữ thường', async () => {
        const result = normalizeEmail('  Alex@Example.COM  ');             // Email lộn xộn như người dùng gõ
        expect(result === 'alex@example.com', `Kết quả sai: "${result}"`); // Phải về đúng dạng chuẩn
    });

    await runCase('assertValidEmail: chuẩn hoá email hợp lệ', async () => {
        const result = assertValidEmail('  ALex@Example.com ');            // Email có khoảng trắng + chữ hoa
        expect(result === 'alex@example.com', `Kết quả sai: "${result}"`); // Trả về dạng đã chuẩn hoá
    });

    await runCase('assertValidEmail: từ chối email sai định dạng', async () => {
        const invalidEmails = ['', 'alex', 'alex@', '@example.com', 'alex example@test.com'];   // 5 email sai
        for (const invalidEmail of invalidEmails) {                        // Duyệt từng email sai
            await expectApiError(() => assertValidEmail(invalidEmail), 400);  // Bắt buộc ném lỗi 400
        }
    });

    await runCase('assertValidName: cắt khoảng trắng và từ chối tên rỗng', async () => {
        expect(assertValidName('  Alex Nguyen  ') === 'Alex Nguyen', 'Chưa cắt khoảng trắng đúng');   // Phải trim
        await expectApiError(() => assertValidName('   '), 400, 'required');                          // Toàn khoảng trắng -> lỗi
    });

    await runCase('assertValidPassword: chấp nhận mật khẩu đúng quy tắc', async () => {
        expect(assertValidPassword('Example@123') === 'Example@123', 'Mật khẩu hợp lệ bị từ chối');   // Phải chấp nhận
    });

    await runCase('assertValidPassword / assertLoginPassword: từ chối mật khẩu vi phạm quy tắc', async () => {
        const tooShort = 'Ex@1';                                          // Chỉ 4 ký tự
        const tooLong = 'Example@' + 'a'.repeat(14);                      // 22 ký tự
        const noUppercase = 'example@123';                                // Thiếu chữ in hoa
        const noLowercase = 'EXAMPLE@123';                                // Thiếu chữ in thường
        const noSpecial = 'Example12345';                                 // Thiếu ký tự đặc biệt
        for (const invalidPassword of [tooShort, tooLong, noUppercase, noLowercase, noSpecial]) {
            await expectApiError(() => assertValidPassword(invalidPassword), 400);   // Mỗi mật khẩu sai đều phải bị chặn
        }
        expect(assertLoginPassword('anything') === 'anything', 'Login chỉ cần mật khẩu có dữ liệu');   // Login không kiểm độ mạnh
        await expectApiError(() => assertLoginPassword(''), 400);         // Thiếu mật khẩu khi login -> lỗi 400
    });

    await runCase('assertValidTaskContent: chấp nhận tiếng Việt, dấu phẩy, ngoặc kép', async () => {
        const rawContent = '  Luyện tập Node.js, "quotes" và tiếng Việt  ';   // Nội dung có ký tự khó
        const content = assertValidTaskContent(rawContent);                   // Kiểm tra và chuẩn hoá
        expect(content === 'Luyện tập Node.js, "quotes" và tiếng Việt', `Kết quả sai: "${content}"`);   // Đúng nội dung đã trim
    });

    await runCase('assertValidTaskContent: chặn rỗng và quá 100 ký tự', async () => {
        await expectApiError(() => assertValidTaskContent('   '), 400);    // Chỉ có khoảng trắng -> lỗi
        expect(assertValidTaskContent('x'.repeat(100)).length === 100, '100 ký tự phải được chấp nhận');   // Đúng giới hạn
        await expectApiError(() => assertValidTaskContent('x'.repeat(101)), 400);   // 101 ký tự -> lỗi
    });

    await runCase('assertBoolean / assertStringField / assertJsonObject / assertOnlyAllowedFields', async () => {
        expect(assertBoolean(true, 'completed') === true, 'Boolean hợp lệ bị từ chối');      // true là hợp lệ
        await expectApiError(() => assertBoolean('true', 'completed'), 400);                 // Chuỗi "true" không phải boolean
        expect(assertStringField('  user_abc  ', 'assignedTo') === 'user_abc', 'Chưa cắt khoảng trắng');   // Phải trim
        await expectApiError(() => assertStringField(123, 'assignedTo'), 400);               // Số không phải chuỗi
        await expectApiError(() => assertJsonObject(null), 400);                             // null không phải object JSON
        const hackBody = { content: 'Hợp lệ', id: 'user_hacked' };                          // Body có field cấm "id"
        await expectApiError(() => assertOnlyAllowedFields(hackBody, ['content', 'assignedTo', 'completed']), 400);   // Phải bị chặn
    });

    await runCase('passwordUtils: cùng mật khẩu + salt khác nhau -> hash khác nhau', async () => {
        const firstRecord = await buildPasswordRecord('Example@123');       // Bản ghi mật khẩu thứ nhất
        const secondRecord = await buildPasswordRecord('Example@123');      // Bản ghi thứ hai với salt mới
        expect(firstRecord.passwordSalt !== secondRecord.passwordSalt, 'Salt phải khác nhau cho mỗi tài khoản');
        expect(firstRecord.passwordHash !== secondRecord.passwordHash, 'Hash phải khác nhau dù cùng mật khẩu');
        expect(firstRecord.passwordHash.length === 128, 'Hash scrypt (64 byte) phải dài 128 ký tự hex');
    });

    await runCase('passwordUtils: verifyPassword đúng/sai và không sập với hash hỏng', async () => {
        const record = await buildPasswordRecord('Example@123');            // Tạo dữ liệu mật khẩu mẫu
        expect(await verifyPassword('Example@123', record.passwordSalt, record.passwordHash), 'Mật khẩu đúng bị từ chối');
        expect(!(await verifyPassword('Example@124', record.passwordSalt, record.passwordHash)), 'Mật khẩu sai lại được chấp nhận');
        expect(!(await verifyPassword('Example@123', record.passwordSalt, 'not-a-valid-hex')), 'Hash hỏng phải trả false, không ném lỗi');
        expect(!(await verifyPassword('Example@123', record.passwordSalt, '')), 'Hash rỗng phải trả false');
    });

    await runCase('jwtUtils: token có sub = userId và hạn đúng theo JWT_EXPIRES_DAYS', async () => {
        process.env.JWT_EXPIRES_DAYS = '3';                                 // Cấu hình 3 ngày như file .env mẫu
        const token = signAuthToken('user_test_001');                       // Ký token cho user giả
        const payload = verifyAuthToken(token);                             // Xác thực lại để đọc payload
        expect(payload.sub === 'user_test_001', `Claim sub sai: ${payload.sub}`);            // sub phải là ID user
        expect(payload.exp - payload.iat === 3 * 24 * 60 * 60, 'Hạn token không phải 3 ngày');   // Đúng 3 ngày
    });

    await runCase('jwtUtils: đổi JWT_EXPIRES_DAYS trong .env -> hạn token đổi theo', async () => {
        const previousValue = process.env.JWT_EXPIRES_DAYS;                 // Lưu giá trị cũ để khôi phục
        process.env.JWT_EXPIRES_DAYS = '7';                                 // Giả lập người dùng sửa .env thành 7 ngày
        const payload = verifyAuthToken(signAuthToken('user_test_002'));    // Ký và xác thực token mới
        expect(payload.exp - payload.iat === 7 * 24 * 60 * 60, 'Chưa đọc đúng JWT_EXPIRES_DAYS mới');   // Đúng 7 ngày
        process.env.JWT_EXPIRES_DAYS = 'abc';                               // Giả lập cấu hình sai
        const originalWarn = console.warn;                                  // Tạm tắt cảnh báo cho output gọn
        console.warn = () => { };                                            // Bỏ qua cảnh báo trong case này
        try {
            expect(getJwtExpiresDays() === 3, 'Giá trị sai phải quay về mặc định 3 ngày');   // Phải về mặc định
        } finally {
            console.warn = originalWarn;                                      // Luôn khôi phục console.warn
            if (previousValue === undefined) delete process.env.JWT_EXPIRES_DAYS;   // Khôi phục đúng trạng thái ban đầu
            else process.env.JWT_EXPIRES_DAYS = previousValue;                // Trả lại giá trị cũ
        }
    });

    await runCase('jwtUtils: từ chối token rỗng, token bị sửa, token hết hạn (401)', async () => {
        await expectApiError(() => verifyAuthToken(''), 401, 'missing');    // Token rỗng -> 401
        const validToken = signAuthToken('user_test_003');                  // Token hợp lệ để đem đi sửa
        const tamperedToken = validToken.slice(0, -2) + 'xx';               // Đổi 2 ký tự cuối -> chữ ký sai
        await expectApiError(() => verifyAuthToken(tamperedToken), 401, 'Invalid');   // Token bị sửa -> 401
        const expiredToken = jwt.sign({}, process.env.JWT_SECRET, {         // Tự ký token đã hết hạn
            subject: 'user_test_004',                                         // ID user giả
            expiresIn: '1ms',                                                 // Hạn 1 mili giây
            algorithm: 'HS256',                                               // Cùng thuật toán với dự án
        });
        await sleep(30);                                                    // Chờ 30ms cho chắc chắn hết hạn
        await expectApiError(() => verifyAuthToken(expiredToken), 401, 'expired');   // Token hết hạn -> 401
    });

    await runCase('tokenUtils: token ngẫu nhiên, băm SHA-256, so sánh an toàn', async () => {
        const tokenA = generateVerificationToken();                         // Token thứ nhất
        const tokenB = generateVerificationToken();                         // Token thứ hai
        expect(tokenA !== tokenB, 'Hai token phải khác nhau');              // Sinh ngẫu nhiên nên phải khác
        expect(tokenA.length === 64, 'Token 32 byte phải dài 64 ký tự hex');// Đúng độ dài
        const hashA = hashVerificationToken(tokenA);                        // Băm token thứ nhất
        expect(hashA.length === 64 && hashA !== tokenA, 'Hash phải khác token gốc');   // Không lưu token gốc
        expect(safeCompareHex(hashA, hashVerificationToken(tokenA)), 'Cùng token phải so sánh bằng nhau');
        expect(!safeCompareHex(hashA, hashVerificationToken(tokenB)), 'Token khác phải so sánh không bằng');
        expect(!safeCompareHex('', ''), 'Chuỗi rỗng phải trả false');       // Không được coi 2 chuỗi rỗng là bằng nhau
    });

    await runCase('responseUtils: cấu trúc JSON status/message/data đúng quy ước', async () => {
        const successResponse = createFakeResponse();                       // Giả lập đối tượng response
        sendSuccess(successResponse, 'Server is running', { nodeVersion: 'v24.21.0' });   // Gửi phản hồi thành công
        const successPayload = JSON.parse(successResponse.body);            // Đọc lại JSON đã gửi
        expect(successResponse.statusCode === 200, 'Mã trạng thái thành công phải là 200');
        expect(successPayload.status === 'OK' && successPayload.message === 'Server is running', 'Thiếu status/message');
        expect(successPayload.data.nodeVersion === 'v24.21.0', 'Thiếu data trong phản hồi thành công');

        const errorResponse = createFakeResponse();                          // Giả lập response cho phản hồi lỗi
        sendError(errorResponse, 409, 'This email is already registered');   // Gửi phản hồi lỗi 409
        const errorPayload = JSON.parse(errorResponse.body);                 // Đọc lại JSON đã gửi
        expect(errorResponse.statusCode === 409 && errorPayload.status === 'ERROR', 'Phản hồi lỗi sai quy ước');
        expect(errorPayload.message === 'This email is already registered', 'Thông báo lỗi không nguyên vẹn');

        const apiErrorResponse = createFakeResponse();                       // Giả lập response cho ApiError
        sendErrorFromException(apiErrorResponse, new ApiError(404, 'Task not found'));   // Chuyển ApiError thành phản hồi
        expect(apiErrorResponse.statusCode === 404, 'ApiError phải giữ đúng mã trạng thái 404');

        const unknownErrorResponse = createFakeResponse();                   // Giả lập response cho lỗi hệ thống
        const originalError = console.error;                                 // Tạm tắt log để output test gọn
        console.error = () => { };
        try {
            sendErrorFromException(unknownErrorResponse, new Error('Chi tiết nội bộ không được lộ'));   // Lỗi không lường trước
        } finally {
            console.error = originalError;                                     // Luôn khôi phục console.error
        }
        const unknownPayload = JSON.parse(unknownErrorResponse.body);        // Đọc lại JSON đã gửi
        expect(unknownErrorResponse.statusCode === 500, 'Lỗi hệ thống phải trả mã 500');
        expect(unknownPayload.message === 'Internal server error', 'Không được lộ chi tiết nội bộ cho client');
    });

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi ===`);   // In tổng kết
    if (failedCases > 0) process.exit(1);                                  // Có case lỗi -> thoát mã 1
    console.log('Tất cả utils đều hoạt động đúng ✔');                      // Thông báo thành công
}

main().catch((error) => {                                                // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);             // In đầy đủ để debug
    process.exit(1);                                                       // Thoát với mã lỗi 1
});