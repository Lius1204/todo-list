// seed.js
// Sinh 1.000.000 email ảo vào data/seed_users.csv.
// Mục đích: làm "danh sách email đã bị chiếm" để lúc đăng ký kiểm tra trùng.
// Chạy 1 lần duy nhất: npm run seed

const fs = require('fs');    // module đọc/ghi file có sẵn của Node
const path = require('path'); // module ghép đường dẫn có sẵn của Node

const TOTAL = 1000000;                                  // số email cần sinh
const DATA_DIR = path.join(__dirname, 'data');          // thư mục data nằm cạnh file này
const SEED_FILE = path.join(DATA_DIR, 'seed_users.csv'); // file kết quả

// Nếu file đã tồn tại thì không làm gì nữa (chạy lại script không bị ghi đè)
if (fs.existsSync(SEED_FILE)) {
    console.log('[seed] Da co data/seed_users.csv - bo qua. Muon tao lai thi xoa file roi chay lai.');
    process.exit(0); // thoát chương trình ngay, mã 0 = thoát bình thường
}

// Tạo thư mục data nếu chưa có (recursive: tạo cả thư mục cha nếu thiếu)
fs.mkdirSync(DATA_DIR, { recursive: true });

console.log('[seed] Dang tao ' + TOTAL.toLocaleString('en-US') + ' email ao...');
const startedAt = Date.now(); // lưu mốc thời gian bắt đầu, để đo thời gian chạy

const lines = ['id,email']; // dòng đầu tiên là header của file CSV
for (let i = 1; i <= TOTAL; i++) {
    const number = String(i).padStart(7, '0'); // 42 -> "0000042" (thêm số 0 cho đủ 7 chữ số)
    lines.push('seed_user_' + number + ',seeduser' + number + '@example.com');
}

// Gom tất cả vào mảng rồi nối 1 lần rồi ghi -> nhanh hơn cộng dồn chuỗi 1 triệu lần
fs.writeFileSync(SEED_FILE, lines.join('\n') + '\n', 'utf8');

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);            // thời gian chạy (giây)
const sizeMb = (fs.statSync(SEED_FILE).size / 1024 / 1024).toFixed(1);   // kích thước file (MB)
console.log('[seed] Xong sau ' + seconds + ' giay');
console.log('[seed] File: data/seed_users.csv (' + sizeMb + ' MB, ' + (TOTAL + 1) + ' dong gom header)');
console.log('[seed] Vi du: seeduser0000001@example.com ... seeduser1000000@example.com');