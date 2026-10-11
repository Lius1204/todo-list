/**
 * ============================================================================
 *  FILE    : backend/src/utils/tokenUtils.js
 *  MỤC ĐÍCH: Sinh và băm token xác thực email (dùng ở Bước 3).
 *  NGUYÊN TẮC: chỉ lưu HASH của token vào users.csv, không lưu token gốc,
 *            nên kẻ đọc được file CSV cũng không thể kích hoạt tài khoản.
 *  GHI CHÚ : Ở đây dùng SHA-256 là an toàn, KHÁC với mật khẩu, vì token là
 *            chuỗi ngẫu nhiên 256-bit (không thể đoán/dò như mật khẩu người dùng).
 * ============================================================================
 */

import crypto from 'node:crypto';                        // Module crypto có sẵn của Node.js

const TOKEN_BYTES = 32;                                  // 32 byte = 256 bit entropy
const HEX_PATTERN = /^[0-9a-f]+$/i;                      // Mẫu kiểm tra chuỗi hex hợp lệ

// Sinh token xác thực ngẫu nhiên, an toàn về mặt mật mã
export function generateVerificationToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('hex');   // Chuỗi hex 64 ký tự, dùng được trực tiếp trong URL
}

// Băm token để lưu vào users.csv (cột verificationTokenHash)
export function hashVerificationToken(token) {
    if (typeof token !== 'string' || token.length === 0) {    // Chặn đầu vào rỗng
        throw new Error('hashVerificationToken: token must be a non-empty string');
    }
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');   // SHA-256 -> 64 ký tự hex
}

// So sánh 2 chuỗi hex (2 hash token) bằng phương pháp an toàn về thời gian
export function safeCompareHex(hexA, hexB) {
    if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;   // Sai kiểu dữ liệu
    if (hexA.length === 0 || hexA.length !== hexB.length) return false;       // Rỗng hoặc khác độ dài -> không khớp
    if (hexA.length % 2 !== 0) return false;                                // Chuỗi hex phải có độ dài chẵn
    if (!HEX_PATTERN.test(hexA) || !HEX_PATTERN.test(hexB)) return false;     // Chứa ký tự không phải hex
    return crypto.timingSafeEqual(Buffer.from(hexA, 'hex'), Buffer.from(hexB, 'hex'));   // So sánh an toàn
}