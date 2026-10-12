// server.js
// "Tổng đài" của ứng dụng: nhận mọi request từ trình duyệt rồi quyết định làm gì.
// File này chỉ làm 4 việc:
//   1) Phục vụ file web trong thư mục public/ (HTML, CSS, JS)
//   2) Đọc dữ liệu JSON mà trình duyệt gửi lên (có giới hạn dung lượng)
//   3) Lấy token từ header Authorization để biết ai đang gọi API
//   4) Chuyển request tới đúng hàm trong auth.js / tasks.js rồi trả kết quả về
//
// Chạy server: npm start   (tương đương: node --env-file=.env server.js)

const http = require('http');  // module tạo web server có sẵn của Node
const fs = require('fs');      // module đọc file, dùng để phục vụ HTML/CSS/JS
const path = require('path');  // module ghép đường dẫn an toàn (tự đúng cho Windows/Linux)

const store = require('./store'); // kho dữ liệu: đọc/ghi CSV, nạp danh sách email seed
const auth = require('./auth');   // nghiệp vụ tài khoản: đăng ký, xác thực, đăng nhập
const tasks = require('./tasks'); // nghiệp vụ công việc: thêm, sửa, gán người, xoá

const PORT = Number(process.env.PORT) || 3000;     // cổng server, lấy từ .env, mặc định 3000
const PUBLIC_DIR = path.join(__dirname, 'public'); // thư mục chứa giao diện web
const MAX_BODY_BYTES = 64 * 1024;                  // giới hạn dữ liệu client gửi lên: 64KB

// Bảng tra: đuôi file -> kiểu nội dung, để trình duyệt biết cách hiển thị file.
// Thiếu bảng này thì trình duyệt tải .css về mà không hiểu đó là CSS.
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',        // trang web
    '.css': 'text/css; charset=utf-8',          // file trang trí
    '.js': 'text/javascript; charset=utf-8',    // file script chạy trên trình duyệt
    '.json': 'application/json; charset=utf-8', // dữ liệu JSON
    '.png': 'image/png',                        // ảnh PNG
    '.ico': 'image/x-icon',                     // icon nhỏ trên tab trình duyệt
};

// ============================================================================
// PHẦN 1: Các hàm phụ trợ dùng chung
// ============================================================================

// Gửi phản hồi dạng JSON kèm mã trạng thái (200, 400, 401...).
// data là dữ liệu kèm theo (bỏ trống nếu không cần), message là lời nhắn cho người dùng.
function sendJson(res, statusCode, message, data) {
    const payload = { message: message };                  // phần thân phản hồi, luôn có message
    if (data !== undefined) payload.data = data;           // chỉ thêm data khi thực sự có dữ liệu
    const body = JSON.stringify(payload);                  // đổi object thành chuỗi JSON để gửi đi
    res.writeHead(statusCode, {                            // ghi mã trạng thái và các header
        'Content-Type': 'application/json; charset=utf-8',   // báo cho trình duyệt biết đây là JSON
        'Content-Length': Buffer.byteLength(body),           // độ dài tính theo byte, không phải số ký tự
    });
    res.end(body);                                         // gửi nội dung về trình duyệt và kết thúc
}

// Gửi một trang HTML (dùng riêng cho kết quả xác thực email).
function sendHtml(res, statusCode, html) {
    res.writeHead(statusCode, {                          // ghi mã trạng thái và header
        'Content-Type': 'text/html; charset=utf-8',        // báo đây là trang HTML
        'Content-Length': Buffer.byteLength(html),         // độ dài nội dung theo byte
    });
    res.end(html);                                       // gửi trang về trình duyệt
}

// Chuyển các ký tự đặc biệt thành dạng an toàn trước khi nhúng vào HTML.
// Mục đích: nếu dữ liệu có chứa <script> thì trình duyệt sẽ hiển thị chữ bình thường
// chứ không chạy mã độc (gọi là chống tấn công XSS).
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')   // dấu & phải thay trước tiên, nếu không sẽ thay nhầm các dấu khác
        .replace(/</g, '&lt;')    // dấu < mở thẻ HTML
        .replace(/>/g, '&gt;')    // dấu > đóng thẻ HTML
        .replace(/"/g, '&quot;')  // dấu " dùng trong thuộc tính HTML
        .replace(/'/g, '&#39;');  // dấu ' dùng trong thuộc tính HTML
}

// Tạo trang HTML hiển thị kết quả xác thực email (thành công hoặc thất bại).
// isSuccess = true thì hiện màu xanh và dấu tick, ngược lại màu đỏ và dấu cảnh báo.
function verifyPage(isSuccess, title, message) {
    const color = isSuccess ? '#15803d' : '#b91c1c';        // xanh khi thành công, đỏ khi lỗi
    const icon = isSuccess ? '&#10004;' : '&#9888;';        // mã HTML của dấu tick và dấu cảnh báo
    return '<!DOCTYPE html>' +
        '<html lang="vi"><head><meta charset="UTF-8">' +      // khai báo UTF-8 để hiện đúng tiếng Việt
        '<meta name="viewport" content="width=device-width,initial-scale=1">' + // hiển thị đúng trên điện thoại
        '<title>Todo list - Xac thuc email</title>' +         // tiêu đề trên tab trình duyệt
        '<style>' +
        'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#f2f4f7;font-family:Arial,sans-serif;color:#1f2937}' + // căn giữa khung trên màn hình
        '.card{width:420px;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;text-align:center}' +
        'h1{margin:0 0 8px;font-size:26px}' +                 // tiêu đề "Todo list"
        '.icon{font-size:32px;margin:8px 0}' +                // dấu tick hoặc dấu cảnh báo
        'h2{margin:0 0 12px;font-size:19px;color:' + color + '}' + // dòng trạng thái, đổi màu theo kết quả
        'p{margin:0 0 18px;font-size:15px;line-height:1.6}' + // lời nhắn chi tiết
        'a{display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;' +
        'border-radius:8px;text-decoration:none}' +           // nút bấm quay về trang đăng nhập
        '</style></head><body><div class="card">' +
        '<h1>Todo list</h1>' +
        '<div class="icon">' + icon + '</div>' +
        '<h2>' + escapeHtml(title) + '</h2>' +                // escapeHtml để tránh chèn mã độc
        '<p>' + escapeHtml(message) + '</p>' +
        '<a href="/login.html">Di den trang dang nhap</a>' +  // bấm để sang trang đăng nhập
        '</div></body></html>';
}

// Đọc dữ liệu JSON mà client gửi lên trong thân request.
// Trả về object rỗng nếu client không gửi gì.
// Ném lỗi 400 nếu JSON sai định dạng, lỗi 413 nếu dữ liệu vượt 64KB.
async function readJsonBody(req) {
    const chunks = [];      // mảng chứa các mảnh dữ liệu nhận được từ client
    let totalBytes = 0;     // tổng số byte đã nhận, dùng để kiểm tra giới hạn

    for await (const chunk of req) {          // duyệt từng mảnh dữ liệu client gửi lên
        totalBytes += chunk.length;             // cộng dồn số byte của mảnh này
        if (totalBytes > MAX_BODY_BYTES) {      // vượt giới hạn cho phép
            const error = new Error('Du lieu gui len qua lon'); // tạo lỗi có thông báo rõ ràng
            error.status = 413;                   // gắn mã 413 để server trả về đúng mã
            throw error;                          // dừng hàm ngay, không đọc tiếp nữa
        }
        chunks.push(chunk);                     // lưu mảnh dữ liệu lại để ghép sau
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim(); // ghép các mảnh thành 1 chuỗi
    if (raw === '') return {};                // client không gửi gì thì coi như object rỗng

    try {
        return JSON.parse(raw);                 // phân tích chuỗi JSON thành object để dùng
    } catch {
        const error = new Error('Du lieu gui len khong phai JSON hop le'); // JSON hỏng
        error.status = 400;                     // gắn mã 400 để server trả về đúng mã
        throw error;                            // báo lỗi cho nơi gọi xử lý
    }
}

// Lấy token từ header "Authorization: Bearer <token>"; trả về chuỗi rỗng nếu không có.
function getTokenFromHeader(req) {
    const header = req.headers.authorization || ''; // đọc header, ví dụ "Bearer abc123"
    if (!header.startsWith('Bearer ')) return '';   // không đúng định dạng thì xem như không có token
    return header.slice(7).trim();                  // bỏ 7 ký tự "Bearer " ở đầu, lấy phần còn lại
}

// Đọc file trong thư mục public/ và trả về cho trình duyệt.
// Trả về true nếu đã gửi file thành công, false nếu không tìm thấy file.
function serveStatic(res, pathname) {
    // Đường dẫn "/" thì trả trang đăng nhập, ngược lại dùng đúng đường dẫn người dùng gõ
    const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'login.html' : pathname);

    // Chống "path traversal": nếu URL chứa ../ để trỏ ra ngoài thư mục public thì từ chối.
    // path.resolve đổi đường dẫn tương đối thành tuyệt đối để so sánh chính xác.
    const safeRoot = path.resolve(PUBLIC_DIR);      // đường dẫn tuyệt đối của thư mục public
    if (!path.resolve(filePath).startsWith(safeRoot)) {
        return false;                                 // cố truy cập file ngoài public -> coi như không có
    }

    // File không tồn tại, hoặc đó là thư mục chứ không phải file
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return false;                                 // báo cho nơi gọi biết để trả lỗi 404
    }

    const body = fs.readFileSync(filePath);                        // đọc toàn bộ nội dung file
    const extension = path.extname(filePath).toLowerCase();        // lấy đuôi file, ví dụ ".css"
    res.writeHead(200, {                                           // mọi thứ ổn -> trả về mã 200
        'Content-Type': MIME_TYPES[extension] || 'application/octet-stream', // kiểu file, mặc định là dữ liệu thô
        'Content-Length': body.length,                               // độ dài file theo byte
    });
    res.end(body);                                                 // gửi nội dung file về trình duyệt
    return true;                                                   // báo đã phục vụ xong
}

// ============================================================================
// PHẦN 2: Xử lý các API bắt đầu bằng /api/
// ============================================================================

// Mọi lỗi ném ra từ auth.js / tasks.js đều có .status (do hàm httpError tạo ra),
// nên chỉ cần MỘT chỗ bắt lỗi duy nhất ở cuối file: lấy error.status làm mã HTTP.
async function handleApi(req, res, url) {
    const pathname = url.pathname; // đường dẫn, ví dụ "/api/login"
    const method = req.method;     // phương thức, ví dụ "POST"

    // ---------- Nhóm A: 3 API công khai, không cần đăng nhập ----------

    // 1) Đăng ký tài khoản mới
    if (method === 'POST' && pathname === '/api/signup') {
        const body = await readJsonBody(req);                        // đọc email và mật khẩu client gửi lên
        const user = auth.signup(body.email, body.password);         // hàm này tự kiểm tra và ném lỗi nếu sai
        sendJson(res, 201, 'Dang ky thanh cong, hay kiem tra email de xac thuc tai khoan', user); // 201 = tạo mới thành công
        return;                                                      // kết thúc xử lý request này
    }

    // 2) Người dùng bấm link trong email -> kích hoạt tài khoản
    // Endpoint này trả về TRANG HTML (vì người dùng nhìn thấy trang web),
    // các endpoint còn lại đều trả JSON.
    if (method === 'GET' && pathname === '/api/verify') {
        const token = url.searchParams.get('token') || '';           // lấy token từ phần ?token=... trên URL
        try {
            const result = auth.verifyEmail(token);                    // kích hoạt tài khoản trong users.csv
            sendHtml(res, 200, verifyPage(true, 'Email verified',      // thành công -> trang xanh
                'Tai khoan ' + result.email + ' da duoc kich hoat. Ban co the dang nhap.'));
        } catch (error) {
            sendHtml(res, error.status || 500, verifyPage(false, 'Verification failed', error.message)); // lỗi -> trang đỏ
        }
        return;                                                      // kết thúc xử lý request này
    }

    // 3) Đăng nhập
    if (method === 'POST' && pathname === '/api/login') {
        const body = await readJsonBody(req);                        // đọc email và mật khẩu client gửi lên
        const session = auth.login(body.email, body.password);       // kiểm tra mật khẩu, tạo token phiên
        sendJson(res, 200, 'Dang nhap thanh cong', session);         // trả về token và thông tin người dùng
        return;                                                      // kết thúc xử lý request này
    }

    // ---------- Nhóm B: từ đây trở xuống đều bắt buộc phải đăng nhập ----------

    // Kiểm tra đường dẫn có phải API cần đăng nhập không.
    // Nếu không phải thì trả 404 luôn (chưa cần kiểm tra token).
    const isProtected =
        pathname === '/api/logout' ||                 // đăng xuất
        pathname === '/api/me' ||                     // thông tin người đang đăng nhập
        pathname === '/api/users' ||                  // danh sách người dùng để gán việc
        pathname === '/api/tasks' ||                  // danh sách / thêm task
        pathname.startsWith('/api/tasks/');           // sửa / xoá một task cụ thể

    if (!isProtected) {
        sendJson(res, 404, 'Khong tim thay API: ' + method + ' ' + pathname, undefined); // 404 = không có endpoint này
        return;                                                      // kết thúc xử lý request này
    }

    // Hỏi auth xem token gửi lên thuộc về ai. Sai/thiếu token thì hàm này ném lỗi 401.
    const currentUser = auth.getUserByToken(getTokenFromHeader(req));

    // 4) Đăng xuất: xoá token khỏi danh sách phiên trong RAM
    if (method === 'POST' && pathname === '/api/logout') {
        auth.logout(getTokenFromHeader(req));                        // xoá phiên -> token cũ hết hiệu lực ngay
        sendJson(res, 200, 'Da dang xuat', undefined);               // không có dữ liệu kèm theo
        return;                                                      // kết thúc xử lý request này
    }

    // 5) Thông tin người đang đăng nhập (dùng cho thanh trên cùng của trang task)
    if (method === 'GET' && pathname === '/api/me') {
        sendJson(res, 200, 'Thong tin nguoi dang dang nhap', currentUser); // trả id, email, status
        return;                                                      // kết thúc xử lý request này
    }

    // 6) Danh sách người dùng đã kích hoạt, để đổ vào ô chọn "Assign"
    if (method === 'GET' && pathname === '/api/users') {
        sendJson(res, 200, 'Danh sach nguoi dung da kich hoat', auth.listActiveUsers());
        return;                                                      // kết thúc xử lý request này
    }

    // 7) Xem danh sách toàn bộ task (kèm email người được gán)
    if (method === 'GET' && pathname === '/api/tasks') {
        sendJson(res, 200, 'Danh sach task', tasks.listTasks());     // mọi task, không lọc theo người tạo
        return;                                                      // kết thúc xử lý request này
    }

    // 8) Thêm task mới
    if (method === 'POST' && pathname === '/api/tasks') {
        const body = await readJsonBody(req);                        // đọc nội dung task client gửi lên
        const task = tasks.addTask(currentUser.id, body.content);    // createdBy lấy từ PHIÊN, không lấy từ client
        sendJson(res, 201, 'Da them task', task);                    // 201 = tạo mới thành công
        return;                                                      // kết thúc xử lý request này
    }

    // 9) Sửa một task: đường dẫn dạng /api/tasks/<id>
    // 10) Xoá một task: cũng dạng /api/tasks/<id>
    if (pathname.startsWith('/api/tasks/')) {
        const taskId = pathname.slice('/api/tasks/'.length);         // lấy phần id nằm sau dấu / cuối cùng

        if (method === 'PATCH') {                                    // PATCH = sửa một phần task
            const body = await readJsonBody(req);                      // đọc các field client muốn sửa
            const task = tasks.updateTask(taskId, body);               // chỉ đổi đúng field client gửi lên
            sendJson(res, 200, 'Da cap nhat task', task);              // trả về task sau khi đã sửa
            return;                                                    // kết thúc xử lý request này
        }

        if (method === 'DELETE') {                                   // DELETE = xoá task
            const removed = tasks.deleteTask(taskId);                  // xoá đúng một dòng trong tasks.csv
            sendJson(res, 200, 'Da xoa task', removed);                // trả về id và nội dung đã xoá
            return;                                                    // kết thúc xử lý request này
        }
    }

    // Đường dẫn đúng dạng /api/tasks/... nhưng dùng phương thức khác (ví dụ GET)
    sendJson(res, 404, 'Khong tim thay API: ' + method + ' ' + pathname, undefined);
}

// ============================================================================
// PHẦN 3: Tạo server và lắng nghe kết nối
// ============================================================================

// Trình xử lý chính: hàm này chạy cho MỌI request gửi tới server
const server = http.createServer(function (req, res) {
    let url;
    try {
        url = new URL(req.url, 'http://localhost');  // tách URL thành đường dẫn và tham số ?a=b
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); // URL sai định dạng
        res.end('400 Bad Request');                  // trả lỗi gọn và kết thúc, không làm sập server
        return;
    }

    // Nếu đường dẫn bắt đầu bằng /api/ thì giao cho phần xử lý API
    if (url.pathname.startsWith('/api/')) {
        handleApi(req, res, url).catch(function (error) {
            const status = error.status || 500;        // lỗi không có .status nghĩa là lỗi ngoài dự kiến
            if (status === 500) {                      // ghi log đầy đủ chỉ cho lỗi thật sự nghiêm trọng
                console.error('[server] Loi khong mong doi:', error);
            }
            if (res.writableEnded) return;             // phản hồi đã gửi rồi thì không gửi lại nữa
            sendJson(res, status, error.message || 'Loi he thong', undefined); // trả lỗi theo đúng mã
        });
        return;
    }

    // Còn lại là yêu cầu lấy file web: đọc file trong thư mục public/
    if (!serveStatic(res, url.pathname)) {         // không tìm thấy file tương ứng
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); // trả lỗi 404
        res.end('404 Not Found');                    // nội dung ngắn gọn, không lộ thông tin hệ thống
    }
});

// Nạp sẵn danh sách 1 triệu email seed vào RAM ngay khi khởi động, để lần đăng ký
// đầu tiên không phải chờ đọc file 44MB. Đây là mẹo giúp đăng ký luôn nhanh.
const loadStartedAt = Date.now();                            // ghi lại mốc thời gian bắt đầu nạp
const seedEmails = store.loadSeedEmails();                   // đọc file và đưa vào Set trong bộ nhớ
console.log('[server] Da nap ' + seedEmails.size + ' email seed vao RAM trong ' + (Date.now() - loadStartedAt) + ' ms');

// Cho server bắt đầu lắng nghe kết nối trên cổng PORT
server.listen(PORT, function () {
    console.log('==================================================');
    console.log('[server] Todo list dang chay tai http://localhost:' + PORT);
    console.log('[server] Trang dang nhap  http://localhost:' + PORT + '/login.html');
    console.log('[server] Trang dang ky    http://localhost:' + PORT + '/signup.html');
    console.log('==================================================');
});