// signup.js
// Xử lý trang đăng ký: kiểm tra email và mật khẩu, gọi API /api/signup.
// Lưu ý: đăng ký xong thì tài khoản ở trạng thái "chờ xác thực",
// nên trang này KHÔNG lưu token và KHÔNG tự đăng nhập.

const MESSAGE_SIGNUP_OK = 'Dang ky thanh cong. Hay mo email de bam link xac thuc tai khoan.'; // lời nhắn khi thành công

// Lấy các phần tử HTML cần dùng, theo đúng id đã đặt trong signup.html
const signupForm = document.getElementById('signup-form');       // thẻ <form> bao ngoài 2 ô nhập
const emailInput = document.getElementById('email');              // ô nhập email
const passwordInput = document.getElementById('password');        // ô nhập mật khẩu
const emailError = document.getElementById('email-error');        // chỗ hiện lỗi của ô email
const passwordError = document.getElementById('password-error');  // chỗ hiện lỗi của ô mật khẩu
const messageBox = document.getElementById('message');            // chỗ hiện thông báo chung
const signupButton = document.getElementById('signup-button');    // nút SignUp

// Hiện thông báo chung ở trên form. isSuccess = true thì hiện màu xanh (thành công).
function showMessage(text, isSuccess) {
    messageBox.textContent = text;                                      // chèn chữ thuần, an toàn với dữ liệu ngoài
    messageBox.className = isSuccess ? 'message success' : 'message';   // đổi class để đổi màu chữ
}

// Xoá sạch các thông báo cũ trước mỗi lần kiểm tra mới
function clearMessages() {
    showMessage('', false);           // xoá thông báo chung
    emailError.textContent = '';      // xoá lỗi của ô email
    passwordError.textContent = '';   // xoá lỗi của ô mật khẩu
}

// Kiểm tra email và trả về câu thông báo lỗi, hoặc chuỗi rỗng nếu email hợp lệ
function findEmailError(email) {
    if (email === '') return 'Vui long nhap email';                              // bỏ trống
    if (email.indexOf('@') === -1 || email.indexOf('.') === -1) {                // thiếu @ hoặc thiếu phần tên miền
        return 'Email khong dung dinh dang';
    }
    return '';                                                                   // hợp lệ
}

// Kiểm tra mật khẩu theo đúng 4 quy tắc của đề bài, trả về câu thông báo lỗi
// hoặc chuỗi rỗng nếu mật khẩu hợp lệ. Thứ tự kiểm tra giống hệt bên server.
function findPasswordError(password) {
    if (password === '') return 'Vui long nhap mat khau';                                     // bỏ trống
    if (password.length < 8) return 'Mat khau phai co it nhat 8 ky tu';                        // quá ngắn
    if (password.length > 20) return 'Mat khau khong duoc dai qua 20 ky tu';                   // quá dài
    if (!/[A-Z]/.test(password)) return 'Mat khau phai co it nhat 1 chu HOA';                  // thiếu chữ in hoa
    if (!/[a-z]/.test(password)) return 'Mat khau phai co it nhat 1 chu thuong';               // thiếu chữ in thường
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?`~]/.test(password)) {                            // thiếu ký tự đặc biệt
        return 'Mat khau phai co it nhat 1 ky tu dac biet';
    }
    return '';                                                                                 // hợp lệ
}

// Kiểm tra toàn bộ form ở trình duyệt trước khi gọi API
function validateForm() {
    clearMessages();                                                        // bắt đầu lượt kiểm tra mới
    let isValid = true;                                                     // biến đánh dấu form có hợp lệ hay không

    const email = emailInput.value.trim();                                  // lấy email, bỏ khoảng trắng hai đầu
    const emailMessage = findEmailError(email);                             // hỏi hàm kiểm tra email xem có lỗi gì
    if (emailMessage !== '') {                                              // nếu có lỗi
        emailError.textContent = emailMessage;                                // hiện lỗi ngay dưới ô email
        isValid = false;                                                      // đánh dấu form không hợp lệ
    }

    const passwordMessage = findPasswordError(passwordInput.value);          // hỏi hàm kiểm tra mật khẩu xem có lỗi gì
    if (passwordMessage !== '') {                                           // nếu có lỗi
        passwordError.textContent = passwordMessage;                          // hiện lỗi ngay dưới ô mật khẩu
        isValid = false;                                                      // đánh dấu form không hợp lệ
    }

    return isValid;                                                          // trả kết quả cho hàm gọi nó
}

// Bật/tắt trạng thái "đang gửi" của nút SignUp, tránh người dùng bấm nhiều lần
function setLoading(isLoading) {
    signupButton.disabled = isLoading;                                         // khoá nút khi đang gửi
    signupButton.textContent = isLoading ? 'Creating...' : 'SignUp';            // đổi chữ để người dùng biết đang xử lý
}

// Chạy khi người dùng bấm nút SignUp
async function handleSubmit(event) {
    event.preventDefault();                        // chặn hành vi tải lại trang mặc định của form
    if (!validateForm()) return;                   // dữ liệu nhập sai thì dừng, không gọi API

    setLoading(true);                              // khoá nút, đổi chữ thành "Creating..."

    try {
        // Gửi email và mật khẩu lên server để tạo tài khoản mới
        const response = await fetch('/api/signup', {
            method: 'POST',                                              // tạo mới dữ liệu nên dùng POST
            headers: { 'Content-Type': 'application/json' },              // báo cho server biết body là JSON
            body: JSON.stringify({                                        // đổi object thành chuỗi JSON
                email: emailInput.value.trim().toLowerCase(),               // chuẩn hoá email giống server
                password: passwordInput.value,                              // mật khẩu giữ nguyên, không cắt khoảng trắng
            }),
        });

        const result = await response.json();   // đọc dữ liệu JSON mà server trả về

        if (response.status === 201) {                                    // 201 = tạo tài khoản thành công
            showMessage(MESSAGE_SIGNUP_OK, true);                           // hiện lời nhắn màu xanh
            passwordInput.value = '';                                       // xoá ô mật khẩu cho an toàn
            return;                                                         // kết thúc hàm; KHÔNG lưu token, KHÔNG tự đăng nhập
        }

        showMessage(result.message, false);                                // 400 hoặc 409: hiện lời nhắn của server
    } catch (error) {
        showMessage('Khong ket noi duoc server. Kiem tra lai xem server da chay chua.', false); // lỗi mạng
    } finally {
        setLoading(false);                                                 // dù thành công hay lỗi đều mở khoá nút
    }
}

signupForm.addEventListener('submit', handleSubmit);   // bấm nút SignUp hoặc nhấn Enter đều gọi handleSubmit