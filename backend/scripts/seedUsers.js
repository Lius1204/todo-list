/**
 * ============================================================================
 *  FILE    : backend/scripts/seedUsers.js
 *  MỤC ĐÍCH: Sinh 1.000.000 user ảo vào backend/db/seed_users.csv (seeding).
 *            - Email ảo dạng: seeduser0000001@example.com ... seeduser1000000@example.com
 *              (dùng example.com vì đây là tên miền dành riêng cho ví dụ/tài liệu,
 *              không phải email thật của ai cả).
 *            - Ghi bằng stream + xử lý backpressure để không tốn RAM.
 *            - KHÔNG gửi email, KHÔNG băm mật khẩu (user ảo chỉ để test trùng email).
 *  CÁCH CHẠY:
 *            - Tạo lần đầu : node backend/scripts/seedUsers.js
 *            - Tạo lại      : node backend/scripts/seedUsers.js --force
 * ============================================================================
 */

import fs from 'node:fs';                                 // Stream ghi file (dùng cho file lớn)
import fsp from 'node:fs/promises';                       // fs bản Promise để stat/mkdir/rm
import path from 'node:path';                             // Ghép đường dẫn an toàn
import { once } from 'node:events';                       // once: chờ 1 sự kiện của stream (drain, finish)

// --- Cấu hình seeding ---
const TOTAL_SEED_USERS = 1_000_000;                       // Đúng 1 triệu user theo yêu cầu giảng viên
const DB_DIR = path.join(import.meta.dirname, '..', 'db');          // Thư mục backend/db
const SEED_FILE_PATH = path.join(DB_DIR, 'seed_users.csv');          // File seed đầu ra
const HEADER_LINE = 'id,email';                           // Dòng header theo schema tối giản
const PROGRESS_STEP = 100_000;                            // Cứ 100.000 dòng thì in tiến độ 1 lần

// Sinh ID cho user seed, ví dụ: seed_user_0000001
function buildSeedId(index) {
    return `seed_user_${String(index).padStart(7, '0')}`;   // Đệm 0 cho đủ 7 chữ số -> không bao giờ trùng
}

// Sinh email cho user seed, ví dụ: seeduser0000001@example.com
function buildSeedEmail(index) {
    return `seeduser${String(index).padStart(7, '0')}@example.com`;   // Đệm 0 -> 1.000.000 email đều khác nhau
}

// Hàm chính: sinh file seed
async function main() {
    const forceFlag = process.argv.includes('--force');     // Cờ --force: cho phép ghi đè file cũ

    let existingFileStats = null;                           // Thông tin file cũ (nếu có)
    try {
        existingFileStats = await fsp.stat(SEED_FILE_PATH);   // Kiểm tra file đã tồn tại chưa
    } catch {
        existingFileStats = null;                             // Chưa có file -> sẽ tạo mới
    }

    if (existingFileStats && !forceFlag) {                  // File đã có và không bắt buộc ghi lại
        const sizeMb = (existingFileStats.size / (1024 * 1024)).toFixed(1);   // Kích thước file theo MB
        console.log(`[seed] File đã tồn tại: backend/db/seed_users.csv (${sizeMb} MB) - bỏ qua để không ghi lại tốn thời gian.`);
        console.log('[seed] Muốn tạo lại từ đầu, chạy: node backend/scripts/seedUsers.js --force');
        return;                                               // Kết thúc sớm
    }

    await fsp.mkdir(DB_DIR, { recursive: true });           // Đảm bảo thư mục backend/db tồn tại
    console.log(`[seed] Bắt đầu sinh ${TOTAL_SEED_USERS.toLocaleString('en-US')} user ảo vào file seed_users.csv ...`);

    const startedAt = performance.now();                    // Bắt đầu tính thời gian sinh file
    const writeStream = fs.createWriteStream(SEED_FILE_PATH, { encoding: 'utf8' });   // Mở stream ghi file

    try {
        if (!writeStream.write(`${HEADER_LINE}\n`)) await once(writeStream, 'drain');   // Ghi header, chờ nếu buffer đầy

        for (let index = 1; index <= TOTAL_SEED_USERS; index += 1) {   // Duyệt từ 1 đến 1.000.000
            const row = `${buildSeedId(index)},${buildSeedEmail(index)}\n`;   // Ghép 1 dòng CSV: id,email
            const canContinue = writeStream.write(row);         // Ghi dòng vào stream (trả false nếu buffer đầy)
            if (!canContinue) await once(writeStream, 'drain'); // Buffer đầy -> chờ ghi xong mới ghi tiếp (backpressure)

            if (index % PROGRESS_STEP === 0) {                  // Đủ 100.000 dòng -> in tiến độ
                const percent = Math.round((index / TOTAL_SEED_USERS) * 100);                    // Tính phần trăm
                process.stdout.write(`\r[seed] Đã ghi ${index.toLocaleString('en-US')} / ${TOTAL_SEED_USERS.toLocaleString('en-US')} dòng (${percent}%)`);
            }
        }

        writeStream.end();                                    // Kết thúc ghi
        await once(writeStream, 'finish');                    // Chờ dữ liệu được ghi hết xuống đĩa
    } catch (error) {
        writeStream.destroy();                                // Đóng stream khi lỗi
        await fsp.rm(SEED_FILE_PATH, { force: true }).catch(() => { });   // Xoá file dở dang để không nạp dữ liệu lỗi
        throw error;                                          // Ném lỗi ra ngoài cho hàm main bắt
    }

    process.stdout.write('\n');                             // Xuống dòng sau dòng tiến độ cuối

    const durationMs = performance.now() - startedAt;                                          // Tổng thời gian chạy
    const finalStats = await fsp.stat(SEED_FILE_PATH);                                         // Thông tin file sau khi ghi
    const sizeMb = finalStats.size / (1024 * 1024);                                            // Đổi sang MB
    const rowsPerSecond = Math.round(TOTAL_SEED_USERS / (durationMs / 1000));                  // Tốc độ ghi

    console.log(`[seed] Hoàn tất: ${TOTAL_SEED_USERS.toLocaleString('en-US')} user ảo.`);
    console.log(`[seed] Thời gian sinh file : ${(durationMs / 1000).toFixed(1)} s (${rowsPerSecond.toLocaleString('en-US')} dòng/giây)`);
    console.log(`[seed] File               : backend/db/seed_users.csv (${sizeMb.toFixed(1)} MB, ${(TOTAL_SEED_USERS + 1).toLocaleString('en-US')} dòng gồm header)`);
    console.log('[seed] Email mẫu         : seeduser0000001@example.com ... seeduser1000000@example.com');
    console.log('[seed] Bước tiếp theo    : khởi động lại server (npm start) để nạp danh sách vào RAM.');
}

main().catch((error) => {                                 // Bắt mọi lỗi của toàn script
    console.error('[seed] LỖI khi sinh dữ liệu seed:', error.message);   // In lý do ngắn gọn
    process.exit(1);                                        // Thoát mã lỗi để biết script thất bại
});