/**
 * ============================================================================
 *  FILE    : backend/scripts/testSeedEmailCheck.js
 *  MỤC ĐÍCH: Kiểm tra tự động Bước 7 (seed 1 triệu email + check trùng nhanh):
 *            PHẦN A - tầng service: file seed đúng 1.000.000 dòng, tra cứu đúng/sai,
 *                     hiệu năng tra cứu, registerUser bị chặn 409 với email seed,
 *                     registerUser email mới vẫn chạy trong ngân sách 500ms.
 *            PHẦN B - HTTP thật: POST /api/signup email trùng seed -> 409 nhanh,
 *                     email mới -> 201, và đo 5 lần/3 lần để lấy trung vị.
 *  CÁCH CHẠY:
 *            1) node backend/scripts/seedUsers.js        (nếu chưa sinh seed)
 *            2) npm start                                (terminal 1)
 *            3) node backend/scripts/testSeedEmailCheck.js   (terminal 2)
 *  GHI CHÚ : chỉ tạo tài khoản test có email bắt đầu bằng "phase7.test."
 *            và tự dọn sạch khi chạy xong.
 * ============================================================================
 */

import path from 'node:path';                                                            // Ghép đường dẫn file .env
import fsp from 'node:fs/promises';                                                      // fs bản Promise để đọc file seed
import { USERS_CSV_PATH, USERS_HEADERS, readCsvFile, updateCsvFile } from '../src/utils/csvUtils.js';   // Lớp lưu trữ CSV
import { ApiError } from '../src/utils/responseUtils.js';                                // Lớp lỗi nghiệp vụ
import { registerUser } from '../src/services/authService.js';                           // Nghiệp vụ đăng ký (đã nối check seed)
import { loadSeedEmails, isEmailSeeded, SEED_CSV_PATH } from '../src/services/seedEmailService.js';   // Dịch vụ seed

// --- Nạp .env (nếu có) để biết cổng server cho phần B ---
try {
    process.loadEnvFile(path.join(import.meta.dirname, '..', '..', '.env'));               // Đọc .env ở thư mục gốc dự án
} catch {
    console.log('[test] Không tìm thấy .env - dùng PORT mặc định 3000.');                  // Vẫn chạy được
}

const BASE_URL = `http://localhost:${Number(process.env.PORT || 3000)}`;                 // Địa chỉ server để test HTTP
const EXPECTED_SEED_TOTAL = 1_000_000;                                                   // Số email seed mong đợi theo yêu cầu giảng viên
const TEST_EMAIL_PREFIX = 'phase7.test.';                                                // Tiền tố email test (dùng để dọn dẹp)
const VALID_PASSWORD = 'Example@123';                                                    // Mật khẩu đúng quy tắc
const SIGNUP_BUDGET_MS = 500;                                                            // Mốc hiệu năng của giảng viên (0,5 s)

const LOOKUP_BATCH_SIZE = 50_000;                                                        // Mỗi vòng đo 50.000 lần tra cứu
const LOOKUP_ROUNDS = 20;                                                                // Đo 20 vòng -> tổng 1.000.000 lần tra cứu

let passedCases = 0;                                                                     // Đếm số case đạt
let failedCases = 0;                                                                     // Đếm số case lỗi
let skippedCases = 0;                                                                    // Đếm số case bị bỏ qua (server chưa chạy)

// --- Số liệu hiệu năng để in phần tổng kết (phục vụ báo cáo/demo) ---
const perfSummary = {
    lookupPerEmailMicroseconds: null,      // Thời gian tra cứu trung bình mỗi email (µs)
    lookupTotalMs: null,                   // Tổng thời gian 1.000.000 lần tra cứu (ms)
    serviceBlockedMs: null,                // registerUser bị chặn bởi seed (ms)
    serviceFreshMs: null,                  // registerUser email mới (ms)
    httpBlockedMedianMs: null,             // POST /api/signup trùng seed: trung vị (ms)
    httpBlockedMaxMs: null,                // POST /api/signup trùng seed: max (ms)
    httpFreshMedianMs: null,               // POST /api/signup email mới: trung vị (ms)
};

// --- Các helper dùng chung ---

// Tạo email test duy nhất theo nhãn truyền vào
function makeTestEmail(label) {
    return `${TEST_EMAIL_PREFIX}${label}.${Date.now()}@example.com`;                       // Có timestamp -> không bao giờ trùng
}

// Sinh email seed theo số thứ tự (giống hệt công thức trong seedUsers.js)
function buildSeedEmail(index) {
    return `seeduser${String(index).padStart(7, '0')}@example.com`;                        // Ví dụ: seeduser00424242@example.com
}

// Chờ một khoảng thời gian (mili giây)
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));                    // Trả Promise hoàn thành sau N ms
}

// Chạy 1 case test và in kết quả
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                                                                // Thực thi nội dung kiểm tra
        passedCases += 1;                                                                    // Tăng biến đếm đạt
        console.log(`✅ PASS: ${caseName}`);                                                 // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                                                    // Tăng biến đếm lỗi
        console.log(`❌ FAIL: ${caseName}`);                                                 // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);                                           // In lý do cụ thể
    }
}

// Kiểm tra điều kiện đúng; sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);                                              // Ném lỗi khi điều kiện sai
}

// Kiểm tra hàm phải ném ApiError đúng mã trạng thái (và chứa phần thông báo nếu truyền vào)
async function expectApiError(callFunction, expectedStatus, expectedPartOfMessage) {
    try {
        await callFunction();                                                                // Gọi hàm cần kiểm tra
    } catch (error) {
        if (!(error instanceof ApiError)) throw new Error(`Lỗi ném ra không phải ApiError (nhận được: ${error.name})`);
        if (error.statusCode !== expectedStatus) throw new Error(`Mã trạng thái sai: ${error.statusCode} (mong đợi ${expectedStatus})`);
        if (expectedPartOfMessage && !error.message.includes(expectedPartOfMessage)) {
            throw new Error(`Thông báo sai: "${error.message}"`);
        }
        return;                                                                              // Đúng như mong đợi
    }
    throw new Error('Không ném lỗi như mong đợi');                                         // Hàm chạy xong không lỗi -> case sai
}

// Gửi request HTTP và trả về status + body text + JSON (nếu có)
async function httpRequest(method, requestPath, { body } = {}) {
    const options = { method, headers: {} };                                               // Cấu hình request
    if (body !== undefined) {                                                              // Có body -> gửi dạng JSON
        options.headers['Content-Type'] = 'application/json';                                // Khai báo kiểu JSON
        options.body = JSON.stringify(body);                                                 // Chuyển object thành chuỗi JSON
    }
    const response = await fetch(`${BASE_URL}${requestPath}`, options);                    // Gọi API bằng fetch của Node.js
    const text = await response.text();                                                    // Đọc body dạng text
    let json = null;                                                                       // Mặc định không có JSON
    try { json = JSON.parse(text); } catch { /* body không phải JSON */ }                  // Tránh sập nếu body không phải JSON
    return { status: response.status, text, json };                                        // Trả kết quả cho nơi gọi
}

// Tính trung vị của một dãy số
function median(values) {
    const sorted = [...values].sort((first, second) => first - second);                    // Sắp xếp tăng dần (trên bản sao)
    const middleIndex = Math.floor(sorted.length / 2);                                     // Vị trí giữa
    if (sorted.length % 2 === 0) return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;   // Chẵn -> trung bình 2 giữa
    return sorted[middleIndex];                                                            // Lẻ -> lấy đúng giữa
}

// Tính phân vị (percentile) của một dãy số
function percentile(values, percent) {
    const sorted = [...values].sort((first, second) => first - second);                    // Sắp xếp tăng dần
    const position = Math.ceil((percent / 100) * sorted.length) - 1;                       // Vị trí theo phần trăm
    return sorted[Math.max(0, Math.min(position, sorted.length - 1))];                     // Chặn biên cho an toàn
}

/**
 * Dọn dẹp dữ liệu test trong users.csv:
 *   1. Xoá user có email bắt đầu bằng "phase7.test." (tài khoản do script này tạo).
 *   2. Xoá luôn dòng nào trùng email seed (dấu hiệu server chưa nạp seed khi test -
 *      không bao giờ được tồn tại tài khoản thật trùng email seed).
 */
async function cleanupTestData() {
    const allRows = await readCsvFile(USERS_CSV_PATH, USERS_HEADERS);                      // Đọc toàn bộ user hiện có
    const emailsToRemove = new Set();                                                      // Tập email cần xoá
    for (const row of allRows) {                                                           // Duyệt từng dòng
        const email = String(row.email);                                                     // Email của dòng
        if (email.startsWith(TEST_EMAIL_PREFIX)) { emailsToRemove.add(email); continue; }    // Tài khoản test -> cần xoá
        if (await isEmailSeeded(email)) emailsToRemove.add(email);                           // Trùng seed -> cũng phải xoá
    }
    if (emailsToRemove.size === 0) return 0;                                               // Không có gì để dọn

    let removedCount = 0;                                                                  // Đếm số dòng đã xoá
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const keptRows = rows.filter((row) => {                                              // Giữ lại dòng không thuộc danh sách xoá
            const shouldKeep = !emailsToRemove.has(String(row.email));                         // Điều kiện giữ lại
            if (!shouldKeep) removedCount += 1;                                                // Đếm số dòng bị xoá
            return shouldKeep;                                                                 // Trả kết quả cho filter
        });
        return keptRows;                                                                     // Ghi lại users.csv
    });
    return removedCount;                                                                   // Trả về số dòng đã xoá
}

// Hàm chính
async function main() {
    console.log('=== BẮT ĐẦU TEST SEED 1 TRIỆU EMAIL + CHECK TRÙNG (BƯỚC 7) ===\n');

    // Dọn tàn dư lần chạy trước (nếu có) TRƯỚC khi test
    const leftoverCount = await cleanupTestData();                                           // Gọi hàm dọn dẹp
    if (leftoverCount > 0) console.log(`[test] Đã dọn ${leftoverCount} tài khoản tồn từ lần chạy trước.\n`);

    // ===================== PHẦN A: TẦNG SERVICE =====================
    console.log('--- PHẦN A: Tầng service (không cần server đang chạy) ---');

    await runCase('A1. File seed đúng định dạng và nạp đủ 1.000.000 email', async () => {
        const fileStats = await fsp.stat(SEED_CSV_PATH).catch(() => null);                    // Kiểm tra file seed có tồn tại
        expect(fileStats, `Không tìm thấy backend/db/seed_users.csv - hãy chạy trước: node backend/scripts/seedUsers.js`);

        const rawText = await fsp.readFile(SEED_CSV_PATH, 'utf8');                            // Đọc file seed (1 lần duy nhất)
        const firstLineBreak = rawText.indexOf('\n');                                         // Vị trí xuống dòng đầu tiên
        const headerLine = (firstLineBreak === -1 ? rawText : rawText.slice(0, firstLineBreak)).trim();   // Lấy dòng header
        expect(headerLine === 'id,email', `Header file seed sai: "${headerLine}" (mong đợi "id,email")`);   // Kiểm tra schema tối giản

        const seedStats = await loadSeedEmails();                                             // Nạp seed vào RAM (có cache, gọi lại không tốn thời gian)
        expect(seedStats.loaded === true, 'Nạp file seed thất bại');                          // Bắt buộc nạp thành công
        expect(seedStats.totalEmails === EXPECTED_SEED_TOTAL,
            `Phải nạp đủ ${EXPECTED_SEED_TOTAL} email, nhận được ${seedStats.totalEmails} - hãy sinh lại seed bằng script seedUsers.js`);   // Đúng số lượng
        console.log(`   [seed] Nạp ${seedStats.totalEmails.toLocaleString('en-US')} email trong ${seedStats.loadDurationMs} ms, RAM tăng ~${seedStats.heapDeltaMb} MB`);
    });

    await runCase('A2. Tra cứu đúng/sai + chuẩn hoá chữ hoa và khoảng trắng', async () => {
        expect(await isEmailSeeded(buildSeedEmail(1)), 'Email seed đầu danh sách (số 1) phải được tìm thấy');            // Dòng đầu file
        expect(await isEmailSeeded(buildSeedEmail(EXPECTED_SEED_TOTAL)), 'Email seed cuối danh sách (số 1.000.000) phải được tìm thấy');   // Dòng cuối file
        expect(await isEmailSeeded(buildSeedEmail(500_000)), 'Email seed ở giữa danh sách (số 500.000) phải được tìm thấy');   // Dòng giữa file
        expect(await isEmailSeeded('  SEEDUSER0000001@EXAMPLE.COM  '), 'Phải tìm thấy dù viết hoa và có khoảng trắng thừa');   // Chuẩn hoá hoạt động
        expect(!(await isEmailSeeded('phase7.khong.ton.tai@example.com')), 'Email lạ KHÔNG được báo là đã tồn tại');          // Không báo dương tính giả
    });

    await runCase('A3. Hiệu năng: 1.000.000 lần tra cứu hoàn tất nhanh (mỗi 50.000 lần ≪ 500 ms)', async () => {
        // Chuẩn bị sẵn danh sách email để đo (không tính thời gian sinh chuỗi vào phép đo)
        const lookupEmails = [];                                                              // Danh sách email dùng lại mọi vòng
        for (let index = 0; index < LOOKUP_BATCH_SIZE; index += 1) {                          // Sinh LOOKUP_BATCH_SIZE email
            if (index % 2 === 0) {                                                              // Nửa đầu: email CÓ trong seed (số ngẫu nhiên 1..1.000.000)
                const randomSeedIndex = 1 + Math.floor(Math.random() * EXPECTED_SEED_TOTAL);      // Chọn ngẫu nhiên 1 email seed
                lookupEmails.push(buildSeedEmail(randomSeedIndex));                               // Đưa email có trong seed vào danh sách
            } else {
                lookupEmails.push(`phase7.miss.${index}@example.com`);                            // Nửa còn lại: email chắc chắn KHÔNG có trong seed
            }
        }

        for (const email of lookupEmails) await isEmailSeeded(email);                         // Vòng khởi động (warm-up) để JIT tối ưu trước khi đo

        const roundDurationsMs = [];                                                          // Thời gian từng vòng đo
        for (let round = 0; round < LOOKUP_ROUNDS; round += 1) {                              // Đo LOOKUP_ROUNDS vòng
            const roundStartedAt = performance.now();                                           // Bắt đầu tính giờ vòng này
            let foundCount = 0;                                                                 // Đếm số email tìm thấy (để chắc chắn có tra thật)
            for (const email of lookupEmails) {                                                 // Duyệt toàn bộ danh sách email
                if (await isEmailSeeded(email)) foundCount += 1;                                  // Tra cứu và đếm kết quả dương tính
            }
            roundDurationsMs.push(performance.now() - roundStartedAt);                          // Lưu thời gian của vòng này
            expect(foundCount > 0, 'Vòng đo không tìm thấy email nào - dữ liệu seed có vấn đề');   // Chắc chắn phép đo là thật
        }

        const totalLookups = LOOKUP_BATCH_SIZE * LOOKUP_ROUNDS;                               // Tổng số lần tra cứu (1.000.000)
        const totalMs = roundDurationsMs.reduce((sum, value) => sum + value, 0);              // Tổng thời gian tất cả các vòng
        const medianRoundMs = median(roundDurationsMs);                                       // Trung vị thời gian mỗi vòng
        const p95RoundMs = percentile(roundDurationsMs, 95);                                  // Phân vị 95
        const maxRoundMs = Math.max(...roundDurationsMs);                                     // Vòng chậm nhất
        const perEmailMicroseconds = (totalMs * 1000) / totalLookups;                         // Suy ra thời gian trung bình mỗi lần tra (µs)

        perfSummary.lookupPerEmailMicroseconds = perEmailMicroseconds;                        // Lưu số liệu cho phần tổng kết
        perfSummary.lookupTotalMs = totalMs;                                                  // Lưu tổng thời gian cho phần tổng kết

        console.log(`   [perf] Tổng ${totalLookups.toLocaleString('en-US')} lần tra cứu hết ${totalMs.toFixed(1)} ms`);
        console.log(`   [perf] Mỗi ${LOOKUP_BATCH_SIZE.toLocaleString('en-US')} lần: trung vị ${medianRoundMs.toFixed(1)} ms | p95 ${p95RoundMs.toFixed(1)} ms | max ${maxRoundMs.toFixed(1)} ms`);
        console.log(`   [perf] Suy ra trung bình mỗi lần tra cứu ≈ ${perEmailMicroseconds.toFixed(2)} µs (mốc của giảng viên: 500.000 µs = 0,5 s)`);

        expect(medianRoundMs < SIGNUP_BUDGET_MS, `Trung vị mỗi ${LOOKUP_BATCH_SIZE} lần tra phải < ${SIGNUP_BUDGET_MS} ms, nhận được ${medianRoundMs.toFixed(1)} ms`);
    });

    await runCase('A4. registerUser với email trùng seed -> 409 và KHÔNG ghi gì vào users.csv', async () => {
        const rowsBefore = await readCsvFile(USERS_CSV_PATH, USERS_HEADERS);                  // Đếm dòng users.csv trước khi đăng ký
        const callStartedAt = performance.now();                                              // Bắt đầu tính giờ
        await expectApiError(
            () => registerUser({ name: 'Phase Seven', email: buildSeedEmail(2), password: VALID_PASSWORD }),   // Đăng ký bằng email có trong seed
            409,                                                                                // Bắt buộc bị chặn 409
            'already registered',                                                               // Thông báo nói rõ đã đăng ký
        );
        const callDurationMs = performance.now() - callStartedAt;                             // Thời gian xử lý
        perfSummary.serviceBlockedMs = callDurationMs;                                        // Lưu số liệu

        const rowsAfter = await readCsvFile(USERS_CSV_PATH, USERS_HEADERS);                   // Đếm dòng users.csv sau khi đăng ký
        expect(rowsAfter.length === rowsBefore.length, 'Đăng ký trùng email seed KHÔNG được thêm dòng nào vào users.csv');   // Dữ liệu thật không bị đụng
        console.log(`   [perf] registerUser bị chặn bởi seed: ${callDurationMs.toFixed(1)} ms (< ${SIGNUP_BUDGET_MS} ms)`);
        expect(callDurationMs < SIGNUP_BUDGET_MS, `Phải chặn trong < ${SIGNUP_BUDGET_MS} ms, nhận được ${callDurationMs.toFixed(1)} ms`);
    });

    await runCase('A5. registerUser với email mới vẫn thành công trong ngân sách 500 ms', async () => {
        const freshEmail = makeTestEmail('service-fresh');                                    // Email mới, chắc chắn không nằm trong seed
        const callStartedAt = performance.now();                                              // Bắt đầu tính giờ
        const registered = await registerUser({ name: 'Phase Seven Tester', email: freshEmail, password: VALID_PASSWORD });   // Đăng ký thật (băm scrypt + ghi CSV)
        const callDurationMs = performance.now() - callStartedAt;                             // Thời gian xử lý
        perfSummary.serviceFreshMs = callDurationMs;                                          // Lưu số liệu

        expect(registered.user.status === 'pending', 'Tài khoản mới phải ở trạng thái pending');   // Đúng luồng đăng ký
        expect(registered.user.email === freshEmail, 'Email tài khoản tạo ra phải khớp');          // Không lệch dữ liệu
        console.log(`   [perf] registerUser email mới (scrypt + ghi CSV): ${callDurationMs.toFixed(1)} ms (< ${SIGNUP_BUDGET_MS} ms)`);
        expect(callDurationMs < SIGNUP_BUDGET_MS, `Phải xong trong < ${SIGNUP_BUDGET_MS} ms, nhận được ${callDurationMs.toFixed(1)} ms`);
    });

    // ===================== PHẦN B: HTTP THẬT =====================
    console.log('\n--- PHẦN B: HTTP thật (cần server đang chạy: npm start) ---');

    let serverIsUp = false;                                                                 // Cờ xác nhận server đang chạy
    try {
        const health = await httpRequest('GET', '/api/health');                               // Gọi endpoint health
        serverIsUp = health.status === 200;                                                   // Server sống nếu trả 200
    } catch {
        serverIsUp = false;                                                                   // Không kết nối được
    }

    if (!serverIsUp) {
        skippedCases += 3;                                                                    // Ghi nhận 3 case bị bỏ qua
        console.log(`⚠️  SKIP: Server chưa chạy ở ${BASE_URL} - hãy chạy "npm start" rồi chạy lại script.`);
    } else {
        await runCase('B1. POST /api/signup email trùng seed -> 409, 5 lần đo đều ≪ 500 ms', async () => {
            const durationsMs = [];                                                             // Thời gian 5 lần đo
            for (let runIndex = 0; runIndex < 5; runIndex += 1) {                               // Đo 5 lần liên tiếp
                const runStartedAt = performance.now();                                           // Bắt đầu tính giờ
                const response = await httpRequest('POST', '/api/signup', {                       // Gọi API đăng ký qua HTTP
                    body: { name: 'Phase Seven', email: buildSeedEmail(3), password: VALID_PASSWORD },   // Email nằm trong 1 triệu seed
                });
                durationsMs.push(performance.now() - runStartedAt);                               // Lưu thời gian lần này

                expect(response.status === 409, `Lần ${runIndex + 1}: phải trả 409, nhận được ${response.status}`);   // Bắt buộc bị chặn
                expect(response.json && String(response.json.message).includes('already registered'), `Lần ${runIndex + 1}: message phải nói rõ đã đăng ký`);   // Thông báo đúng
            }

            const medianMs = median(durationsMs);                                               // Trung vị
            const maxMs = Math.max(...durationsMs);                                             // Trường hợp chậm nhất
            perfSummary.httpBlockedMedianMs = medianMs;                                         // Lưu số liệu
            perfSummary.httpBlockedMaxMs = maxMs;                                               // Lưu số liệu

            console.log(`   [perf] HTTP signup (409, email trùng seed) từng lần: ${durationsMs.map((value) => value.toFixed(1)).join(' ms | ')} ms`);
            console.log(`   [perf] Trung vị ${medianMs.toFixed(1)} ms | max ${maxMs.toFixed(1)} ms`);
            console.log(`   [perf] *** ĐẠT YÊU CẦU: sign-up có check trùng 1 triệu email ≤ ${SIGNUP_BUDGET_MS} ms ***`);

            expect(medianMs < SIGNUP_BUDGET_MS, `Trung vị phải < ${SIGNUP_BUDGET_MS} ms, nhận được ${medianMs.toFixed(1)} ms`);
        });

        await runCase('B2. POST /api/signup email mới -> 201, 3 lần đo đều ≪ 500 ms', async () => {
            const durationsMs = [];                                                             // Thời gian 3 lần đo
            for (let runIndex = 0; runIndex < 3; runIndex += 1) {                               // Đo 3 lần với 3 email khác nhau
                const runStartedAt = performance.now();                                           // Bắt đầu tính giờ
                const response = await httpRequest('POST', '/api/signup', {                       // Gọi API đăng ký qua HTTP
                    body: { name: 'Phase Seven Tester', email: makeTestEmail(`http-fresh-${runIndex}`), password: VALID_PASSWORD },   // Email mới hoàn toàn
                });
                durationsMs.push(performance.now() - runStartedAt);                               // Lưu thời gian lần này

                expect(response.status === 201, `Lần ${runIndex + 1}: phải trả 201, nhận được ${response.status}`);   // Tạo tài khoản thành công
                expect(response.json.data.status === 'pending', `Lần ${runIndex + 1}: tài khoản mới phải pending`);   // Đúng luồng xác thực email
            }

            const medianMs = median(durationsMs);                                               // Trung vị
            perfSummary.httpFreshMedianMs = medianMs;                                           // Lưu số liệu
            console.log(`   [perf] HTTP signup (201, email mới, gồm băm scrypt): trung vị ${medianMs.toFixed(1)} ms (< ${SIGNUP_BUDGET_MS} ms)`);
            expect(medianMs < SIGNUP_BUDGET_MS, `Trung vị phải < ${SIGNUP_BUDGET_MS} ms, nhận được ${medianMs.toFixed(1)} ms`);
        });

        await runCase('B3. Server vẫn khoẻ mạnh sau khi nạp 1 triệu email (health 200)', async () => {
            const healthResponse = await httpRequest('GET', '/api/health');                     // Gọi lại endpoint health
            expect(healthResponse.status === 200, `Health phải trả 200, nhận được ${healthResponse.status}`);   // Server không sập vì nạp seed
            expect(healthResponse.json.status === 'OK', 'Body health phải có status = OK');      // Đúng quy ước JSON
        });
    }

    // ===================== DỌN DẸP VÀ TỔNG KẾT =====================
    const removedCount = await cleanupTestData();                                            // Xoá tài khoản test khỏi users.csv
    console.log(`\n[test] Đã dọn dẹp ${removedCount} tài khoản test khỏi users.csv (dữ liệu thật giữ nguyên).`);

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi / ${skippedCases} bỏ qua ===`);

    // In khối số liệu gọn để chụp ảnh đưa vào báo cáo
    console.log('[test] Số liệu để báo cáo:');
    console.log(`   - Seed: 1.000.000 email trong backend/db/seed_users.csv`);
    if (perfSummary.lookupPerEmailMicroseconds !== null) {
        console.log(`   - Tra cứu: trung bình ${perfSummary.lookupPerEmailMicroseconds.toFixed(2)} µs/lần; 1.000.000 lần hết ${perfSummary.lookupTotalMs.toFixed(1)} ms`);
    }
    if (perfSummary.serviceBlockedMs !== null) {
        console.log(`   - Đăng ký trùng seed (service): ${perfSummary.serviceBlockedMs.toFixed(1)} ms`);
    }
    if (perfSummary.serviceFreshMs !== null) {
        console.log(`   - Đăng ký email mới (service): ${perfSummary.serviceFreshMs.toFixed(1)} ms`);
    }
    if (perfSummary.httpBlockedMedianMs !== null) {
        console.log(`   - HTTP signup trùng seed: trung vị ${perfSummary.httpBlockedMedianMs.toFixed(1)} ms | max ${perfSummary.httpBlockedMaxMs.toFixed(1)} ms`);
    }
    if (perfSummary.httpFreshMedianMs !== null) {
        console.log(`   - HTTP signup email mới: trung vị ${perfSummary.httpFreshMedianMs.toFixed(1)} ms`);
    }
    console.log(`   - Mốc yêu cầu của giảng viên: ${SIGNUP_BUDGET_MS} ms (0,5 s)`);
    console.log('[test] Các tác vụ gửi email chạy nền có thể in log sau dòng này - đó là hành vi bình thường.');

    await sleep(3000);                                                                      // Chờ 3 giây cho log gửi email nền hiện ra
    process.exit(failedCases > 0 ? 1 : 0);                                                  // Thoát mã lỗi nếu có case thất bại
}

main().catch(async (error) => {                                                           // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);                              // In đầy đủ để debug
    try { await cleanupTestData(); } catch { /* bỏ qua lỗi khi dọn dẹp */ }                 // Cố gắng dọn dẹp dù có lỗi
    process.exit(1);                                                                        // Thoát với mã lỗi
});