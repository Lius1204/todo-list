/**
 * ============================================================================
 *  FILE    : backend/src/services/authService.js
 *  MỤC ĐÍCH: Toàn bộ nghiệp vụ xác thực: đăng ký, xác thực email, gửi lại email,
 *            và đăng nhập (Bước 4).
 *  NGUYÊN TẮC (mục 6.1 + 8 + 9 của đề bài):
 *            - Tài khoản mới có status = "pending", chỉ "active" mới đăng nhập được.
 *            - Chỉ lưu HASH của token xác thực, không lưu token gốc.
 *            - Lưu tài khoản TRƯỚC, gửi email SAU và không chờ SMTP (response ≤ 0.5s).
 *            - Lỗi gửi email KHÔNG làm hỏng việc đăng ký; tài khoản vẫn pending.
 *            - Login: cùng một thông báo cho "email sai" và "mật khẩu sai"
 *              để không tiết lộ email nào có tồn tại trong hệ thống.
 *  CẬP NHẬT: Bước 4 thêm loginUser.
 * ============================================================================
 */

import { ApiError } from '../utils/responseUtils.js';                                   // Lớp lỗi nghiệp vụ dùng chung
import { USERS_CSV_PATH, USERS_HEADERS, readCsvFile, updateCsvFile } from '../utils/csvUtils.js';   // Lớp lưu trữ CSV
import { generateUserId } from '../utils/idUtils.js';                                   // Sinh ID user duy nhất
import { buildPasswordRecord, hashPassword, verifyPassword } from '../utils/passwordUtils.js';   // Băm/kiểm tra mật khẩu
import { generateVerificationToken, hashVerificationToken, safeCompareHex } from '../utils/tokenUtils.js';   // Token xác thực
import { assertValidEmail, assertValidName, assertValidPassword, assertLoginPassword, normalizeEmail } from '../utils/validationUtils.js';   // Kiểm tra dữ liệu
import { signAuthToken } from '../utils/jwtUtils.js';                                   // Ký JWT khi đăng nhập thành công
import { isEmailConfigured, sendVerificationEmail } from './emailService.js';           // Dịch vụ gửi email
import { isEmailSeeded } from './seedEmailService.js';                                  // (Bước 7) Tra nhanh 1 triệu email seed trên RAM

// --- Các con số cấu hình nghiệp vụ ---
export const VERIFICATION_TOKEN_TTL_MINUTES = 15;         // Token xác thực có hạn 15 phút (đúng yêu cầu đề)
export const RESEND_COOLDOWN_SECONDS = 60;                // Chờ tối thiểu 60 giây giữa 2 lần gửi lại email
const MILLISECONDS_PER_SECOND = 1000;                     // Số mili giây trong 1 giây
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;   // Số mili giây trong 1 phút
const VERIFICATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;      // Token hợp lệ: 32 byte -> 64 ký tự hex

// Thông báo dùng chung cho endpoint gửi lại email: KHÔNG tiết lộ email có tồn tại hay không
const GENERIC_RESEND_MESSAGE = 'If this email address belongs to an account that is not verified yet, a new verification email has been sent.';

// Thông báo dùng chung cho login sai: KHÔNG tiết lộ email có tồn tại hay không (mục 11.1 của đề)
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

// Salt cố định chỉ dùng cho lần băm "giả" khi email không tồn tại.
// Mục đích: thời gian phản hồi của trường hợp email sai GIỐNG trường hợp email đúng,
// tránh kẻ tấn công đo thời gian để dò xem email nào có trong hệ thống.
const TIMING_EQUALIZATION_SALT = 'timing-equalization-salt-value';

// --- Hàm tiện ích liên quan tới user ---

// Chuyển một dòng trong users.csv thành dữ liệu AN TOÀN để trả cho client
// (tuyệt đối không trả passwordSalt, passwordHash, verificationTokenHash - mục 6.1)
export function toPublicUser(userRow) {
    if (!userRow) return null;                              // Không có dòng nào -> trả null
    return { id: userRow.id, name: userRow.name, email: userRow.email };   // Chỉ 3 field công khai
}

// Đọc toàn bộ người dùng từ users.csv
async function readAllUsers() {
    return readCsvFile(USERS_CSV_PATH, USERS_HEADERS);      // Trả về mảng object theo đúng schema
}

// Tìm người dùng theo email (so sánh không phân biệt chữ hoa/thường)
export async function findUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email);          // Chuẩn hoá email cần tìm
    if (normalizedEmail === '') return null;                // Email rỗng -> không tìm
    const users = await readAllUsers();                     // Đọc danh sách người dùng
    return users.find((user) => normalizeEmail(user.email) === normalizedEmail) ?? null;   // Tìm dòng khớp
}

// Tìm người dùng theo ID (dùng cho middleware JWT ở Bước 4)
export async function findUserById(userId) {
    if (typeof userId !== 'string' || userId.length === 0) return null;   // ID không hợp lệ
    const users = await readAllUsers();                     // Đọc danh sách người dùng
    return users.find((user) => user.id === userId) ?? null;   // Tìm dòng có ID tương ứng
}

// Tìm người dùng theo HASH của token xác thực (không bao giờ tìm bằng token gốc)
export async function findUserByVerificationTokenHash(tokenHash) {
    if (typeof tokenHash !== 'string' || tokenHash.length === 0) return null;   // Hash rỗng -> không tìm
    const users = await readAllUsers();                     // Đọc danh sách người dùng
    // So sánh bằng hàm an toàn về thời gian để tránh rò rỉ thông tin qua thời gian phản hồi
    return users.find((user) => user.verificationTokenHash && safeCompareHex(user.verificationTokenHash, tokenHash)) ?? null;
}

// Chặn email đã tồn tại: tra TRƯỚC trong 1 triệu email seed (RAM, O(1)) rồi mới đọc users.csv
export async function assertEmailAvailable(email) {
    if (await isEmailSeeded(email)) {                       // (Bước 7) Email nằm trong danh sách 1 triệu email ảo đã seed
        throw new ApiError(409, 'This email address is already registered. Please log in instead.');   // Chặn ngay, không tốn CPU băm mật khẩu
    }

    const existingUser = await findUserByEmail(email);      // Tìm xem email đã có tài khoản thật nào dùng chưa
    if (!existingUser) return;                              // Chưa có -> hợp lệ

    if (existingUser.status === 'pending') {                // Đã đăng ký nhưng chưa xác thực email
        throw new ApiError(409, 'This email address is already registered but not verified yet. Please check your inbox or request a new verification email.');
    }
    throw new ApiError(409, 'This email address is already registered. Please log in instead.');   // Email đã dùng
}

// --- Nghiệp vụ 1: Đăng ký tài khoản ---

// Lên lịch gửi email xác thực ở chế độ NỀN (không await)
function scheduleVerificationEmail({ userRow, verificationToken }) {
    if (!isEmailConfigured()) {                             // Thiếu cấu hình SMTP -> không thể gửi
        console.warn(`[email] Chưa cấu hình đủ SMTP - KHÔNG gửi được email xác thực cho ${userRow.email}. Tài khoản vẫn ở trạng thái pending.`);
        return;                                               // Kết thúc: không hề báo thành công giả
    }

    // KHÔNG await: phản hồi đăng ký trả về ngay sau khi tài khoản được lưu (yêu cầu mục 8 + NFR 0.5s)
    sendVerificationEmail({
        toEmail: userRow.email,                               // Gửi tới email vừa đăng ký
        recipientName: userRow.name,                          // Tên hiển thị trong email
        verificationToken,                                    // Token gốc (chỉ tồn tại trong RAM và trong email)
        expiresInMinutes: VERIFICATION_TOKEN_TTL_MINUTES,      // Thông báo hạn 15 phút cho người dùng
    })
        .then((info) => {
            // Chỉ chạy khi Nodemailer ĐÃ xác nhận SMTP nhận email -> mới được coi là gửi thành công
            console.log(`[email] Đã gửi email xác thực tới ${userRow.email} (messageId: ${info.messageId})`);
        })
        .catch((error) => {
            // Gửi thất bại: ghi log an toàn (không log token), tài khoản giữ nguyên pending
            console.error(`[email] Gửi email xác thực thất bại cho ${userRow.email}: ${error.message}`);
            console.error('[email] Tài khoản vẫn ở trạng thái pending. Người dùng có thể dùng chức năng "Resend verification email".');
        });
}

/**
 * Đăng ký tài khoản mới.
 * Trả về { user, verificationToken }.
 * LƯU Ý BẢO MẬT: verificationToken chỉ dùng cho tầng service và test tự động,
 *               TUYỆT ĐỐI không đưa vào phản hồi HTTP.
 */
export async function registerUser({ name, email, password }) {
    const checkedName = assertValidName(name);              // Kiểm tra + chuẩn hoá tên hiển thị
    const checkedEmail = assertValidEmail(email);            // Kiểm tra + chuẩn hoá email (trim + lowercase)
    const checkedPassword = assertValidPassword(password);   // Kiểm tra đủ 5 quy tắc mật khẩu

    await assertEmailAvailable(checkedEmail);                // Chặn email trùng trước khi tốn CPU băm mật khẩu

    const { passwordSalt, passwordHash } = await buildPasswordRecord(checkedPassword);   // Băm mật khẩu với salt riêng
    const verificationToken = generateVerificationToken();   // Sinh token xác thực ngẫu nhiên 256-bit
    const verificationTokenHash = hashVerificationToken(verificationToken);              // Chỉ giữ lại hash để lưu CSV

    const now = new Date();                                  // Thời điểm hiện tại
    const createdAt = now.toISOString();                     // Thời điểm tạo tài khoản (ISO 8601)
    const verificationExpiresAt = new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MINUTES * MILLISECONDS_PER_MINUTE).toISOString();   // Hạn token +15 phút

    const newUserRow = {
        id: generateUserId(),                                  // ID duy nhất, sinh ngẫu nhiên (không phụ thuộc số dòng)
        email: checkedEmail,                                   // Email đã chuẩn hoá
        passwordSalt,                                          // Salt riêng của tài khoản
        passwordHash,                                          // Hash scrypt của mật khẩu
        name: checkedName,                                     // Tên hiển thị
        status: 'pending',                                     // Tài khoản mới LUÔN ở trạng thái pending
        verificationTokenHash,                                 // Chỉ lưu hash của token xác thực
        verificationExpiresAt,                                 // Hạn của token xác thực
        verificationSentAt: createdAt,                         // Thời điểm hệ thống bắt đầu gửi email (ngay sau khi lưu)
        createdAt,                                             // Thời điểm tạo tài khoản
    };

    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        // Kiểm tra trùng LẦN NỮA bên trong hàng đợi ghi để an toàn khi 2 người đăng ký cùng lúc
        const isDuplicated = rows.some((row) => normalizeEmail(row.email) === checkedEmail);
        if (isDuplicated) throw new ApiError(409, 'This email address is already registered. Please log in instead.');
        return [...rows, newUserRow];                          // Thêm tài khoản mới vào cuối danh sách
    });

    scheduleVerificationEmail({ userRow: newUserRow, verificationToken });   // Gửi email ở chế độ nền (bước 2 trong luồng)

    return { user: newUserRow, verificationToken };          // Trả về tài khoản vừa lưu (đã lưu xong mới trả)
}

// --- Nghiệp vụ 2: Xác thực email bằng token trong link ---

/**
 * Xác thực email: kiểm tra token, hạn, trạng thái rồi chuyển tài khoản sang "active".
 * Trả về thông tin công khai của người dùng đã kích hoạt.
 */
export async function verifyEmailToken(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.trim() === '') {   // Không có token trong link
        throw new ApiError(400, 'Verification token is missing');
    }
    const token = rawToken.trim();                           // Bỏ khoảng trắng thừa trong URL
    if (!VERIFICATION_TOKEN_PATTERN.test(token)) {           // Token sai định dạng (không phải 64 ký tự hex)
        throw new ApiError(400, 'Verification token format is not valid');
    }

    const tokenHash = hashVerificationToken(token);           // Băm token để so với dữ liệu đã lưu
    const matchedUser = await findUserByVerificationTokenHash(tokenHash);   // Tìm tài khoản có hash khớp
    if (!matchedUser) {
        // Không tìm thấy = token sai, hoặc token đã dùng rồi (đã bị xoá khỏi CSV) -> không được dùng lại
        throw new ApiError(400, 'This verification link is invalid or has already been used.');
    }
    if (matchedUser.status === 'active') {                    // Tài khoản đã kích hoạt trước đó
        throw new ApiError(400, 'This account is already verified. You can log in now.');
    }

    const expiresAtMillis = Date.parse(matchedUser.verificationExpiresAt);   // Đọc hạn token
    if (!Number.isFinite(expiresAtMillis) || expiresAtMillis <= Date.now()) {   // Hạn không hợp lệ hoặc đã qua
        throw new ApiError(400, 'This verification link has expired. Please request a new verification email.');
    }

    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.id === matchedUser.id);   // Tìm lại dòng theo ID
        if (rowIndex === -1) {                                  // Tài khoản đã bị xoá trong lúc chờ
            throw new ApiError(400, 'This verification link is invalid or has already been used.');
        }
        const currentRow = rows[rowIndex];                      // Dòng hiện tại trong file
        // Kiểm tra lại lần nữa trong hàng đợi: nếu token đã bị thay/xoá (đã dùng) thì từ chối
        if (!safeCompareHex(currentRow.verificationTokenHash, tokenHash)) {
            throw new ApiError(400, 'This verification link is invalid or has already been used.');
        }
        const currentExpiresAt = Date.parse(currentRow.verificationExpiresAt);   // Đọc lại hạn trong file
        if (!Number.isFinite(currentExpiresAt) || currentExpiresAt <= Date.now()) {
            throw new ApiError(400, 'This verification link has expired. Please request a new verification email.');
        }

        const activatedRow = {
            ...currentRow,                                        // Giữ nguyên mọi field khác
            status: 'active',                                     // [3] Chuyển trạng thái sang đã kích hoạt
            verificationTokenHash: '',                            // Xoá hash token -> token không thể dùng lại
            verificationExpiresAt: '',                            // Xoá hạn token
        };
        const nextRows = [...rows];                             // Tạo mảng mới (không sửa trực tiếp mảng cũ)
        nextRows[rowIndex] = activatedRow;                      // Thay dòng tương ứng
        return nextRows;                                        // Ghi lại toàn bộ file
    });

    return { ...toPublicUser(matchedUser), status: 'active' };   // Trả về dữ liệu công khai cho controller
}

// --- Nghiệp vụ 3: Gửi lại email xác thực (có rate limit) ---

/**
 * Gửi lại email xác thực cho tài khoản đang pending.
 * Trả về { message, sent, verificationToken }.
 * LƯU Ý BẢO MẬT: response luôn dùng cùng 1 message chung, không tiết lộ email có tồn tại hay không.
 */
export async function resendVerificationEmail(emailInput) {
    const checkedEmail = assertValidEmail(emailInput);        // Kiểm tra định dạng email
    const existingUser = await findUserByEmail(checkedEmail); // Tìm tài khoản theo email

    // Không tìm thấy HOẶC tài khoản đã active -> trả message chung (không tiết lộ thông tin)
    if (!existingUser || existingUser.status !== 'pending') {
        return { sent: false, message: GENERIC_RESEND_MESSAGE, verificationToken: null };
    }

    const lastSentAtMillis = Date.parse(existingUser.verificationSentAt);   // Đọc thời điểm gửi gần nhất
    if (Number.isFinite(lastSentAtMillis)) {                  // Nếu có dữ liệu thời gian
        const elapsedSeconds = (Date.now() - lastSentAtMillis) / MILLISECONDS_PER_SECOND;   // Số giây đã trôi qua
        if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {         // Còn trong thời gian chờ -> chặn spam
            const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds);   // Số giây còn phải chờ
            throw new ApiError(429, `Too many verification email requests. Please wait ${waitSeconds} seconds and try again.`);
        }
    }

    const newToken = generateVerificationToken();             // Sinh token mới
    const newTokenHash = hashVerificationToken(newToken);      // Băm token mới để lưu
    const sentAt = new Date().toISOString();                   // Thời điểm gửi lại
    const newExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MINUTES * MILLISECONDS_PER_MINUTE).toISOString();   // Hạn mới +15 phút

    let updatedRow = null;                                    // Biến giữ dòng sau khi cập nhật
    await updateCsvFile(USERS_CSV_PATH, USERS_HEADERS, (rows) => {
        const rowIndex = rows.findIndex((row) => row.id === existingUser.id);   // Tìm dòng theo ID
        if (rowIndex === -1) return rows;                       // Tài khoản đã bị xoá -> không làm gì

        const currentRow = rows[rowIndex];                      // Dòng hiện tại
        const currentLastSentAt = Date.parse(currentRow.verificationSentAt);   // Kiểm tra lại cooldown trong hàng đợi
        if (Number.isFinite(currentLastSentAt) && (Date.now() - currentLastSentAt) / MILLISECONDS_PER_SECOND < RESEND_COOLDOWN_SECONDS) {
            throw new ApiError(429, 'Too many verification email requests. Please try again later.');
        }

        updatedRow = {
            ...currentRow,                                        // Giữ nguyên các field khác
            verificationTokenHash: newTokenHash,                  // Token cũ bị vô hiệu hoá, thay bằng hash token mới
            verificationExpiresAt: newExpiresAt,                   // Hạn mới
            verificationSentAt: sentAt,                            // Ghi nhận lần gửi gần nhất
        };
        const nextRows = [...rows];                             // Tạo mảng mới
        nextRows[rowIndex] = updatedRow;                         // Thay dòng tương ứng
        return nextRows;                                        // Ghi lại file
    });

    if (!updatedRow) {                                        // Không cập nhật được (tài khoản bị xoá)
        return { sent: false, message: GENERIC_RESEND_MESSAGE, verificationToken: null };
    }

    scheduleVerificationEmail({ userRow: updatedRow, verificationToken: newToken });   // Gửi email mới ở chế độ nền
    return { sent: true, message: GENERIC_RESEND_MESSAGE, verificationToken: newToken };
}

// --- Nghiệp vụ 4: Đăng nhập (Bước 4) ---

/**
 * Đăng nhập: kiểm tra email + mật khẩu, chặn tài khoản chưa active, ký JWT.
 * Trả về { token, user } - user là dòng đầy đủ (nội bộ), controller tự lọc field công khai.
 */
export async function loginUser({ email, password }) {
    const checkedEmail = assertValidEmail(email);                 // Kiểm tra + chuẩn hoá email
    const checkedPassword = assertLoginPassword(password);        // Đảm bảo mật khẩu có dữ liệu (login không kiểm độ mạnh)

    const userRow = await findUserByEmail(checkedEmail);          // Tìm tài khoản theo email đã chuẩn hoá
    if (!userRow) {
        // Email không tồn tại: vẫn thực hiện 1 lần băm "giả" để thời gian phản hồi
        // GIỐNG trường hợp email tồn tại -> không lộ thông tin qua timing attack.
        await hashPassword(checkedPassword, TIMING_EQUALIZATION_SALT);
        throw new ApiError(401, INVALID_CREDENTIALS_MESSAGE);       // Thông báo chung, không nói rõ sai email hay sai mật khẩu
    }

    const isPasswordValid = await verifyPassword(checkedPassword, userRow.passwordSalt, userRow.passwordHash);   // So hash bằng scrypt + timingSafeEqual
    if (!isPasswordValid) {
        throw new ApiError(401, INVALID_CREDENTIALS_MESSAGE);       // Vẫn dùng CÙNG thông báo chung như trên
    }

    if (userRow.status !== 'active') {
        // Mật khẩu ĐÚNG nhưng tài khoản chưa kích hoạt -> được phép nói rõ để người dùng biết đường xác thực email
        throw new ApiError(403, 'Your account is not verified yet. Please check your inbox and click the verification link, or use "Resend verification email" on the Login page.');
    }

    const token = signAuthToken(userRow.id);                      // Ký JWT: sub = user ID; hạn đọc từ JWT_EXPIRES_DAYS trong .env
    return { token, user: userRow };                              // Trả token + dòng user; controller lọc field công khai khi trả client
}