// ============================================================================
//  FILE    : frontend/script/login.js
//  MỤC ĐÍCH: Xử lý trang Login:
//            - Kiểm tra dữ liệu nhập (email hợp lệ, mật khẩu có dữ liệu) và báo
//              lỗi ngay dưới ô nhập nếu sai hoặc thiếu.
//            - Gọi POST /api/login, lưu JWT vào localStorage rồi chuyển sang Task list.
//            - Nếu tài khoản chưa xác thực email (403), hiện nút gửi lại email xác thực.
//            - Nếu đã có token hợp lệ trong localStorage thì vào thẳng Task list.
// ============================================================================

const TOKEN_STORAGE_KEY = 'todo_token';                    // Khoá lưu JWT trong localStorage (dùng chung mọi trang)
const TASK_PAGE_URL = '/page/assign-task.html';            // Trang Task list sau khi đăng nhập thành công
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;        // Mẫu email tối thiểu: có @, có tên miền, không khoảng trắng

const loginForm = document.getElementById('login-form');          // Form đăng nhập
const emailInput = document.getElementById('email');               // Ô nhập email
const passwordInput = document.getElementById('password');         // Ô nhập mật khẩu
const emailError = document.getElementById('email-error');         // Vùng báo lỗi của ô email
const passwordError = document.getElementById('password-error');   // Vùng báo lỗi của ô mật khẩu
const messageBox = document.getElementById('message');             // Vùng thông báo chung dưới tiêu đề
const loginButton = document.getElementById('login-button');       // Nút Login
const resendButton = document.getElementById('resend-button');     // Nút gửi lại email xác thực (ẩn mặc định)

// Hiển thị thông báo chung; isSuccess = true thì đổi sang màu xanh
function showMessage(text, isSuccess = false) {
    messageBox.textContent = text;                                     // Gán chữ thuần (an toàn với dữ liệu ngoài)
    messageBox.classList.toggle('success', isSuccess);                 // Bật/tắt class màu xanh tuỳ loại thông báo
}

// Xoá toàn bộ thông báo đang hiển thị trước lượt kiểm tra mới
function clearMessages() {
    showMessage('');                          // Xoá thông báo chung
    emailError.textContent = '';              // Xoá lỗi ô email
    passwordError.textContent = '';           // Xoá lỗi ô mật khẩu
}

// Kiểm tra dữ liệu người dùng nhập ở trình duyệt (backend vẫn kiểm tra lại lần nữa)
function validateForm() {
    clearMessages();                                                   // Bắt đầu lượt kiểm tra mới
    let isValid = true;                                                // Cờ đánh dấu form hợp lệ

    const email = emailInput.value.trim();                             // Lấy email đã bỏ khoảng trắng 2 đầu
    if (email === '') {                                                // Bỏ trống email
        emailError.textContent = 'Email is required';                    // Báo lỗi dưới ô email (đúng ghi chú "báo lỗi" trong ảnh)
        isValid = false;                                                 // Đánh dấu form không hợp lệ
    } else if (!EMAIL_PATTERN.test(email)) {                           // Email sai định dạng
        emailError.textContent = 'Email address format is not valid';    // Báo lỗi định dạng
        isValid = false;                                                 // Đánh dấu form không hợp lệ
    }

    if (passwordInput.value === '') {                                  // Bỏ trống mật khẩu
        passwordError.textContent = 'Password is required';              // Báo lỗi dưới ô mật khẩu
        isValid = false;                                                 // Đánh dấu form không hợp lệ
    }
    return isValid;                                                    // Trả kết quả kiểm tra
}

// Gọi API đăng nhập; trả về mã trạng thái kèm JSON (nếu có)
async function callLoginApi(email, password) {
    const response = await fetch('/api/login', {                       // Gửi POST tới API login (mục 11.1)
        method: 'POST',                                                  // Phương thức POST theo spec
        headers: { 'Content-Type': 'application/json' },                  // Body là JSON
        body: JSON.stringify({ email, password }),                       // Dữ liệu gửi lên
    });
    let json = null;                                                   // Biến chứa JSON trả về
    try { json = await response.json(); } catch { /* body không phải JSON */ }   // Tránh sập nếu server trả HTML
    return { status: response.status, json };                          // Trả về cả mã trạng thái lẫn dữ liệu
}

// Xử lý khi người dùng bấm nút Login
async function handleSubmit(event) {
    event.preventDefault();                                            // Chặn hành vi tải lại trang của form
    if (!validateForm()) return;                                       // Dữ liệu sai -> dừng, không gọi API

    const email = emailInput.value.trim().toLowerCase();               // Chuẩn hoá email giống backend
    const password = passwordInput.value;                              // Giữ nguyên mật khẩu (không trim)

    loginButton.disabled = true;                                       // Khoá nút để tránh bấm gửi trùng
    loginButton.textContent = 'Logging in...';                         // Đổi chữ nút báo đang xử lý
    resendButton.classList.add('hidden');                              // Ẩn nút gửi lại email của lượt trước

    try {
        const { status, json } = await callLoginApi(email, password);     // Gọi API login
        if (status === 200 && json && json.data && json.data.token) {     // Đăng nhập thành công
            localStorage.setItem(TOKEN_STORAGE_KEY, json.data.token);      // Lưu JWT để dùng cho các request sau
            window.location.href = TASK_PAGE_URL;                          // Chuyển sang trang Task list
            return;                                                        // Kết thúc hàm
        }
        if (status === 403) {                                            // Mật khẩu đúng nhưng chưa xác thực email
            showMessage(json?.message || 'Your account is not verified yet. Please verify your email.');   // Hướng dẫn xác thực
            resendButton.classList.remove('hidden');                       // Hiện nút gửi lại email xác thực
            return;                                                        // Kết thúc hàm
        }
        showMessage(json?.message || `Login failed (HTTP ${status})`);    // Các lỗi khác: 401 sai thông tin, 400 thiếu dữ liệu...
    } catch {
        showMessage('Cannot reach the server. Please check that the server is running.');   // Lỗi mạng: server chưa chạy
    } finally {
        loginButton.disabled = false;                                    // Mở khoá nút sau khi xử lý xong
        loginButton.textContent = 'Login';                               // Trả lại chữ gốc cho nút
    }
}

// Xử lý khi người dùng bấm nút gửi lại email xác thực
async function handleResend() {
    const email = emailInput.value.trim().toLowerCase();                // Lấy email đang nhập trong form
    if (!EMAIL_PATTERN.test(email)) {                                   // Chưa nhập email hợp lệ
        showMessage('Please enter your email address first');             // Nhắc người dùng nhập email
        return;                                                           // Kết thúc hàm
    }

    resendButton.disabled = true;                                       // Khoá nút tránh bấm liên tục
    try {
        const response = await fetch('/api/resend-verification', {        // Gọi API gửi lại email xác thực
            method: 'POST',                                                 // Phương thức POST theo spec
            headers: { 'Content-Type': 'application/json' },                // Body là JSON
            body: JSON.stringify({ email }),                                // Chỉ cần email
        });
        const json = await response.json().catch(() => null);             // Đọc JSON an toàn
        if (response.status === 429) {                                    // Bị chặn do gửi quá nhanh (cooldown 60 giây)
            showMessage(json?.message || 'Too many requests. Please wait a moment and try again.');
            return;                                                         // Kết thúc hàm
        }
        showMessage(json?.message || 'Verification email request has been processed.', response.ok);   // Thông báo kết quả
    } catch {
        showMessage('Cannot reach the server. Please try again later.');  // Lỗi mạng
    } finally {
        resendButton.disabled = false;                                    // Mở khoá nút sau khi xử lý xong
    }
}

// Kiểm tra token đã lưu; nếu còn hợp lệ thì vào thẳng trang Task list (mục 9.8 của đề)
async function redirectIfAlreadyLoggedIn() {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);        // Đọc token đã lưu từ lần đăng nhập trước
    if (!storedToken) return;                                           // Chưa có token -> ở lại trang Login

    try {
        const response = await fetch('/api/me', {                         // Gọi API kiểm tra token còn hiệu lực không
            headers: { Authorization: `Bearer ${storedToken}` },            // Gửi token theo header Bearer
        });
        if (response.ok) {                                                // Token hợp lệ và tài khoản còn active
            window.location.href = TASK_PAGE_URL;                           // Vào thẳng trang Task list
            return;                                                         // Kết thúc hàm
        }
        localStorage.removeItem(TOKEN_STORAGE_KEY);                       // Token hết hạn/bị vô hiệu -> xoá khỏi localStorage
    } catch {
        /* Server chưa chạy: giữ người dùng ở trang Login và thử lại sau */
    }
}

// --- Gắn sự kiện và chạy kiểm tra ban đầu ---
loginForm.addEventListener('submit', handleSubmit);                   // Bấm nút Login hoặc nhấn Enter trong form
resendButton.addEventListener('click', handleResend);                 // Bấm nút gửi lại email xác thực
redirectIfAlreadyLoggedIn();                                          // Tự kiểm tra token có sẵn khi vừa mở trang