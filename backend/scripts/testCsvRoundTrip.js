/**
 * ============================================================================
 *  FILE    : backend/scripts/testCsvRoundTrip.js
 *  MỤC ĐÍCH: Kiểm tra tự động lớp lưu trữ CSV (backend/src/utils/csvUtils.js).
 *  CÁCH CHẠY: node backend/scripts/testCsvRoundTrip.js
 *  GHI CHÚ : Script chỉ làm việc trong thư mục tạm backend/db/tmp/csv-tests,
 *            KHÔNG đụng đến dữ liệu thật (users.csv, tasks.csv).
 * ============================================================================
 */

import fsp from 'node:fs/promises';                     // Đọc/ghi file trong thư mục test
import path from 'node:path';                           // Ghép đường dẫn an toàn
import {
    DB_DIR,                 // Thư mục backend/db
    USERS_HEADERS,          // Header thật của users.csv
    ensureCsvFile,          // Hàm tạo file kèm header
    readCsvFile,            // Hàm đọc CSV
    updateCsvFile,          // Hàm cập nhật CSV (đọc - sửa - ghi trong hàng đợi)
} from '../src/utils/csvUtils.js';                      // Import lớp CSV của dự án
import { generateUserId } from '../src/utils/idUtils.js';  // Import hàm sinh ID user

const TEST_DIR = path.join(DB_DIR, 'tmp', 'csv-tests');         // Thư mục tạm chứa file test
const ROUND_TRIP_FILE = path.join(TEST_DIR, 'round-trip.csv');  // File cho test ký tự đặc biệt
const HEADER_FILE = path.join(TEST_DIR, 'header-check.csv');    // File cho test tạo header
const TEST_HEADERS = ['id', 'content', 'completed'];            // Schema rút gọn để test nhanh

let passedCases = 0;                                    // Đếm số case đạt
let failedCases = 0;                                    // Đếm số case lỗi

// Chạy 1 case test và in kết quả đạt/lỗi ra màn hình
async function runCase(caseName, testFunction) {
    try {
        await testFunction();                               // Thực thi nội dung kiểm tra
        passedCases += 1;                                   // Tăng biến đếm case đạt
        console.log(`✅ PASS: ${caseName}`);                // In kết quả đạt
    } catch (error) {
        failedCases += 1;                                   // Tăng biến đếm case lỗi
        console.log(`❌ FAIL: ${caseName}`);                // In kết quả lỗi
        console.log(`   Lý do: ${error.message}`);          // In lý do cụ thể để dễ sửa
    }
}

// Kiểm tra điều kiện đúng; nếu sai thì ném lỗi kèm thông báo tiếng Việt
function expect(condition, message) {
    if (!condition) throw new Error(message);             // Ném lỗi khi điều kiện không đúng
}

// Hàm chính: dọn thư mục test, chạy lần lượt các case, in tổng kết
async function main() {
    await fsp.rm(TEST_DIR, { recursive: true, force: true });   // Xoá thư mục test cũ (nếu còn sót)
    await fsp.mkdir(TEST_DIR, { recursive: true });             // Tạo lại thư mục test sạch
    console.log('=== BẮT ĐẦU TEST LỚP CSV (BƯỚC 2A) ===\n');    // In tiêu đề

    // CASE 1: file chưa tồn tại -> tự tạo kèm đúng header của users.csv
    await runCase('Tạo file CSV mới kèm đúng header của users.csv', async () => {
        await ensureCsvFile(HEADER_FILE, USERS_HEADERS);                 // Tạo file mới với header thật
        const rawText = await fsp.readFile(HEADER_FILE, 'utf8');         // Đọc lại file vừa tạo
        const firstLine = rawText.trim().split(/\r?\n/, 1)[0];           // Lấy dòng đầu tiên (header)
        expect(firstLine === USERS_HEADERS.join(','), `Header sai. Nhận được: "${firstLine}"`);  // So từng cột
    });

    // CASE 2: đọc file chưa tồn tại -> trả mảng rỗng, không lỗi, và tự tạo file
    await runCase('Đọc file chưa tồn tại trả về mảng rỗng (không lỗi)', async () => {
        const rows = await readCsvFile(path.join(TEST_DIR, 'not-exist.csv'), TEST_HEADERS);  // Đọc file chưa có
        expect(Array.isArray(rows) && rows.length === 0, 'Phải trả về mảng rỗng');           // Bắt buộc rỗng
    });

    // CASE 3: ghi rồi đọc lại các ký tự khó (dấu phẩy, ngoặc kép, tiếng Việt, xuống dòng)
    await runCase('Round-trip: dấu phẩy, ngoặc kép, Unicode, xuống dòng vẫn nguyên vẹn', async () => {
        const originalRows = [                                           // 4 dòng với 4 loại ký tự khó
            { id: 'row_1', content: 'Task with, a comma', completed: 'false' },      // Dấu phẩy
            { id: 'row_2', content: 'He said "hello" loudly', completed: 'true' },   // Ngoặc kép
            { id: 'row_3', content: 'Luyện tập Node.js tiếng Việt có dấu', completed: 'false' },  // Unicode
            { id: 'row_4', content: 'First line\nSecond line', completed: 'false' }, // Xuống dòng trong ô
        ];
        await updateCsvFile(ROUND_TRIP_FILE, TEST_HEADERS, (rows) => [...rows, ...originalRows]);  // Ghi 4 dòng
        const readRows = await readCsvFile(ROUND_TRIP_FILE, TEST_HEADERS);        // Đọc lại từ file
        expect(readRows.length === 4, `Số dòng phải là 4, nhận được ${readRows.length}`);  // Đúng 4 dòng
        for (const original of originalRows) {                        // Duyệt từng dòng gốc
            const found = readRows.find((row) => row.id === original.id);          // Tìm dòng tương ứng
            expect(found, `Không tìm thấy dòng ${original.id}`);                   // Bắt buộc tìm thấy
            expect(found.content === original.content, `Nội dung dòng ${original.id} bị sai: "${found.content}"`);  // So nội dung
        }
        const rawText = await fsp.readFile(ROUND_TRIP_FILE, 'utf8');   // Đọc file thô để xem cách thư viện quote
        console.log('   --- Nội dung file CSV thật (xem cách thư viện tự thêm ngoặc kép) ---');
        console.log(rawText.replace(/^/gm, '   | '));                  // In từng dòng kèm tiền tố cho dễ đọc
    });

    // CASE 4: 20 thao tác ghi "cùng lúc" -> hàng đợi phải giữ đủ 20 dòng, không mất dữ liệu
    await runCase('20 thao tác ghi song song không làm mất dữ liệu (write queue)', async () => {
        const concurrentFile = path.join(TEST_DIR, 'concurrent.csv');  // File riêng cho test này
        await ensureCsvFile(concurrentFile, TEST_HEADERS);             // Tạo file trống có header
        const appendOneRow = (index) => updateCsvFile(                 // Hàm thêm 1 dòng mới vào file
            concurrentFile,
            TEST_HEADERS,
            (rows) => [...rows, { id: `row_${index}`, content: `Task ${index}`, completed: 'false' }],
        );
        await Promise.all(Array.from({ length: 20 }, (_, index) => appendOneRow(index)));  // Bắn 20 ghi song song
        const rows = await readCsvFile(concurrentFile, TEST_HEADERS);  // Đọc lại để kiểm tra
        expect(rows.length === 20, `Phải có đủ 20 dòng, nhận được ${rows.length} dòng (bị mất dữ liệu!)`);
    });

    // CASE 5: file hỏng (sai số cột) -> phải ném lỗi, KHÔNG được coi là file rỗng
    await runCase('File CSV hỏng (sai số cột) -> báo lỗi rõ ràng, KHÔNG coi là rỗng', async () => {
        const brokenFile = path.join(TEST_DIR, 'broken.csv');          // File cố tình sai dữ liệu
        await ensureCsvFile(brokenFile, TEST_HEADERS);                 // Tạo file đúng header trước
        await fsp.appendFile(brokenFile, 'row_1,Chi co 2 cot\n', 'utf8');  // Ghi dòng thiếu 1 cột
        let errorThrown = false;                                       // Cờ đánh dấu "có lỗi được ném ra"
        try {
            await readCsvFile(brokenFile, TEST_HEADERS);                 // Đọc file hỏng
        } catch {
            errorThrown = true;                                          // Ghi nhận đã ném lỗi đúng như mong đợi
        }
        expect(errorThrown, 'Phải ném lỗi khi file sai số cột, nhưng đã trả về bình thường');
    });

    // CASE 6: file sai header -> phải ném lỗi, không đọc "liều"
    await runCase('File CSV sai header -> báo lỗi, không đọc liều', async () => {
        const wrongHeaderFile = path.join(TEST_DIR, 'wrong-header.csv');       // File cố tình sai header
        await fsp.writeFile(wrongHeaderFile, 'id,title\nrow_1,Hello\n', 'utf8');  // Ghi file với header lạ
        let errorThrown = false;                                       // Cờ đánh dấu "có lỗi được ném ra"
        try {
            await readCsvFile(wrongHeaderFile, TEST_HEADERS);            // Đọc file sai schema
        } catch {
            errorThrown = true;                                          // Ghi nhận lỗi đã được ném ra
        }
        expect(errorThrown, 'Phải ném lỗi khi header không đúng schema');
    });

    // CASE 7: sinh 10.000 ID -> không được trùng nhau
    await runCase('Sinh 10.000 ID ngẫu nhiên không bị trùng', async () => {
        const ids = new Set();                                         // Set để kiểm tra trùng lặp
        for (let index = 0; index < 10000; index += 1) ids.add(generateUserId());  // Sinh 10.000 user ID
        expect(ids.size === 10000, `Bị trùng ID! Chỉ có ${ids.size} ID khác nhau`);  // Đủ 10.000 ID khác nhau
    });

    console.log(`\n=== KẾT QUẢ: ${passedCases} đạt / ${failedCases} lỗi ===`);   // In tổng kết
    await fsp.rm(TEST_DIR, { recursive: true, force: true });        // Dọn sạch thư mục test
    if (failedCases > 0) process.exit(1);                            // Có case lỗi -> thoát mã 1
    console.log('Tất cả test CSV đều đạt ✔');                        // Thông báo thành công
}

main().catch((error) => {                                          // Bắt lỗi ngoài dự kiến của cả script
    console.error('Lỗi không mong đợi khi chạy test:', error);       // In đầy đủ để debug
    process.exit(1);                                                 // Thoát với mã lỗi
});