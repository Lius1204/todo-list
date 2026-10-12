/**
 * ============================================================================
 *  FILE    : backend/src/services/seedEmailService.js
 *  MỤC ĐÍCH: Nạp 1 triệu email seed vào RAM (Set) MỘT LẦN và cung cấp hàm tra
 *            cứu O(1) để kiểm tra email trùng khi đăng ký.
 *  VÌ SAO DÙNG RAM: đọc file CSV 1 triệu dòng mỗi request sẽ mất vài trăm ms
 *            tới vài giây (không đạt mốc 500ms). Nạp 1 lần lúc khởi động rồi
 *            tra trên bộ nhớ thì mỗi lần tra chỉ vài trăm nano giây.
 *  CHI PHÍ  : ~44 MB file -> khoảng 90-130 MB RAM (tuỳ máy). Chấp nhận được
 *            với máy tính hiện nay và được chủ động nạp lúc server khởi động.
 * ============================================================================
 */

import fs from 'node:fs';                                 // createReadStream để đọc file lớn theo dòng
import fsp from 'node:fs/promises';                       // fs bản Promise để stat file
import path from 'node:path';                             // Ghép đường dẫn an toàn
import { createInterface } from 'node:readline';          // Đọc file theo từng dòng, không tạo mảng 1 triệu phần tử
import { normalizeEmail } from '../utils/validationUtils.js';   // Chuẩn hoá email giống lúc đăng ký

// Đường dẫn file seed: từ backend/src/services lùi 2 cấp rồi vào db
export const SEED_CSV_PATH = path.join(import.meta.dirname, '..', '..', 'db', 'seed_users.csv');

const seedEmailSet = new Set();                           // Tập email đã chuẩn hoá, tra cứu O(1)
let seedStats = null;                                     // Thống kê sau khi nạp (null = chưa nạp)
let loadPromise = null;                                   // Promise đang nạp (đảm bảo chỉ nạp 1 lần dù gọi nhiều nơi)
const BYTES_PER_MB = 1024 * 1024;                         // Số byte trong 1 MB để đổi đơn vị

// Đọc RAM đang dùng (chỉ tính heap của V8) để so sánh trước/sau khi nạp
function currentHeapUsedMb() {
    return process.memoryUsage().heapUsed / BYTES_PER_MB;   // Trả về số MB heap đang dùng
}

// Thực hiện nạp file seed vào Set (chỉ chạy 1 lần nhờ loadSeedEmails bên dưới)
async function loadSeedEmailsNow() {
    const loadStartedAt = performance.now();                // Bắt đầu tính thời gian nạp
    const heapBeforeMb = currentHeapUsedMb();               // Đo RAM trước khi nạp

    let fileStats;                                          // Thông tin file seed
    try {
        fileStats = await fsp.stat(SEED_CSV_PATH);            // Kiểm tra file seed có tồn tại không
    } catch (error) {
        if (error.code === 'ENOENT') {                        // File chưa được sinh
            seedStats = { loaded: false, totalEmails: 0, loadDurationMs: 0, fileSizeBytes: 0, heapDeltaMb: 0 };
            return seedStats;                                   // Trả về trạng thái "chưa nạp" để nơi gọi tự quyết định
        }
        throw error;                                          // Lỗi khác (quyền truy cập...) -> để nơi gọi xử lý
    }

    // Đọc file theo từng dòng bằng stream + readline (không tạo mảng 1 triệu phần tử cùng lúc)
    const lineReader = createInterface({
        input: fs.createReadStream(SEED_CSV_PATH, { encoding: 'utf8' }),   // Stream đọc file UTF-8
        crlfDelay: Infinity,                                  // Gộp cặp \r\n thành 1 dòng (thân thiện với file tạo trên Windows)
    });

    let lineNumber = 0;                                     // Số dòng đã đọc
    for await (const rawLine of lineReader) {               // Duyệt từng dòng của file seed
        lineNumber += 1;                                      // Tăng số dòng
        if (lineNumber === 1) continue;                       // Bỏ qua dòng header "id,email"

        const line = rawLine.trim();                          // Bỏ khoảng trắng 2 đầu
        if (line === '') continue;                            // Bỏ dòng trống

        const commaIndex = line.indexOf(',');                 // Vị trí dấu phẩy ngăn cách id và email
        if (commaIndex === -1) continue;                      // Dòng lạ không đúng định dạng -> bỏ qua an toàn

        const email = line.slice(commaIndex + 1).trim().toLowerCase();   // Lấy phần email và chuẩn hoá
        if (email !== '') seedEmailSet.add(email);            // Thêm vào Set (Set tự bỏ qua giá trị trùng)
    }

    seedStats = {                                           // Lưu thống kê để log và trả về cho nơi gọi
        loaded: true,                                         // Đã nạp thành công
        totalEmails: seedEmailSet.size,                       // Số email nạp được (mong đợi 1.000.000)
        loadDurationMs: Math.round(performance.now() - loadStartedAt),   // Thời gian nạp (ms)
        fileSizeBytes: fileStats.size,                        // Kích thước file seed (byte)
        heapDeltaMb: Number((currentHeapUsedMb() - heapBeforeMb).toFixed(1)),   // RAM tăng thêm (MB)
    };
    return seedStats;                                       // Trả thống kê cho nơi gọi
}

// Nạp seed (gọi được ở bất kỳ đâu; nạp xong sẽ trả kết quả cache ngay lập tức)
export async function loadSeedEmails() {
    if (seedStats) return seedStats;                        // Đã nạp rồi -> trả ngay thống kê cũ

    if (!loadPromise) {                                     // Chưa có tiến trình nạp nào
        loadPromise = loadSeedEmailsNow().catch((error) => {  // Bắt đầu nạp; nếu lỗi thì...
            loadPromise = null;                                 // ...cho phép lần gọi sau thử nạp lại
            throw error;                                        // ...và ném lỗi cho nơi gọi lần này
        });
    }
    return loadPromise;                                     // Nhiều nơi gọi cùng lúc vẫn dùng chung 1 tiến trình nạp
}

// Kiểm tra 1 email có nằm trong danh sách 1 triệu email seed hay không
export async function isEmailSeeded(email) {
    await loadSeedEmails();                                 // Đảm bảo dữ liệu đã được nạp (lần gọi đầu mới tốn thời gian)
    const normalizedEmail = normalizeEmail(email);          // Chuẩn hoá giống lúc đăng ký (trim + lowercase)
    if (normalizedEmail === '') return false;               // Email rỗng -> không thể trùng
    return seedEmailSet.has(normalizedEmail);               // Tra cứu O(1): vài trăm nano giây
}

// Trả bản sao thống kê seed (dùng cho script test và log khởi động)
export function getSeedStats() {
    return seedStats ? { ...seedStats } : null;             // Trả bản sao để bên ngoài không sửa được dữ liệu gốc
}