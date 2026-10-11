/**
 * ============================================================================
 *  FILE    : backend/src/utils/passwordUtils.js
 *  MỤC ĐÍCH: Băm và kiểm tra mật khẩu bằng crypto.scrypt (không dùng SHA-256
 *            thuần vì quá nhanh, dễ bị dò).
 *  NGUYÊN TẮC:
 *            - Mỗi tài khoản có một salt ngẫu nhiên riêng.
 *            - Không bao giờ lưu mật khẩu gốc.
 *            - So sánh hash bằng timingSafeEqual (chống tấn công đo thời gian).
 * ============================================================================
 */

import crypto from 'node:crypto';                        // Module crypto có sẵn của Node.js
import { promisify } from 'node:util';                   // promisify: biến hàm callback thành hàm async/await

const scryptAsync = promisify(crypto.scrypt);            // Bản async của crypto.scrypt để dùng với await
const SALT_BYTES = 16;                                   // Salt 16 byte ngẫu nhiên -> 32 ký tự hex
const KEY_LENGTH = 64;                                   // Độ dài khoá dẫn xuất 64 byte -> 128 ký tự hex
const HASH_ENCODING = 'hex';                             // Lưu dưới dạng chuỗi hex cho an toàn trong CSV
const HEX_HASH_PATTERN = /^[0-9a-f]{128}$/i;             // Mẫu hợp lệ của hash lưu trong users.csv

// Sinh salt ngẫu nhiên cho một tài khoản mới
export function generateSalt() {
    return crypto.randomBytes(SALT_BYTES).toString(HASH_ENCODING);   // Chuỗi hex ngẫu nhiên 32 ký tự
}

// Băm mật khẩu với salt cho trước (dùng tham số mặc định của scrypt: N=16384, r=8, p=1)
export async function hashPassword(password, salt) {
    if (typeof password !== 'string' || password.length === 0) {     // Chặn đầu vào không hợp lệ
        throw new Error('hashPassword: password must be a non-empty string');   // Lỗi lập trình, không phải lỗi người dùng
    }
    if (typeof salt !== 'string' || salt.length === 0) {            // Chặn salt không hợp lệ
        throw new Error('hashPassword: salt must be a non-empty string');       // Báo lỗi rõ ràng để debug
    }
    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);         // Băm mật khẩu + salt thành 64 byte
    return derivedKey.toString(HASH_ENCODING);                                // Trả về chuỗi hex để lưu CSV
}

// Tạo nguyên bộ thông tin mật khẩu để lưu vào users.csv
export async function buildPasswordRecord(password) {
    const passwordSalt = generateSalt();                         // Sinh salt riêng cho tài khoản này
    const passwordHash = await hashPassword(password, passwordSalt);          // Băm mật khẩu cùng salt đó
    return { passwordSalt, passwordHash };                       // Trả về 2 field đúng tên cột trong CSV
}

// Kiểm tra mật khẩu người dùng nhập có khớp với dữ liệu đã lưu hay không
export async function verifyPassword(password, salt, expectedHash) {
    if (typeof password !== 'string' || typeof salt !== 'string') return false;   // Sai kiểu dữ liệu -> không khớp
    if (typeof expectedHash !== 'string' || !HEX_HASH_PATTERN.test(expectedHash)) return false;   // Hash hỏng -> không khớp

    let candidateHash = '';                                      // Biến chứa hash vừa tính từ mật khẩu nhập vào
    try {
        candidateHash = await hashPassword(password, salt);        // Băm lại mật khẩu với đúng salt đã lưu
    } catch {
        return false;                                              // Có lỗi khi băm -> coi như không khớp, không làm sập request
    }

    const candidateBuffer = Buffer.from(candidateHash, HASH_ENCODING);        // Chuyển hash vừa tính thành Buffer
    const expectedBuffer = Buffer.from(expectedHash, HASH_ENCODING);          // Chuyển hash đã lưu thành Buffer
    if (candidateBuffer.length !== expectedBuffer.length) return false;       // timingSafeEqual yêu cầu 2 buffer cùng độ dài
    return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);           // So sánh an toàn, không rò rỉ thời gian
}