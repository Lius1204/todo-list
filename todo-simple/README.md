# Todo List — Bản đơn giản (Node.js thuần)

Ứng dụng quản lý công việc viết bằng Node.js thuần (không framework), lưu dữ liệu
bằng file CSV, có đăng ký — xác thực email — đăng nhập, và kiểm tra trùng email
dựa trên danh sách 1 triệu email ảo.

Bản này được viết lại từ bản phức tạp trước đó với mục tiêu **dễ hiểu, dễ gõ lại**:
ít file, ít tầng, chỉ dùng đúng 1 thư viện ngoài (`nodemailer`).

## 1. Chức năng

- Đăng ký tài khoản: kiểm tra email hợp lệ, email chưa từng dùng, mật khẩu đủ mạnh.
- Xác thực email theo 3 bước: tạo tài khoản ở trạng thái chờ → gửi email có link → bấm link thì kích hoạt.
- Chỉ tài khoản đã kích hoạt mới đăng nhập được.
- Trang task: thêm, sửa nội dung, gán / bỏ gán / đổi người, tick hoàn thành, xoá (có hỏi xác nhận).
- Mọi tài khoản đã kích hoạt cùng dùng chung một danh sách task, không phân quyền chủ sở hữu.
- Kiểm tra trùng email với 1 triệu email ảo đã seed sẵn, tra cứu trên RAM nên rất nhanh.

## 2. Công nghệ dùng

| Việc | Dùng gì |
|---|---|
| Web server | `node:http` (không dùng Express) |
| Đọc/ghi file | `node:fs`, `node:path` |
| Băm mật khẩu, sinh token | `node:crypto` (`scryptSync`, `randomBytes`) |
| Gửi email | `nodemailer` (thư viện ngoài duy nhất) |
| Lưu dữ liệu | file CSV tự viết hàm đọc/ghi |
| Biến môi trường | `--env-file=.env` có sẵn của Node (không cần `dotenv`) |

## 3. Cấu trúc thư mục

```text
todo-simple/
├── seed.js        sinh 1.000.000 email ảo vào data/seed_users.csv
├── store.js       đọc/ghi CSV, nạp danh sách email seed lên RAM, sinh id
├── mail.js        gửi email xác thực qua Gmail SMTP
├── auth.js        đăng ký, xác thực email, đăng nhập, đăng xuất, danh sách user
├── tasks.js       thêm, sửa, gán người, tick, xoá task
├── server.js      web server: phục vụ file web + định tuyến API
├── public/        giao diện (login, signup, tasks)
├── data/          users.csv, tasks.csv, seed_users.csv (tự sinh, không đẩy lên Git)
├── .env           cấu hình cổng và Gmail (không đẩy lên Git)
└── README.md