/**
 * ============================================================================
 *  FILE    : backend/src/utils/csvUtils.js
 *  MỤC ĐÍCH: Lớp lưu trữ CSV tập trung cho toàn dự án (users.csv, tasks.csv).
 *            Mọi thao tác đọc/ghi/khởi tạo file CSV đều đi qua file này.
 *  ĐẶC ĐIỂM :
 *            1. Đọc/ghi CSV đúng chuẩn RFC 4180 (dấu phẩy, ngoặc kép, Unicode, xuống dòng).
 *            2. Tự tạo file kèm header nếu chưa tồn tại.
 *            3. Ghi an toàn: ghi ra file .tmp rồi rename đè lên file chính.
 *            4. Hàng đợi theo từng file: các thao tác ghi không chồng nhau (tránh mất dữ liệu).
 *            5. Lỗi đọc file KHÔNG bị coi là "file rỗng" (đúng yêu cầu mục 6.3 của đề).
 *  THƯ VIỆN: csv-parse (đọc) và csv-stringify (ghi) - đã cài ở Bước 1.
 * ============================================================================
 */

// --- Các import cần thiết ---
import fsp from 'node:fs/promises';              // fs bản Promise để đọc/ghi file bất đồng bộ
import path from 'node:path';                    // Ghép đường dẫn an toàn trên mọi hệ điều hành
import { parse } from 'csv-parse/sync';          // Hàm parse CSV (đọc chuỗi -> mảng object)
import { stringify } from 'csv-stringify/sync';  // Hàm stringify CSV (mảng object -> chuỗi)

// --- Phần 1: Hằng số đường dẫn và schema của 2 file dữ liệu ---

// Thư mục backend/db: từ backend/src/utils lùi 2 cấp rồi vào db
export const DB_DIR = path.join(import.meta.dirname, '..', '..', 'db');

// Đường dẫn file lưu tài khoản người dùng
export const USERS_CSV_PATH = path.join(DB_DIR, 'users.csv');

// Đường dẫn file lưu danh sách công việc
export const TASKS_CSV_PATH = path.join(DB_DIR, 'tasks.csv');

// Tên cột của users.csv - ĐÚNG THỨ TỰ theo đề bài (không được đổi)
export const USERS_HEADERS = [
    'id', 'email', 'passwordSalt', 'passwordHash', 'name', 'status',
    'verificationTokenHash', 'verificationExpiresAt', 'verificationSentAt', 'createdAt',
];

// Tên cột của tasks.csv - ĐÚNG THỨ TỰ theo đề bài (không được đổi)
export const TASKS_HEADERS = ['id', 'content', 'createdBy', 'assignedTo', 'completed', 'createdAt', 'updatedAt'];

// --- Phần 2: Lớp lỗi riêng để phân biệt "lỗi lưu trữ" với lỗi nghiệp vụ thường ---
export class CsvStorageError extends Error {   // Lớp lỗi riêng, kế thừa từ Error
    constructor(message, cause) {                // Nhận thông báo lỗi và lỗi gốc (nếu có)
        super(message);                            // Gọi constructor của Error để gán message
        this.name = 'CsvStorageError';             // Đặt tên lớp lỗi để dễ nhận biết khi log
        this.cause = cause;                        // Lưu lỗi gốc để phục vụ debug
    }
}

// --- Phần 3: Hàng đợi ghi theo từng file (write queue) ---
// Mục đích: nếu 2 request cùng ghi 1 file ở cùng thời điểm, chúng chạy tuần tự thay vì
// chồng lên nhau làm mất dữ liệu của nhau (trong phạm vi 1 tiến trình Node.js).
const writeQueues = new Map();                 // Map: đường dẫn file -> Promise của thao tác ghi gần nhất

// Đưa một thao tác vào cuối hàng đợi của file, trả về Promise của thao tác đó
function runSerialized(filePath, operation) {
    const previous = writeQueues.get(filePath) ?? Promise.resolve();  // Lấy thao tác ghi trước đó (hoặc Promise rỗng)
    const current = previous.catch(() => { }).then(operation);         // Chờ thao tác trước xong (dù lỗi) rồi mới chạy
    writeQueues.set(filePath, current);                               // Ghi nhớ thao tác này làm "cuối hàng"
    return current;                                                   // Trả Promise để nơi gọi await và xử lý lỗi
}

// --- Phần 4: Các hàm nội bộ (chạy trực tiếp, không tự vào hàng đợi) ---

// Ghi CSV thật sự: ghi ra file .tmp trước, thành công mới rename đè lên file chính.
// Nhờ vậy nếu ghi lỗi giữa đường thì file dữ liệu gốc vẫn nguyên vẹn.
async function writeCsvFileNow(filePath, headers, rows) {
    const csvText = stringify(rows, {            // Chuyển mảng object thành chuỗi CSV
        header: true,                              // Dòng đầu tiên là dòng header
        columns: headers,                          // Cố định thứ tự cột theo schema khai báo
        record_delimiter: '\n',                    // Mỗi bản ghi cách nhau bằng ký tự xuống dòng
    });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;   // Tên file tạm kèm pid + thời gian
    try {
        await fsp.writeFile(tmpPath, csvText, 'utf8');                  // Ghi toàn bộ nội dung vào file tạm
        await fsp.rename(tmpPath, filePath);                            // Đổi tên file tạm -> thay thế file chính
    } catch (error) {
        await fsp.rm(tmpPath, { force: true }).catch(() => { });         // Dọn file tạm nếu ghi thất bại
        throw new CsvStorageError(`Không ghi được file CSV: ${path.basename(filePath)}`, error);  // Báo lỗi rõ ràng
    }
}

// Kiểm tra file đã tồn tại chưa; nếu chưa (hoặc rỗng) thì tạo mới với dòng header
async function ensureCsvFileNow(filePath, headers) {
    let stats = null;                             // Biến lưu thông tin file
    try {
        stats = await fsp.stat(filePath);           // Thử lấy thông tin file (kiểm tra tồn tại)
    } catch (error) {
        if (error.code !== 'ENOENT') {              // Lỗi khác "file không tồn tại" -> lỗi thật, dừng ngay
            throw new CsvStorageError(`Không kiểm tra được file CSV: ${path.basename(filePath)}`, error);
        }
    }
    if (stats && stats.isFile() && stats.size > 0) return false;      // File đã có nội dung -> không tạo lại
    try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });   // Đảm bảo thư mục db tồn tại
        await writeCsvFileNow(filePath, headers, []);                   // Ghi file mới chỉ có dòng header
        return true;                                                    // Báo hiệu "đã tạo file mới"
    } catch (error) {
        if (error instanceof CsvStorageError) throw error;              // Giữ nguyên lỗi lưu trữ đã đóng gói
        throw new CsvStorageError(`Không tạo được file CSV: ${path.basename(filePath)}`, error);
    }
}

// Đọc file CSV thành mảng object; ném lỗi rõ ràng nếu file lỗi (KHÔNG coi là rỗng)
async function readCsvFileNow(filePath, headers) {
    let rawText = '';                                                // Biến chứa toàn bộ nội dung file
    try {
        rawText = await fsp.readFile(filePath, 'utf8');                // Đọc file dạng text UTF-8
    } catch (error) {
        throw new CsvStorageError(`Không đọc được file CSV: ${path.basename(filePath)}`, error);  // Lỗi đọc -> báo lỗi
    }
    if (rawText.trim() === '') return [];                            // File chỉ có khoảng trắng -> coi như chưa có dòng dữ liệu

    // Lấy dòng header thực tế trong file (bỏ BOM nếu có) để so với schema mong đợi
    const firstLine = rawText.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].trim();  // Dòng vật lý đầu tiên
    if (firstLine !== headers.join(',')) {                           // So sánh với header đúng của schema
        throw new CsvStorageError(`Header của ${path.basename(filePath)} không đúng schema: "${firstLine}"`);
    }

    try {
        return parse(rawText, {                      // Parse chuỗi CSV thành mảng object
            columns: headers,                          // Gán tên cột theo đúng schema đã khai báo
            from_line: 2,                              // Bỏ qua dòng 1 (header), lấy dữ liệu từ dòng 2
            bom: true,                                 // Tự loại bỏ ký tự BOM nếu file được tạo bởi Excel
            skip_empty_lines: true,                    // Bỏ qua các dòng trống vô nghĩa
            relax_column_count: false,                 // Sai số cột -> ném lỗi ngay, KHÔNG đoán dữ liệu
            trim: false,                               // Không tự cắt khoảng trắng, giữ nguyên nội dung gốc
        });
    } catch (error) {
        throw new CsvStorageError(`File CSV bị hỏng, không parse được: ${path.basename(filePath)}`, error);
    }
}

// --- Phần 5: API công khai của lớp CSV ---

// Tạo file CSV kèm header nếu chưa có (đi qua hàng đợi để không đụng thao tác ghi khác)
export async function ensureCsvFile(filePath, headers) {
    return runSerialized(filePath, () => ensureCsvFileNow(filePath, headers));  // Chạy hàm tạo file trong hàng đợi
}

// Khởi tạo nhanh cả 2 file dữ liệu của dự án (dùng lúc khởi động server)
export async function ensureAllCsvFiles() {
    await ensureCsvFile(USERS_CSV_PATH, USERS_HEADERS);   // Đảm bảo users.csv tồn tại
    await ensureCsvFile(TASKS_CSV_PATH, TASKS_HEADERS);   // Đảm bảo tasks.csv tồn tại
}

// Đọc toàn bộ file CSV thành mảng object (tự tạo file nếu chưa tồn tại)
export async function readCsvFile(filePath, headers) {
    await ensureCsvFile(filePath, headers);               // Đảm bảo file tồn tại trước khi đọc
    return readCsvFileNow(filePath, headers);             // Đọc và parse dữ liệu ra mảng object
}

// Ghi đè toàn bộ file CSV bằng danh sách rows mới (đi qua hàng đợi)
export async function writeCsvFile(filePath, headers, rows) {
    return runSerialized(filePath, () => writeCsvFileNow(filePath, headers, rows));  // Ghi trong hàng đợi
}

// Cập nhật file CSV theo cơ chế "đọc - sửa - ghi" nằm TRỌN trong hàng đợi.
// mutator: hàm nhận mảng rows hiện tại, trả về mảng rows mới (hoặc ném lỗi để hủy thay đổi).
export async function updateCsvFile(filePath, headers, mutator) {
    return runSerialized(filePath, async () => {          // Toàn bộ đọc + sửa + ghi chạy tuần tự
        await ensureCsvFileNow(filePath, headers);          // Đảm bảo file tồn tại
        const currentRows = await readCsvFileNow(filePath, headers);    // Đọc dữ liệu hiện tại
        const nextRows = await mutator(currentRows);                    // Gọi hàm sửa dữ liệu của nơi dùng
        await writeCsvFileNow(filePath, headers, nextRows);             // Ghi lại toàn bộ file
        return nextRows;                                                // Trả về dữ liệu mới cho nơi gọi
    });
}