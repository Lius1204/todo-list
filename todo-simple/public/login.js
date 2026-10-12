// login.js
// Xử lý trang đăng nhập: kiểm tra dữ liệu người dùng nhập, gọi API /api/login,
// lưu token vào localStorage rồi chuyển sang trang task.

const TOKEN_KEY = 'todo_token';    // tên khoá dùng để lưu token đăng nhập trong localStorage
const TASKS_PAGE = '/tasks.html';  // trang sẽ mở ra sau khi đăng nhập thành công

// Lấy các phần tử HTML cần dùng, theo đúng id đã đặt trong login.html
const loginForm = document.getElementById('login-form');         // thẻ <form> bao ngoài 2 ô nhập
const emailInput = document.getElementById('email');              // ô nhập email
const passwordInput = document.getElementById('password');        // ô nhập mật khẩu
const emailError = document.getElementById('email-error');        // chỗ hiện lỗi của ô email
const passwordError = document.getElementById('password-error');  // chỗ hiện lỗi của ô mật khẩu
const messageBox = document.getElementById('message');            // chỗ hiện thông báo chung
const loginButton = document.getElementById('login-button');      // nút Login

// Hiện thông báo chung ở trên form. isSuccess = true thì hiện màu xanh (thành công).
function showMessage(text, isSuccess) {
    messageBox.textContent = text;                                      // textContent chèn chữ thuần, không chạy mã HTML
    messageBox.className = isSuccess ? 'message success' : 'message';   // đổi class để đổi màu chữ
}

// Xoá sạch các thông báo cũ trước mỗi lần kiểm tra mới
function clearMessages() {
    showMessage('', false);           // xoá thông báo chung
    emailError.textContent = '';      // xoá lỗi của ô email
    passwordError.textContent = '';   // xoá lỗi của ô mật khẩu
}

// Kiểm tra dữ liệu người dùng nhập ở trình duyệt, để báo lỗi ngay mà không cần gọi server.
// Server vẫn kiểm tra lại lần nữa, nên đây chỉ là bước cho trải nghiệm nhanh hơn.
function validateForm() {
    clearMessages();                                        // bắt đầu lượt kiểm tra mới
    let isValid = true;                                     // biến đánh dấu form có hợp lệ hay không

    const email = emailInput.value.trim();                  // lấy email, bỏ khoảng trắng hai đầu
    if (email === '') {                                     // trường hợp bỏ trống
        emailError.textContent = 'Vui long nhap email';       // hiện lỗi ngay dưới ô email
        isValid = false;                                      // đánh dấu form không hợp lệ
    } else if (email.indexOf('@') === -1) {                 // trường hợp thiếu dấu @
        emailError.textContent = 'Email khong dung dinh dang'; // báo lỗi định dạng
        isValid = false;                                      // đánh dấu form không hợp lệ
    }

    if (passwordInput.value === '') {                       // mật khẩu bỏ trống
        passwordError.textContent = 'Vui long nhap mat khau'; // hiện lỗi dưới ô mật khẩu
        isValid = false;                                      // đánh dấu form không hợp lệ
    }

    return isValid;                                         // trả kết quả cho hàm gọi nó
}

// Bật/tắt trạng thái "đang gửi" của nút Login, tránh người dùng bấm nhiều lần
function setLoading(isLoading) {
    loginButton.disabled = isLoading;                                  // khoá nút khi đang gửi
    loginButton.textContent = isLoading ? 'Logging in...' : 'Login';   // đổi chữ để người dùng biết đang xử lý
}

// Chạy khi người dùng bấm nút Login (hoặc nhấn Enter trong form)
async function handleSubmit(event) {
    event.preventDefault();                     // chặn hành vi tải lại trang mặc định của form
    if (!validateForm()) return;                // dữ liệu nhập sai thì dừng, không gọi API

    setLoading(true);                           // khoá nút, đổi chữ thành "Logging in..."

    try {
        // Gửi email và mật khẩu lên server bằng hàm fetch
        const response = await fetch('/api/login', {
            method: 'POST',                                              // đăng nhập là gửi dữ liệu nên dùng POST
            headers: { 'Content-Type': 'application/json' },              // báo cho server biết body là JSON
            body: JSON.stringify({                                        // đổi object thành chuỗi JSON
                email: emailInput.value.trim().toLowerCase(),               // chuẩn hoá giống server: bỏ khoảng trắng, chữ thường
                password: passwordInput.value,                              // mật khẩu giữ nguyên, không cắt khoảng trắng
            }),
        });

        const result = await response.json();   // đọc dữ liệu JSON mà server trả về

        if (response.status === 200) {                                    // 200 = đăng nhập thành công
            localStorage.setItem(TOKEN_KEY, result.data.token);              // lưu token vào trình duyệt để dùng cho các API sau
            window.location.href = TASKS_PAGE;                               // chuyển sang trang task
            return;                                                          // kết thúc hàm, không chạy phần dưới
        }

        showMessage(result.message, false);                                // các trường hợp lỗi còn lại: hiện lời nhắn của server
    } catch (error) {
        showMessage('Khong ket noi duoc server. Kiem tra lai xem server da chay chua.', false); // lỗi mạng
    } finally {
        setLoading(false);                                                 // dù thành công hay lỗi đều mở khoá nút
    }
}

// Nếu trong máy đã có token từ lần đăng nhập trước và token còn hiệu lực thì vào thẳng trang task
async function redirectIfLoggedIn() {
    const savedToken = localStorage.getItem(TOKEN_KEY);                   // đọc token đã lưu (nếu có)
    if (!savedToken) return;                                             // chưa có token thì ở lại trang đăng nhập

    try {
        const response = await fetch('/api/me', {                           // hỏi server xem token này còn dùng được không
            headers: { Authorization: 'Bearer ' + savedToken },               // gửi token theo header Authorization
        });
        if (response.status === 200) {                                      // token còn hiệu lực
            window.location.href = TASKS_PAGE;                                // vào thẳng trang task
            return;                                                           // kết thúc hàm
        }
        localStorage.removeItem(TOKEN_KEY);                                 // token hết hiệu lực thì xoá đi cho sạch
    } catch (error) {
        // Server chưa chạy thì bỏ qua, người dùng vẫn ở trang đăng nhập
    }
}

loginForm.addEventListener('submit', handleSubmit);   // bấm nút Login hoặc nhấn Enter đều gọi handleSubmit
redirectIfLoggedIn();                                  // chạy ngay khi mở trang để kiểm tra token cũ