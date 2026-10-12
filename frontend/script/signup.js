// ============================================================================
//  FILE    : frontend/script/signup.js
//  MỤC ĐÍCH: Xử lý trang Sign Up:
//            - Kiểm tra tên, email và đủ 5 quy tắc mật khẩu giống backend.
//            - Gọi POST /api/signup rồi thông báo "phải mở email để xác thực".
//            - KHÔNG lưu JWT, KHÔNG tự đăng nhập tài khoản đang chờ xác thực
//              (đúng mục 12.3 của đề bài).
// ============================================================================

const MIN_PASSWORD_LENGTH = 8;                                       // Mật khẩu tối thiểu 8 ký tự
const MAX_PASSWORD_LENGTH = 20;                                      // Mật khẩu tối đa 20 ký tự
const MAX_NAME_LENGTH = 50;                                          // Tên hiển thị tối đa 50 ký tự
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;                   // Mẫu email tối thiểu
const UPPERCASE_PATTERN = /[A-Z]/;                                   // Có ít nhất 1 chữ in hoa
const LOWERCASE_PATTERN = /[a-z]/;                                   // Có ít nhất 1 chữ in thường
const SPECIAL_CHARACTER_PATTERN = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?`~]/;   // Có ít nhất 1 ký tự đặc biệt

const signupForm = document.getElementById('signup-form');           // Form đăng ký
const nameInput = document.getElementById('name');                    // Ô nhập tên hiển thị
const emailInput = document.getElementById('email');                  // Ô nhập email
const passwordInput = document.getElementById('password');            // Ô nhập mật khẩu
const nameError = document.getElementById('name-error');              // Vùng báo lỗi của ô tên
const emailError = document.getElementById('email-error');            // Vùng báo lỗi của ô email
const passwordError = document.getElementById('password-error');      // Vùng báo lỗi của ô mật khẩu
const messageBox = document.getElementById('message');                // Vùng thông báo chung dưới tiêu đề
const signupButton = document.getElementById('signup-button');        // Nút SignUp

// Hiển thị thông báo chung; isSuccess = true thì đổi sang màu xanh
function showMessage(text, isSuccess = false) {
    messageBox.textContent = text;                                      // Gán chữ thuần
    messageBox.classList.toggle('success', isSuccess);                  // Đổi màu tuỳ loại thông báo
}

// Xoá toàn bộ thông báo cũ trước lượt kiểm tra mới
function clearMessages() {
    showMessage('');                        // Xoá thông báo chung
    nameError.textContent = '';             // Xoá lỗi ô tên
    emailError.textContent = '';            // Xoá lỗi ô email
    passwordError.textContent = '';         // Xoá lỗi ô mật khẩu
}

// Kiểm tra mật khẩu theo đúng 5 quy tắc trong đề; trả về thông báo lỗi hoặc chuỗi rỗng
function findPasswordError(password) {
    if (password === '') return 'Password is required';                                     // Bỏ trống
    if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;   // Quá ngắn
    if (password.length > MAX_PASSWORD_LENGTH) return `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`;        // Quá dài
    if (!UPPERCASE_PATTERN.test(password)) return 'Password must contain at least one uppercase letter';   // Thiếu chữ hoa
    if (!LOWERCASE_PATTERN.test(password)) return 'Password must contain at least one lowercase letter';   // Thiếu chữ thường
    if (!SPECIAL_CHARACTER_PATTERN.test(password)) return 'Password must contain at least one special character';   // Thiếu ký tự đặc biệt
    return '';                                                                              // Hợp lệ
}

// Kiểm tra toàn bộ form ở trình duyệt (backend vẫn kiểm tra lại có thẩm quyền)
function validateForm() {
    clearMessages();                                                     // Bắt đầu lượt kiểm tra mới
    let isValid = true;                                                  // Cờ đánh dấu form hợp lệ

    const name = nameInput.value.trim();                                 // Lấy tên đã bỏ khoảng trắng 2 đầu
    if (name === '') {                                                   // Bỏ trống tên
        nameError.textContent = 'Display name is required';                // Báo lỗi dưới ô tên
        isValid = false;                                                   // Đánh dấu không hợp lệ
    } else if (name.length > MAX_NAME_LENGTH) {                          // Tên quá dài
        nameError.textContent = `Display name must not exceed ${MAX_NAME_LENGTH} characters`;
        isValid = false;                                                   // Đánh dấu không hợp lệ
    }

    const email = emailInput.value.trim();                               // Lấy email đã bỏ khoảng trắng 2 đầu
    if (email === '') {                                                  // Bỏ trống email
        emailError.textContent = 'Email is required';                      // Báo lỗi dưới ô email
        isValid = false;                                                   // Đánh dấu không hợp lệ
    } else if (!EMAIL_PATTERN.test(email)) {                             // Email sai định dạng
        emailError.textContent = 'Email address format is not valid';      // Báo lỗi định dạng
        isValid = false;                                                   // Đánh dấu không hợp lệ
    }

    const passwordErrorMessage = findPasswordError(passwordInput.value); // Kiểm tra mật khẩu theo 5 quy tắc
    if (passwordErrorMessage !== '') {                                   // Mật khẩu vi phạm quy tắc
        passwordError.textContent = passwordErrorMessage;                  // Hiện đúng lỗi để người dùng sửa
        isValid = false;                                                   // Đánh dấu không hợp lệ
    }
    return isValid;                                                      // Trả kết quả kiểm tra
}

// Xử lý khi người dùng bấm nút SignUp
async function handleSubmit(event) {
    event.preventDefault();                                              // Chặn hành vi tải lại trang của form
    if (!validateForm()) return;                                         // Dữ liệu sai -> không gọi API

    const payload = {                                                    // Dữ liệu gửi lên API đăng ký
        name: nameInput.value.trim(),                                      // Tên hiển thị đã bỏ khoảng trắng
        email: emailInput.value.trim().toLowerCase(),                      // Email chuẩn hoá giống backend
        password: passwordInput.value,                                     // Mật khẩu giữ nguyên
    };

    signupButton.disabled = true;                                        // Khoá nút tránh bấm gửi trùng
    signupButton.textContent = 'Creating account...';                    // Đổi chữ nút báo đang xử lý

    try {
        const response = await fetch('/api/signup', {                      // Gọi API đăng ký (mục 11.1)
            method: 'POST',                                                  // Phương thức POST theo spec
            headers: { 'Content-Type': 'application/json' },                 // Body là JSON
            body: JSON.stringify(payload),                                   // Dữ liệu đăng ký
        });
        const json = await response.json().catch(() => null);              // Đọc JSON an toàn

        if (response.status === 201) {                                     // Tạo tài khoản thành công (status = pending)
            showMessage(
                json?.message || 'Account created. Please check your inbox and open the verification link to activate your account.',
                true,                                                          // Hiển thị màu xanh = thành công
            );
            passwordInput.value = '';                                        // Xoá mật khẩu khỏi form cho an toàn
            return;                                                          // Kết thúc hàm (KHÔNG lưu token, KHÔNG tự đăng nhập)
        }
        showMessage(json?.message || `Sign up failed (HTTP ${response.status})`);   // 400 sai quy tắc, 409 email trùng...
    } catch {
        showMessage('Cannot reach the server. Please check that the server is running.');   // Lỗi mạng
    } finally {
        signupButton.disabled = false;                                     // Mở khoá nút sau khi xử lý xong
        signupButton.textContent = 'SignUp';                               // Trả lại chữ gốc cho nút
    }
}

signupForm.addEventListener('submit', handleSubmit);                   // Gắn sự kiện cho form đăng ký