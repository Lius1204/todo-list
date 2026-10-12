// mail.js
// Gửi email xác thực qua Gmail. Đây là file DUY NHẤT dùng thư viện ngoài (nodemailer).
//
// Dùng ở file khác:  const { sendVerifyEmail } = require('./mail');
//                    sendVerifyEmail('a@b.com', 'token123');   // trả về Promise
//
// Tự kiểm tra file này (gửi thử 1 email về chính hộp thư của bạn): npm run mail:test

const nodemailer = require('nodemailer'); // thư viện gửi email, đã cài bằng: npm install nodemailer

let transporter = null; // "người đưa thư": tạo 1 lần rồi dùng lại cho mọi email về sau

// Tạo (hoặc lấy lại) người đưa thư đã đăng nhập Gmail.
// Đọc biến môi trường ở đây để báo lỗi rõ ràng nếu bạn quên điền file .env.
function getTransporter() {
    if (transporter) return transporter; // đã tạo rồi thì dùng lại, không kết nối lại từ đầu

    const user = process.env.GMAIL_USER;             // Gmail dùng để gửi
    const pass = process.env.GMAIL_APP_PASSWORD;     // App Password 16 ký tự
    if (!user || !pass) {
        throw new Error('Thieu GMAIL_USER hoac GMAIL_APP_PASSWORD trong file .env');
    }

    transporter = nodemailer.createTransport({
        service: 'gmail',                 // nodemailer tự biết host smtp.gmail.com, cổng 465 và bật TLS
        auth: { user: user, pass: pass }, // đăng nhập bằng App Password
    });
    return transporter;
}

// Gửi email chứa link xác thực tài khoản.
// CHỈ trả về khi Gmail đã xác nhận nhận email -> không bao giờ báo "đã gửi" sai sự thật.
// Nếu gửi thất bại, hàm NÉM LỖI để nơi gọi tự quyết định (thường là ghi log và giữ tài khoản ở trạng thái chờ).
async function sendVerifyEmail(toEmail, token) {
    // Link trỏ về chính server của mình; người dùng bấm vào là server chạy API /api/verify.
    // Token là chuỗi hex do mình sinh ra nên ghép thẳng vào URL được, không cần mã hoá.
    const baseUrl = process.env.BASE_URL || ('http://localhost:' + (process.env.PORT || 3000));
    const link = baseUrl + '/api/verify?token=' + token;

    // Bản dạng chữ thuần: dành cho phần mềm đọc mail không hiển thị HTML
    const textBody = [
        'Xin chào,',
        '',
        'Cảm ơn bạn đã đăng ký Todo list.',
        'Hãy mở link sau để xác thực email và kích hoạt tài khoản:',
        link,
        '',
        'Nếu bạn không tạo tài khoản này, hãy bỏ qua email này.',
    ].join('\n');

    // Bản HTML: có nút bấm rõ ràng cho người dùng
    const htmlBody =
        '<h2>Todo list</h2>' +
        '<p>Cảm ơn bạn đã đăng ký. Hãy bấm nút bên dưới để xác thực email:</p>' +
        '<p><a href="' + link + '" style="background:#2563eb;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;">Verify my email</a></p>' +
        '<p>Hoặc copy link này vào trình duyệt:<br>' + link + '</p>' +
        '<p>Nếu bạn không tạo tài khoản này, hãy bỏ qua email này.</p>';

    const info = await getTransporter().sendMail({
        from: '"Todo list" <' + process.env.GMAIL_USER + '>', // tên hiển thị trong hộp thư người nhận
        to: toEmail,                                          // người nhận
        subject: 'Verify your Todo list account',             // tiêu đề email
        text: textBody,                                       // bản chữ thuần
        html: htmlBody,                                       // bản HTML
    });

    return info.messageId; // mã định danh email do Gmail trả về, dùng để ghi log
}

module.exports = { sendVerifyEmail: sendVerifyEmail };

// ============================================================================
// Tự kiểm tra: gửi thử 1 email về chính hộp thư của bạn (chỉ chạy khi gõ npm run mail:test)
// ============================================================================
if (require.main === module) {
    const target = process.env.GMAIL_USER; // gửi cho chính mình để xem kết quả
    if (!target) {
        console.error('[mail] Thieu GMAIL_USER trong .env. Hay chay bang lenh: npm run mail:test');
        process.exit(1);
    }

    console.log('[mail] Dang gui thu toi ' + target + ' ...');
    const startedAt = Date.now();
    sendVerifyEmail(target, 'tokenkiemthu123')
        .then(function (messageId) {
            console.log('[mail] Gui THANH CONG sau ' + (Date.now() - startedAt) + ' ms');
            console.log('[mail] messageId = ' + messageId);
            console.log('[mail] Hay mo hop thu (va ca muc Spam) de xem email thu.');
        })
        .catch(function (error) {
            console.error('[mail] Gui THAT BAI: ' + error.message);
            console.error('[mail] Xem bang loi thuong gap ben duoi (535-5.7.8 = sai App Password).');
            process.exit(1);
        });
}